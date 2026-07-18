/**
 * PHASE 1 — DISCOVERY HANDSHAKE (headless integration test).
 *
 * Phase 0 proved E2EE through the relay, but Alice got Bob's key bundle
 * *in-process*. This proves the missing half: the bundle exchange happens
 * OVER THE WIRE through the real Discovery service. The full flow:
 *
 *   1. Alice & Bob each register a phone number + upload their public key
 *      material to Discovery, then verify via OTP (stubbed SMS → dev OTP).
 *   2. Alice fetches Bob's published bundle: GET /v1/keys/{bobUserId}.
 *   3. Alice establishes an X3DH session from that fetched bundle.
 *   4. Alice sends a real E2EE message through the relay; Bob decrypts it.
 *   5. Bob replies (bidirectional ratchet), still end-to-end encrypted.
 *   6. Contact discovery: Alice finds Bob by a salted hash of his phone
 *      number via POST /v1/contacts/intersect — the server never sees the
 *      raw number.
 *
 * Neither backend ever sees plaintext or private keys. Discovery sees only
 * public bundles + salted phone hashes; the relay sees only opaque envelopes.
 *
 * Run: npm run spike:discovery   (from repo root, or -w @hwfa/crypto)
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import crypto from "node:crypto";
import net from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import type { RelayMessage } from "@hwfa/models";
import {
  decrypt,
  encrypt,
  establishSession,
  generateRegistration,
  type DeviceRegistration,
  type PublishedKeyBundle,
} from "../src/index.js";

const RELAY_PORT = 8090;
const DISCOVERY_PORT = 8091;
// WebSocket to the relay goes via "localhost" (resolves to ::1 here); some
// Windows setups run a loopback HTTP interceptor on IPv4 that mangles the
// Upgrade handshake. HTTP to Discovery uses the explicit IPv6 literal for the
// same reason — deterministic, no DNS-ordering surprises.
const RELAY_URL = `ws://localhost:${RELAY_PORT}/v1/relay`;
const DISCOVERY_URL = `http://[::1]:${DISCOVERY_PORT}`;

const ALICE_PHONE = "+2348010000001";
const BOB_PHONE = "+2348010000002";

const here = path.dirname(fileURLToPath(import.meta.url));
const relayDir = path.resolve(here, "../../../backend/relay");
const discoveryDir = path.resolve(here, "../../../backend/discovery");

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

// --- Discovery HTTP client (the client half of the API) ---

class DiscoveryClient {
  private token: string | null = null;

  private async post<T>(pathname: string, body: unknown, auth = false): Promise<T> {
    const res = await fetch(`${DISCOVERY_URL}${pathname}`, {
      method: "POST",
      headers: this.headers(auth),
      body: JSON.stringify(body),
    });
    return this.parse<T>(res, pathname);
  }

  private async put<T>(pathname: string, body: unknown): Promise<T> {
    const res = await fetch(`${DISCOVERY_URL}${pathname}`, {
      method: "PUT",
      headers: this.headers(true),
      body: JSON.stringify(body),
    });
    return this.parse<T>(res, pathname);
  }

  private async get<T>(pathname: string): Promise<T> {
    const res = await fetch(`${DISCOVERY_URL}${pathname}`, { headers: this.headers(true) });
    return this.parse<T>(res, pathname);
  }

  private headers(auth: boolean): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (auth && this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }

  private async parse<T>(res: Response, pathname: string): Promise<T> {
    if (!res.ok) throw new Error(`${pathname} → ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }

  /** Register + verify a device, keeping the returned bearer token. */
  async onboard(reg: DeviceRegistration, phoneNumber: string): Promise<string> {
    const regResp = await this.post<{ userId: string; devOtp?: string }>(
      "/v1/accounts/register",
      // publishedBundle already carries deviceId + registrationId + the public
      // key material; add the phone number and the full one-time prekey pool.
      { phoneNumber, ...reg.publishedBundle, oneTimePreKeys: reg.oneTimePreKeys },
    );
    assert(regResp.devOtp, "dev OTP returned (DISCOVERY_DEV=1)");
    const verifyResp = await this.post<{ verified: boolean; token: string }>(
      "/v1/accounts/verify",
      { userId: regResp.userId, code: regResp.devOtp },
    );
    assert(verifyResp.verified && verifyResp.token, "verification issued a token");
    this.token = verifyResp.token;
    return regResp.userId;
  }

  fetchBundle(userId: string): Promise<PublishedKeyBundle> {
    return this.get<PublishedKeyBundle>(`/v1/keys/${userId}`);
  }

  getSalt(): Promise<{ saltB64: string }> {
    return this.get<{ saltB64: string }>("/v1/contacts/salt");
  }

  intersect(phoneHashesB64: string[]): Promise<{ matches: { phoneHashB64: string; userId: string }[] }> {
    return this.post("/v1/contacts/intersect", { phoneHashesB64 }, true);
  }
}

