/**
 * PHASE 0 EXIT GATE (headless).
 *
 * "Two React Native instances on two physical devices exchanging a real E2EE
 *  encrypted message through your Go relay. Nothing else matters until this
 *  works." — build spec, Phase 0.
 *
 * This is the CI-runnable form of that gate: two independent libsignal clients
 * (Alice, Bob), each with their own identity + stores, exchange real Signal
 * Protocol ciphertext through the actual Go relay binary over WebSocket. The
 * relay only ever sees opaque envelopes. We assert:
 *   1. Live delivery: Alice → relay → Bob, decrypts to the original plaintext.
 *   2. Bidirectional ratchet: Bob → relay → Alice.
 *   3. Store-and-forward: message sent while Bob is offline is delivered on
 *      reconnect.
 *
 * Run: npm run spike   (from repo root, or -w @hwfa/crypto)
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
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
} from "../src/index.js";

const ALICE = "11111111-1111-1111-1111-111111111111";
const BOB = "22222222-2222-2222-2222-222222222222";
const PORT = 8090;
// Use "localhost" (resolves to ::1 here) rather than 127.0.0.1: some Windows
// setups run a loopback HTTP interceptor on IPv4 that mangles the WebSocket
// Upgrade handshake (returns 501). The Go relay listens dual-stack on :PORT.
const HOST = "localhost";
const RELAY_URL = `ws://${HOST}:${PORT}/v1/relay`;

const here = path.dirname(fileURLToPath(import.meta.url));
const relayDir = path.resolve(here, "../../../backend/relay");

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

/** A thin relay client for one device. */
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

  /** Wait for the next message of a given kind, ignoring others (e.g. acks). */
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

async function startRelay(): Promise<ChildProcess> {
  // Build the binary once (fast + cached), then run it directly. `go run`
  // re-links on every invocation, which under Windows AV can exceed the
  // health-check window; a prebuilt binary starts in well under a second.
  const binName = process.platform === "win32" ? "relay-spike.exe" : "relay-spike";
  const build = spawnSync("go", ["build", "-o", binName, "."], {
    cwd: relayDir,
    stdio: "inherit",
  });
  if (build.status !== 0) throw new Error("go build failed");

  const binPath = path.join(relayDir, binName);
  const proc = spawn(binPath, [], {
    cwd: relayDir,
    env: { ...process.env, RELAY_ADDR: `:${PORT}` },
    stdio: ["ignore", "inherit", "inherit"],
  });

  // Wait for the listener with a raw TCP probe. Each attempt has its own short
  // timeout so a stalled connection can't block past the deadline (an HTTP
  // health check can hang on a loopback interceptor; a TCP SYN can't).
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await tcpProbe(HOST, PORT, 800)) return proc;
    await sleep(200);
  }
  throw new Error("relay did not start in time");
}

/** Resolve true if a TCP connection to host:port completes within timeoutMs. */
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
      senderId: fromClient.userId, // authoritative value is set by the relay
      senderDevice: from.deviceId,
      type: enc.type,
      ciphertext: enc.ciphertextB64,
      timestamp: Date.now(),
    },
  });
}

async function main(): Promise<void> {
  console.log("→ starting Go relay…");
  const relay = await startRelay();

  try {
    // Each side generates identity + prekeys, exactly as onboarding would.
    const alice = generateRegistration({ deviceId: 1 });
    const bob = generateRegistration({ deviceId: 1 });

    // Alice fetches Bob's published bundle (here in-process; in Phase 1 this is
    // GET /v1/keys/{bob}) and establishes an outbound session.
    await establishSession(alice.stores, BOB, bob.deviceId, bob.publishedBundle);

    const aliceClient = new RelayClient(ALICE, alice.deviceId);
    const bobClient = new RelayClient(BOB, bob.deviceId);
    await aliceClient.connect();
    await bobClient.connect();

    // 1) Live delivery: Alice → relay → Bob.
    console.log("→ [1] Alice sends 'Hello Bob 👋' through the relay…");
    await sendMessage(alice, aliceClient, BOB, bob.deviceId, "Hello Bob 👋");
    const d1 = await bobClient.next("deliver");
    assert(d1.kind === "deliver" && d1.envelope, "Bob got a deliver");
    const p1 = await decrypt(bob.stores, d1.envelope.senderId, d1.envelope.senderDevice, {
      type: d1.envelope.type,
      ciphertextB64: d1.envelope.ciphertext,
    });
    console.log(`   Bob decrypted: "${p1}"`);
    assert(p1 === "Hello Bob 👋", "plaintext round-trips");

    // 2) Bidirectional ratchet: Bob → relay → Alice.
    console.log("→ [2] Bob replies 'Got it, Alice ✅'…");
    await sendMessage(bob, bobClient, ALICE, alice.deviceId, "Got it, Alice ✅");
    const d2 = await aliceClient.next("deliver");
    assert(d2.kind === "deliver" && d2.envelope, "Alice got a deliver");
    const p2 = await decrypt(alice.stores, d2.envelope.senderId, d2.envelope.senderDevice, {
      type: d2.envelope.type,
      ciphertextB64: d2.envelope.ciphertext,
    });
    console.log(`   Alice decrypted: "${p2}"`);
    assert(p2 === "Got it, Alice ✅", "reply round-trips");

    // 3) Store-and-forward: Bob disconnects, Alice sends, Bob reconnects.
    console.log("→ [3] Bob goes offline; Alice sends while he's away…");
    bobClient.close();
    await sleep(200);
    await sendMessage(alice, aliceClient, BOB, bob.deviceId, "You were offline 📴");
    await sleep(200);
    const bobAgain = new RelayClient(BOB, bob.deviceId);
    await bobAgain.connect();
    const d3 = await bobAgain.next("deliver");
    assert(d3.kind === "deliver" && d3.envelope, "queued message delivered on reconnect");
    const p3 = await decrypt(bob.stores, d3.envelope.senderId, d3.envelope.senderDevice, {
      type: d3.envelope.type,
      ciphertextB64: d3.envelope.ciphertext,
    });
    console.log(`   Bob (reconnected) decrypted: "${p3}"`);
    assert(p3 === "You were offline 📴", "store-and-forward round-trips");

    aliceClient.close();
    bobAgain.close();

    console.log("\n✅ PHASE 0 EXIT GATE PASSED");
    console.log("   Real E2EE messages flowed client → Go relay → client,");
    console.log("   in both directions and through offline store-and-forward.");
    console.log("   The relay saw only opaque ciphertext envelopes.");
  } finally {
    relay.kill();
  }
}

main().catch((err) => {
  console.error("\n❌ PHASE 0 EXIT GATE FAILED\n", err);
  process.exitCode = 1;
});
