/**
 * HwfaClient — the one façade the app talks to.
 *
 * Ties together onboarding (Discovery), the live relay socket, and the crypto
 * provider into a small conversation API: onboard, send a text, receive texts.
 * All key material stays inside the injected `CryptoProvider`; this class only
 * moves ids, ciphertext, and plaintext between the provider and the network.
 */
import type { Envelope, MessageStatus, ScamVerdict } from "@hwfa/models";
import { DiscoveryClient, type FetchLike } from "./discovery.js";
import { RelayConnection, type WebSocketCtor } from "./relay.js";
import type { CryptoProvider } from "./crypto-provider.js";
import { heuristicScamDetector, type ScamDetector } from "./scam/detector.js";
import { sha256 } from "./sha256.js";

export interface HwfaClientOptions {
  /** Base URL of the Discovery service, e.g. "http://10.0.2.2:8091". */
  discoveryUrl: string;
  /** WebSocket URL of the relay, e.g. "ws://10.0.2.2:8090/v1/relay". */
  relayUrl: string;
  /** Platform crypto (Node: `@hwfa/client/node`; RN: a native binding). */
  crypto: CryptoProvider;
  /** WebSocket constructor (RN/browser: global `WebSocket`; Node: `ws`). */
  webSocketCtor: WebSocketCtor;
  /** Override fetch (defaults to the global). */
  fetchImpl?: FetchLike;
  /** On-device scam detector (defaults to the heuristic Tier-0 detector). */
  scamDetector?: ScamDetector;
}

/** A decrypted inbound text handed to the app. */
export interface IncomingText {
  fromUserId: string;
  fromDevice: number;
  text: string;
  receivedAt: number;
  /** Server envelope id — used to send a read receipt for this message. */
  envelopeId: string;
  /** On-device scam-detection verdict over the decrypted text. */
  verdict: ScamVerdict;
}

export type TextHandler = (msg: IncomingText) => void;

/** An outbound message's status change, keyed by the sender's clientRef. */
export interface MessageStatusUpdate {
  clientRef: string;
  status: MessageStatus;
}

export type MessageStatusHandler = (update: MessageStatusUpdate) => void;

/** Live relay socket state, surfaced to the UI (e.g. the network status pill). */
export type ConnectionState = "connecting" | "connected" | "offline";

export type ConnectionHandler = (state: ConnectionState) => void;

/** Reconnect backoff schedule (ms), clamped to the last value. */
const RECONNECT_BACKOFF_MS = [1000, 2000, 5000, 10000, 15000];

export class HwfaClient {
  private readonly discovery: DiscoveryClient;
  private readonly crypto: CryptoProvider;
  private readonly scamDetector: ScamDetector;
  private readonly relayUrl: string;
  private readonly webSocketCtor: WebSocketCtor;

  private relay: RelayConnection | null = null;
  private userId: string | null = null;
  /** Registered but not-yet-verified id, held between requestOtp and confirmOtp. */
  private pendingUserId: string | null = null;
  private deviceId = 1;
  private pushToken: string | null = null;

  /** Connection state + subscribers, and the reconnect machinery. */
  private connState: ConnectionState = "offline";
  private readonly connectionHandlers: ConnectionHandler[] = [];
  private intentionalClose = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  /** Peers we already have an outbound session with, and their device id. */
  private readonly peerDevice = new Map<string, number>();
  private readonly textHandlers: TextHandler[] = [];
  private readonly statusHandlers: MessageStatusHandler[] = [];

  /** clientRef ↔ server envelope id, so status updates map back to a message. */
  private readonly refToEnvelope = new Map<string, string>();
  private readonly envelopeToRef = new Map<string, string>();

  constructor(opts: HwfaClientOptions) {
    this.discovery = new DiscoveryClient(opts.discoveryUrl, opts.fetchImpl ?? fetch);
    this.crypto = opts.crypto;
    this.scamDetector = opts.scamDetector ?? heuristicScamDetector;
    this.relayUrl = opts.relayUrl;
    this.webSocketCtor = opts.webSocketCtor;
  }

