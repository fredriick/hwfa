/**
 * Run the demo backend: the Go relay on :8090 and Discovery on :8091 — the same
 * ports the mobile app expects (see apps/mobile/src/config.ts; the Android
 * emulator reaches them via 10.0.2.2). Builds both binaries, starts them with
 * the dev-OTP path enabled, and streams their logs. Ctrl-C stops both.
 *
 *   npm run demo:backend -w @hwfa/client
 *
 * DISCOVERY_DEV=1 enables the accept-any-OTP onboarding path. It is for local
 * demos ONLY and must never be set in production.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const RELAY_PORT = 8090;
const DISCOVERY_PORT = 8091;

const here = path.dirname(fileURLToPath(import.meta.url));
const relayDir = path.resolve(here, "../../../backend/relay");
const discoveryDir = path.resolve(here, "../../../backend/discovery");
const exe = (n: string) => (process.platform === "win32" ? `${n}.exe` : n);

function buildGo(dir: string, binName: string): string {
  process.stdout.write(`building ${binName} …\n`);
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

async function start(
  binPath: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  port: number,
): Promise<ChildProcess> {
  const proc = spawn(binPath, [], {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "inherit", "inherit"],
  });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await tcpProbe("localhost", port, 800)) return proc;
    await sleep(200);
  }
  proc.kill();
  throw new Error(`service ${binPath} did not open :${port} in time`);
}

async function main(): Promise<void> {
  const relayBin = buildGo(relayDir, exe("relay-demo"));
  const discoveryBin = buildGo(discoveryDir, exe("discovery-demo"));

  const relay = await start(relayBin, relayDir, { RELAY_ADDR: `:${RELAY_PORT}` }, RELAY_PORT);
  const discovery = await start(
    discoveryBin,
    discoveryDir,
    { DISCOVERY_ADDR: `:${DISCOVERY_PORT}`, DISCOVERY_DEV: "1" },
    DISCOVERY_PORT,
  );

  process.stdout.write(
    `\n\x1b[32m✓ backend up\x1b[0m\n` +
      `  relay:     ws://localhost:${RELAY_PORT}/v1/relay   (emulator: ws://10.0.2.2:${RELAY_PORT}/v1/relay)\n` +
      `  discovery: http://localhost:${DISCOVERY_PORT}       (emulator: http://10.0.2.2:${DISCOVERY_PORT})\n` +
      `  \x1b[33mDISCOVERY_DEV=1 (dev OTP) — local demo only\x1b[0m\n\n` +
      `Ctrl-C to stop.\n\n`,
  );

  const shutdown = () => {
    relay.kill();
    discovery.kill();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  relay.on("exit", shutdown);
  discovery.on("exit", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
