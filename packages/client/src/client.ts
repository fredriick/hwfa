/**
 * HwfaClient — the one façade the app talks to.
 *
 * Ties together onboarding (Discovery), the live relay socket, and the crypto
 * provider into a small conversation API: onboard, send a text, receive texts.
 * All key material stays inside the injected `CryptoProvider`; this class only
 * moves ids, ciphertext, and plaintext between the provider and the network.
 */
import type { Envelope } from "@hwfa/models";
import { DiscoveryClient, type FetchLike } from "./discovery.js";
import { RelayConnection, type WebSocketCtor } from "./relay.js";
import type { CryptoProvider } from "./crypto-provider.js";
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
}

/** A decrypted inbound text handed to the app. */
export interface IncomingText {
  fromUserId: string;
  fromDevice: number;
  text: string;
  receivedAt: number;
}

export type TextHandler = (msg: IncomingText) => void;

export class HwfaClient {
  private readonly discovery: DiscoveryClient;
  private readonly crypto: CryptoProvider;
  private readonly relayUrl: string;
  private readonly webSocketCtor: WebSocketCtor;

  private relay: RelayConnection | null = null;
  private userId: string | null = null;
  private deviceId = 1;

  /** Peers we already have an outbound session with, and their device id. */
  private readonly peerDevice = new Map<string, number>();
  private readonly textHandlers: TextHandler[] = [];

  constructor(opts: HwfaClientOptions) {
    this.discovery = new DiscoveryClient(opts.discoveryUrl, opts.fetchImpl ?? fetch);
    this.crypto = opts.crypto;
    this.relayUrl = opts.relayUrl;
    this.webSocketCtor = opts.webSocketCtor;
  }

  /** Our Discovery-assigned account id, once onboarded. */
  get accountId(): string | null {
    return this.userId;
  }

  /**
   * Full onboarding: mint keys, register + verify the phone number with
   * Discovery (dev-OTP path), then open the live relay socket. Returns our id.
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

  /** Open (or reuse) the relay socket under our onboarded identity. */
  async connectRelay(): Promise<void> {
    if (!this.userId) throw new Error("onboard() before connecting the relay");
    if (this.relay) return;
    this.relay = new RelayConnection(
      this.relayUrl,
      this.userId,
      this.deviceId,
      this.webSocketCtor,
      (env) => void this.handleDeliver(env),
    );
    await this.relay.connect();
  }

  /** Look up a contact by phone number (salted-hash intersection). */
  async findContact(phoneNumber: string): Promise<string | null> {
    const salt = await this.discovery.getSalt();
    const hash = await hashPhone(salt, phoneNumber);
    const matches = await this.discovery.intersect([hash]);
    return matches[0]?.userId ?? null;
  }

  /** Encrypt and send a text to a peer, establishing a session on first use. */
  async sendText(peerUserId: string, text: string): Promise<void> {
    if (!this.relay || !this.userId) throw new Error("not connected");
    const peerDevice = await this.ensureSession(peerUserId);
    const enc = await this.crypto.encrypt(peerUserId, peerDevice, text);
    this.relay.sendEnvelope({
      recipientId: peerUserId,
      recipientDevice: peerDevice,
      senderId: this.userId, // relay overrides with the authenticated value
      senderDevice: this.deviceId,
      type: enc.type,
      ciphertext: enc.ciphertextB64,
      timestamp: Date.now(),
    });
  }

  onText(handler: TextHandler): void {
    this.textHandlers.push(handler);
  }

  close(): void {
    this.relay?.close();
    this.relay = null;
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
    const msg: IncomingText = {
      fromUserId: env.senderId,
      fromDevice: env.senderDevice,
      text,
      receivedAt: Date.now(),
    };
    for (const handler of this.textHandlers) handler(msg);
  }
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
