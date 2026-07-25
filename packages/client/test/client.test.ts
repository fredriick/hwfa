/**
 * Headless integration test for the portable client core.
 *
 * Spins up the real Go relay + Discovery services and drives two `HwfaClient`s
 * (each with a Node/libsignal crypto provider) through the whole flow: onboard,
 * discover a contact by phone, send an E2EE text, receive + decrypt a reply.
 * This is the Phase 1 discovery handshake, but exercised through the same
 * `@hwfa/client` API the React Native app consumes — so the app's networking +
 * session orchestration is proven with no device in the loop.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { HwfaClient, type IncomingText } from "../src/index.js";
import { NodeCryptoProvider } from "../src/node/index.js";

const RELAY_PORT = 8092;
const DISCOVERY_PORT = 8093;
const RELAY_URL = `ws://localhost:${RELAY_PORT}/v1/relay`;
const DISCOVERY_URL = `http://[::1]:${DISCOVERY_PORT}`;
const ALICE_PHONE = "+2348020000001";
const BOB_PHONE = "+2348020000002";

const here = path.dirname(fileURLToPath(import.meta.url));
const relayDir = path.resolve(here, "../../../backend/relay");
const discoveryDir = path.resolve(here, "../../../backend/discovery");
const exe = (n: string) => (process.platform === "win32" ? `${n}.exe` : n);

function buildGo(dir: string, binName: string): string {
  const build = spawnSync("go", ["build", "-o", binName, "."], { cwd: dir, stdio: "inherit" });
  if (build.status !== 0) throw new Error(`go build failed in ${dir}`);
  return path.join(dir, binName);
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

async function startService(
  binPath: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  probeHost: string,
  port: number,
): Promise<ChildProcess> {
  const proc = spawn(binPath, [], {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "inherit", "inherit"],
  });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await tcpProbe(probeHost, port, 800)) return proc;
    await sleep(200);
  }
  proc.kill();
  throw new Error(`service ${binPath} did not start in time`);
}

/** Wait until `cond` is true or throw after `timeoutMs`. */
async function until(cond: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return;
    await sleep(25);
  }
  throw new Error("condition not met in time");
}

test("HwfaClient: onboard, discover, and exchange E2EE texts through the real services", async (t) => {
  const relayBin = buildGo(relayDir, exe("relay-spike"));
  const discoveryBin = buildGo(discoveryDir, exe("discovery-spike"));

  const relay = await startService(relayBin, relayDir, { RELAY_ADDR: `:${RELAY_PORT}` }, "localhost", RELAY_PORT);
  const discovery = await startService(
    discoveryBin,
    discoveryDir,
    { DISCOVERY_ADDR: `:${DISCOVERY_PORT}`, DISCOVERY_DEV: "1" },
    "::1",
    DISCOVERY_PORT,
  );

  const opts = { discoveryUrl: DISCOVERY_URL, relayUrl: RELAY_URL, webSocketCtor: WebSocket as unknown as any };
  const alice = new HwfaClient({ ...opts, crypto: new NodeCryptoProvider() });
  const bob = new HwfaClient({ ...opts, crypto: new NodeCryptoProvider() });

  const bobInbox: IncomingText[] = [];
  const aliceInbox: IncomingText[] = [];
  bob.onText((m) => bobInbox.push(m));
  alice.onText((m) => aliceInbox.push(m));
  const aliceStatus = new Map<string, string>();
  alice.onMessageStatus((u) => aliceStatus.set(u.clientRef, u.status));

  t.after(() => {
    alice.close();
    bob.close();
    relay.kill();
    discovery.kill();
  });

  // 1) Both onboard (register + verify + relay connect).
  const aliceId = await alice.onboard(ALICE_PHONE);
  const bobId = await bob.onboard(BOB_PHONE);
  assert.ok(aliceId && bobId && aliceId !== bobId, "distinct account ids issued");

  // 2) Alice discovers Bob by phone number (salted-hash intersection).
  const found = await alice.findContact(BOB_PHONE);
  assert.equal(found, bobId, "findContact resolves Bob's phone to his account id");
  const stranger = await alice.findContact("+2340000000000");
  assert.equal(stranger, null, "an unregistered number resolves to nobody");

  // 3) Alice → Bob, E2EE through the relay.
  const ref1 = await alice.sendText(bobId, "Hello from the client core 🔐");
  await until(() => bobInbox.length === 1);
  assert.equal(bobInbox[0]!.text, "Hello from the client core 🔐", "Bob decrypts Alice's message");

  // 3a) Receipts: Bob's client auto-confirms delivery; Alice sees "delivered".
  await until(() => aliceStatus.get(ref1) === "delivered");
  assert.equal(aliceStatus.get(ref1), "delivered", "Alice sees Bob's delivery receipt");

  // 3b) Bob reads the message → Alice sees "read".
  bob.sendReadReceipt(bobInbox[0]!.fromUserId, bobInbox[0]!.envelopeId);
  await until(() => aliceStatus.get(ref1) === "read");
  assert.equal(aliceStatus.get(ref1), "read", "Alice sees Bob's read receipt");

  // 4) Bob → Alice reply (bidirectional ratchet), no fresh bundle fetch needed.
  await bob.sendText(aliceId, "Got it, ratchet works ✅");
  await until(() => aliceInbox.length === 1);
  assert.equal(aliceInbox[0]!.text, "Got it, ratchet works ✅", "Alice decrypts Bob's reply");
});