  /** Our Discovery-assigned account id, once onboarded. */
  get accountId(): string | null {
    return this.userId;
  }

  /**
   * Full onboarding in one shot: mint keys, register + verify (dev-OTP path),
   * then open the relay. Only works when Discovery echoes the OTP
   * (DISCOVERY_DEV=1) — headless tests and dev. Production uses the two-step
   * `requestOtp` / `confirmOtp` flow so the user can enter the SMS code.
   */
  async onboard(phoneNumber: string): Promise<string> {
    const reg = await this.crypto.generateRegistration({ deviceId: this.deviceId });
    this.deviceId = reg.deviceId;
    const userId = await this.discovery.onboard(
      reg.publishedBundle,
      reg.oneTimePreKeys,
      phoneNumber,
    );
    this.userId = userId;
    await this.connectRelay();
    return userId;
  }

  /**
   * Step 1 of production onboarding: mint keys and register the number, which
   * triggers the SMS OTP. Returns the provisional user id and whether a dev OTP
   * was echoed (so the caller can auto-fill it in dev). Does NOT connect the
   * relay — the account isn't verified yet.
   */
  async requestOtp(
    phoneNumber: string,
  ): Promise<{ userId: string; otpSent: boolean; devOtp?: string }> {
    const reg = await this.crypto.generateRegistration({ deviceId: this.deviceId });
    this.deviceId = reg.deviceId;
    const res = await this.discovery.register(reg.publishedBundle, reg.oneTimePreKeys, phoneNumber);
    this.pendingUserId = res.userId;
    return res;
  }

  /**
   * Step 2 of production onboarding: submit the SMS code. On success, the
   * account is verified, the bearer token is kept, and the relay opens. Returns
   * our confirmed user id.
   */
  async confirmOtp(code: string): Promise<string> {
    if (!this.pendingUserId) throw new Error("requestOtp() must run before confirmOtp()");
    await this.discovery.submitOtp(this.pendingUserId, code);
    this.userId = this.pendingUserId;
    this.pendingUserId = null;
    await this.connectRelay();
    return this.userId;
  }

  /**
   * Resume a previously onboarded identity (persisted account id + device) and
   * reconnect the relay — no re-registration. The crypto provider must already
   * hold the persisted key material (e.g. the RN native store loads it on init).
   */
  async resume(userId: string, deviceId: number): Promise<string> {
    this.userId = userId;
    this.deviceId = deviceId > 0 ? deviceId : 1;
    await this.connectRelay();
    return userId;
  }

  /** Open (or reuse) the relay socket under our onboarded identity. */
  async connectRelay(): Promise<void> {
    if (!this.userId) throw new Error("onboard() before connecting the relay");
    if (this.relay) return;
    this.intentionalClose = false;
    this.setConnectionState("connecting");
    this.relay = new RelayConnection(
      this.relayUrl,
      this.userId,
      this.deviceId,
      this.webSocketCtor,
      {
        onDeliver: (env) => void this.handleDeliver(env),
        onAck: (clientRef, envelopeId) => this.handleAck(clientRef, envelopeId),
        onStatus: (envelopeId, status) => this.handleStatus(envelopeId, status),
        onOpen: () => {
          this.reconnectAttempt = 0;
          this.setConnectionState("connected");
        },
        onClose: () => this.handleSocketClosed(),
      },
    );
    try {
      await this.relay.connect();
    } catch (err) {
      // Initial connect failed: drop the dead socket and start retrying.
      this.relay = null;
      this.setConnectionState("offline");
      this.scheduleReconnect();
      throw err;
    }
    this.setConnectionState("connected");
    // Re-assert our push token on every (re)connect so the relay can wake us.
    if (this.pushToken) this.relay.registerPush(this.pushToken);
  }

  /** Current relay socket state. */
  get connectionState(): ConnectionState {
    return this.connState;
  }