/** Reproduce the server's salted phone hash: base64(sha256(salt || phone)). */
function hashPhone(saltB64: string, phone: string): string {
  return crypto
    .createHash("sha256")
    .update(Buffer.from(saltB64, "base64"))
    .update(Buffer.from(phone, "utf8"))
    .digest("base64");
}

// --- Relay client (same thin wrapper as the Phase 0 spike) ---

class RelayClient {
  private ws!: WebSocket;
  private inbox: RelayMessage[] = [];
  private waiters: ((m: RelayMessage) => void)[] = [];

  constructor(
    readonly userId: string,
    readonly deviceId: number,
  ) {}

  async connect(): Promise<void> {
    this.ws = new WebSocket(`${RELAY_URL}?userId=${this.userId}&deviceId=${this.deviceId}`);
    this.ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as RelayMessage;
      const waiter = this.waiters.shift();
      if (waiter) waiter(msg);
      else this.inbox.push(msg);
    });
    await once(this.ws, "open");
  }

  send(msg: RelayMessage): void {
    this.ws.send(JSON.stringify(msg));
  }

  async next(kind: RelayMessage["kind"], timeoutMs = 3000): Promise<RelayMessage> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const queued = this.inbox.findIndex((m) => m.kind === kind);
      if (queued >= 0) return this.inbox.splice(queued, 1)[0]!;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`timed out waiting for ${kind}`);
      const msg = await Promise.race([
        new Promise<RelayMessage>((res) => this.waiters.push(res)),
        sleep(remaining, null as unknown as RelayMessage),
      ]);
      if (msg === null) throw new Error(`timed out waiting for ${kind}`);
      if (msg.kind === kind) return msg;
      this.inbox.push(msg);
    }
  }

  close(): void {
    this.ws.close();
  }
}

// --- process management ---

function buildGo(dir: string, binName: string): string {
  const build = spawnSync("go", ["build", "-o", binName, "."], { cwd: dir, stdio: "inherit" });
  if (build.status !== 0) throw new Error(`go build failed in ${dir}`);
  return path.join(dir, binName);
}

async function startService(
  binPath: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  probeHost: string,
  port: number,
): Promise<ChildProcess> {
  const proc = spawn(binPath, [], { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "inherit", "inherit"] });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await tcpProbe(probeHost, port, 800)) return proc;
    await sleep(200);
  }
  throw new Error(`service ${binPath} did not start in time`);
}

function tcpProbe(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    const done = (ok: boolean) => {
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => done(true));
    sock.once("timeout", () => done(false));
    sock.once("error", () => done(false));
  });
}

async function sendMessage(
  from: DeviceRegistration,
  fromClient: RelayClient,
  toUserId: string,
  toDeviceId: number,
  plaintext: string,
): Promise<void> {
  const enc = await encrypt(from.stores, toUserId, toDeviceId, plaintext);
  fromClient.send({
    kind: "send",
    envelope: {
      recipientId: toUserId,
      recipientDevice: toDeviceId,
      senderId: fromClient.userId, // relay overrides with the authenticated value
      senderDevice: from.deviceId,
      type: enc.type,
      ciphertext: enc.ciphertextB64,
      timestamp: Date.now(),
    },
  });
}