  /** Subscribe to connection-state changes; returns an unsubscribe fn. Fires once
   *  immediately with the current state so late subscribers are in sync. */
  onConnectionChange(handler: ConnectionHandler): () => void {
    this.connectionHandlers.push(handler);
    handler(this.connState);
    return () => {
      const i = this.connectionHandlers.indexOf(handler);
      if (i >= 0) this.connectionHandlers.splice(i, 1);
    };
  }

  private setConnectionState(state: ConnectionState): void {
    if (this.connState === state) return;
    this.connState = state;
    for (const h of this.connectionHandlers) h(state);
  }

  /** The socket dropped: reflect it and (unless we closed on purpose) reconnect. */
  private handleSocketClosed(): void {
    this.relay = null;
    if (this.intentionalClose) return;
    this.setConnectionState("offline");
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.intentionalClose || !this.userId) return;
    const delay =
      RECONNECT_BACKOFF_MS[Math.min(this.reconnectAttempt, RECONNECT_BACKOFF_MS.length - 1)]!;
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      // connectRelay reschedules itself on failure, so a bad attempt just retries.
      void this.connectRelay().catch(() => {});
    }, delay);
  }

  /** Look up a contact by phone number (salted-hash intersection). */
  async findContact(phoneNumber: string): Promise<string | null> {
    const salt = await this.discovery.getSalt();
    const hash = await hashPhone(salt, phoneNumber);
    const matches = await this.discovery.intersect([hash]);
    return matches[0]?.userId ?? null;
  }

  /**
   * Bulk contact discovery: hash a set of (already-normalized, E.164) phone
   * numbers with the server salt and intersect in one round-trip. Returns the
   * numbers that map to a registered account, paired with their user id. The
   * server only ever confirms hashes we already hold — it never learns the
   * numbers that didn't match.
   */
  async discoverContacts(
    phoneNumbers: string[],
  ): Promise<{ phoneNumber: string; userId: string }[]> {
    const unique = [...new Set(phoneNumbers)];
    if (unique.length === 0) return [];
    const salt = await this.discovery.getSalt();
    // Map each hash back to its number (a hash is deterministic per salt).
    const hashToPhone = new Map<string, string>();
    for (const phone of unique) {
      hashToPhone.set(await hashPhone(salt, phone), phone);
    }
    const matches = await this.discovery.intersect([...hashToPhone.keys()]);
    const out: { phoneNumber: string; userId: string }[] = [];
    for (const m of matches) {
      const phoneNumber = hashToPhone.get(m.phoneHashB64);
      if (phoneNumber) out.push({ phoneNumber, userId: m.userId });
    }
    return out;
  }

  /**
   * Encrypt and send a text to a peer, establishing a session on first use.
   * Returns a `clientRef` that correlates later status updates (sent →
   * delivered → read) back to this message; pass one in to reuse your own id.
   */
  async sendText(peerUserId: string, text: string, clientRef?: string): Promise<string> {
    if (!this.relay || !this.userId) throw new Error("not connected");
    const ref = clientRef ?? newClientRef();
    const peerDevice = await this.ensureSession(peerUserId);
    const enc = await this.crypto.encrypt(peerUserId, peerDevice, text);
    this.relay.sendEnvelope(
      {
        recipientId: peerUserId,
        recipientDevice: peerDevice,
        senderId: this.userId, // relay overrides with the authenticated value
        senderDevice: this.deviceId,
        type: enc.type,
        ciphertext: enc.ciphertextB64,
        timestamp: Date.now(),
      },
      ref,
    );
    return ref;
  }

  /** Acknowledge a received message as read, notifying its sender. */
  sendReadReceipt(peerUserId: string, envelopeId: string): void {
    if (!this.relay) return;
    const device = this.peerDevice.get(peerUserId) ?? 1;
    this.relay.sendReadReceipt(envelopeId, peerUserId, device);
  }

  /**
   * Register this device's push token with the relay so it can be woken by a
   * content-free push when a message arrives while offline. The token is
   * remembered and re-sent on every relay (re)connect.
   */
  registerPushToken(token: string): void {
    this.pushToken = token;
    this.relay?.registerPush(token);
  }

  onText(handler: TextHandler): void {
    this.textHandlers.push(handler);
  }

  /** Subscribe to outbound message status changes (sent/delivered/read). */
  onMessageStatus(handler: MessageStatusHandler): void {
    this.statusHandlers.push(handler);
  }

  close(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.relay?.close();
    this.relay = null;
    this.setConnectionState("offline");
  }

  // --- internals ---

  /** Fetch a peer's bundle and establish an outbound session, once per peer. */
  private async ensureSession(peerUserId: string): Promise<number> {
    const known = this.peerDevice.get(peerUserId);
    if (known !== undefined) return known;
    const bundle = await this.discovery.fetchBundle(peerUserId);
    await this.crypto.establishSession(peerUserId, bundle.deviceId, bundle);
    this.peerDevice.set(peerUserId, bundle.deviceId);
    return bundle.deviceId;
  }

  private async handleDeliver(env: Envelope): Promise<void> {
    const text = await this.crypto.decrypt(env.senderId, env.senderDevice, {
      type: env.type,
      ciphertextB64: env.ciphertext,
    });
    // Learn the peer's device from the inbound message so replies can route
    // without a fresh bundle fetch (the responder side of X3DH completed here).
    if (!this.peerDevice.has(env.senderId)) {
      this.peerDevice.set(env.senderId, env.senderDevice);
    }
    // Tier-0 on-device scam detection over the decrypted plaintext (Phase 2
    // swaps the heuristic for the ONNX classifier behind the same seam).
    const verdict = this.scamDetector.analyze(text);
    const msg: IncomingText = {
      fromUserId: env.senderId,
      fromDevice: env.senderDevice,
      text,
      receivedAt: Date.now(),
      envelopeId: env.id,
      verdict,
    };
    for (const handler of this.textHandlers) handler(msg);
  }

  /** Relay accepted our message: correlate clientRef ↔ envelope, mark "sent". */
  private handleAck(clientRef: string | undefined, envelopeId: string): void {
    if (!clientRef) return;
    this.refToEnvelope.set(clientRef, envelopeId);
    this.envelopeToRef.set(envelopeId, clientRef);
    this.emitStatus(clientRef, "sent");
  }

  /** Recipient reported delivered/read for one of our messages. */
  private handleStatus(envelopeId: string, status: MessageStatus): void {
    const clientRef = this.envelopeToRef.get(envelopeId);
    if (clientRef) this.emitStatus(clientRef, status);
  }

  private emitStatus(clientRef: string, status: MessageStatus): void {
    for (const handler of this.statusHandlers) handler({ clientRef, status });
  }
}

/** A short, collision-resistant correlation id for an outbound message. */
function newClientRef(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Salted phone hash matching the Go server: base64(sha256(salt || phone)).
 * Uses the bundled SHA-256 (see ./sha256.ts) instead of Web Crypto, since
 * `crypto.subtle` is absent in React Native's Hermes engine — keeps the core
 * portable across Node, RN, and browsers.
 */
export async function hashPhone(saltB64: string, phone: string): Promise<string> {
  const salt = base64ToBytes(saltB64);
  const phoneBytes = utf8Encode(phone);
  const input = new Uint8Array(salt.length + phoneBytes.length);
  input.set(salt, 0);
  input.set(phoneBytes, salt.length);
  return bytesToBase64(sha256(input));
}

/** UTF-8 encode without relying on a global TextEncoder. */
function utf8Encode(str: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code >= 0xd800 && code <= 0xdbff) {
      // surrogate pair
      const lo = str.charCodeAt(++i);
      code = 0x10000 + ((code & 0x3ff) << 10) + (lo & 0x3ff);
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    } else {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return new Uint8Array(bytes);
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob === "function") {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, "base64"));
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof btoa === "function") {
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  }
  return Buffer.from(bytes).toString("base64");
}