async function main(): Promise<void> {
  console.log("→ building + starting Discovery and relay…");
  const relayBin = buildGo(relayDir, process.platform === "win32" ? "relay-spike.exe" : "relay-spike");
  const discoveryBin = buildGo(discoveryDir, process.platform === "win32" ? "discovery-spike.exe" : "discovery-spike");

  const relay = await startService(relayBin, relayDir, { RELAY_ADDR: `:${RELAY_PORT}` }, "localhost", RELAY_PORT);
  const discovery = await startService(
    discoveryBin,
    discoveryDir,
    { DISCOVERY_ADDR: `:${DISCOVERY_PORT}`, DISCOVERY_DEV: "1" },
    "::1",
    DISCOVERY_PORT,
  );

  try {
    // Each side mints identity + prekeys, exactly as onboarding would.
    const alice = generateRegistration({ deviceId: 1 });
    const bob = generateRegistration({ deviceId: 1 });

    // 1) Register + verify both through the real Discovery service.
    console.log("→ [1] Alice & Bob register + verify via Discovery…");
    const aliceApi = new DiscoveryClient();
    const bobApi = new DiscoveryClient();
    const aliceId = await aliceApi.onboard(alice, ALICE_PHONE);
    const bobId = await bobApi.onboard(bob, BOB_PHONE);
    console.log(`   Alice=${aliceId.slice(0, 8)}…  Bob=${bobId.slice(0, 8)}…`);

    // 2) Alice fetches Bob's bundle OVER THE WIRE (no in-process shortcut).
    console.log("→ [2] Alice fetches Bob's key bundle from Discovery…");
    const bobBundle = await aliceApi.fetchBundle(bobId);
    assert(bobBundle.identityKeyB64 === bob.publishedBundle.identityKeyB64, "fetched Bob's real identity key");
    assert(bobBundle.oneTimePreKeyId !== null, "Discovery handed out a one-time prekey");

    // 3) Establish the X3DH session from the fetched bundle.
    console.log("→ [3] Alice establishes an X3DH session from the fetched bundle…");
    await establishSession(alice.stores, bobId, bobBundle.deviceId, bobBundle);

    // 4) Connect to the relay under the Discovery-assigned user ids and send.
    const aliceClient = new RelayClient(aliceId, alice.deviceId);
    const bobClient = new RelayClient(bobId, bob.deviceId);
    await aliceClient.connect();
    await bobClient.connect();

    console.log("→ [4] Alice sends 'Hello over the wire 🔐' through the relay…");
    await sendMessage(alice, aliceClient, bobId, bobBundle.deviceId, "Hello over the wire 🔐");
    const d1 = await bobClient.next("deliver");
    assert(d1.kind === "deliver" && d1.envelope, "Bob got a deliver");
    const p1 = await decrypt(bob.stores, d1.envelope.senderId, d1.envelope.senderDevice, {
      type: d1.envelope.type,
      ciphertextB64: d1.envelope.ciphertext,
    });
    console.log(`   Bob decrypted: "${p1}"`);
    assert(p1 === "Hello over the wire 🔐", "plaintext round-trips");

    // 5) Bidirectional ratchet: Bob replies.
    console.log("→ [5] Bob replies 'Received, key exchange worked ✅'…");
    await sendMessage(bob, bobClient, aliceId, alice.deviceId, "Received, key exchange worked ✅");
    const d2 = await aliceClient.next("deliver");
    assert(d2.kind === "deliver" && d2.envelope, "Alice got a deliver");
    const p2 = await decrypt(alice.stores, d2.envelope.senderId, d2.envelope.senderDevice, {
      type: d2.envelope.type,
      ciphertextB64: d2.envelope.ciphertext,
    });
    console.log(`   Alice decrypted: "${p2}"`);
    assert(p2 === "Received, key exchange worked ✅", "reply round-trips");

    // 6) Privacy-preserving contact discovery: Alice finds Bob by hashed phone.
    console.log("→ [6] Alice discovers Bob via salted-hash contact intersection…");
    const { saltB64 } = await aliceApi.getSalt();
    const bobHash = hashPhone(saltB64, BOB_PHONE);
    const strangerHash = hashPhone(saltB64, "+2340000000000");
    const { matches } = await aliceApi.intersect([bobHash, strangerHash]);
    assert(matches.length === 1, "exactly one contact matched");
    assert(matches[0]!.userId === bobId, "matched contact resolves to Bob's userId");
    console.log(`   matched 1 of 2 contacts → Bob (${matches[0]!.userId.slice(0, 8)}…)`);

    aliceClient.close();
    bobClient.close();

    console.log("\n✅ PHASE 1 DISCOVERY HANDSHAKE PASSED");
    console.log("   Key bundles were exchanged over the wire through Discovery,");
    console.log("   a real X3DH session was established from the fetched bundle,");
    console.log("   E2EE messages flowed both ways through the relay, and contact");
    console.log("   discovery matched by salted hash — no plaintext or private keys");
    console.log("   ever reached either backend.");
  } finally {
    relay.kill();
    discovery.kill();
  }
}

main().catch((err) => {
  console.error("\n❌ PHASE 1 DISCOVERY HANDSHAKE FAILED\n", err);
  process.exitCode = 1;
});
