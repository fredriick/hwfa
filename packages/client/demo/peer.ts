/**
 * Interactive demo peer — a second E2EE account you drive from the terminal.
 *
 * It onboards through the exact same `@hwfa/client` API the React Native app
 * uses (with the Node/libsignal `CryptoProvider`), connects to the running relay
 * + Discovery services, and gives you a small chat prompt. Point the emulator
 * app at the same backend and the two can exchange real end-to-end-encrypted
 * messages: keys are minted on each side, X3DH/PQXDH runs on first contact, and
 * only ciphertext crosses the relay.
 *
 * Usage (from the repo root, backend already running — see demo/README.md):
 *   npm run demo:peer -w @hwfa/client -- <myPhone> [discoveryUrl] [relayUrl]
 *
 * Example:
 *   npm run demo:peer -w @hwfa/client -- +2348030000001
 *
 * Then in the prompt:
 *   /find +234...     look a contact up by phone, make them the active peer
 *   /to <accountId>   set the active peer directly (by account id)
 *   /who              show my id + the active peer
 *   <any other text>  encrypt + send to the active peer
 *   /quit             exit
 */
import readline from "node:readline";
import WebSocket from "ws";
import { HwfaClient } from "../src/index.js";
import { NodeCryptoProvider } from "../src/node/index.js";

const myPhone = process.argv[2] ?? "+2348030000001";
const discoveryUrl = process.argv[3] ?? "http://localhost:8091";
const relayUrl = process.argv[4] ?? "ws://localhost:8190/v1/relay";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

/** Reprint the prompt after async output so typing isn't clobbered. */
function log(line: string): void {
  readline.cursorTo(process.stdout, 0);
  readline.clearLine(process.stdout, 0);
  process.stdout.write(line + "\n");
  rl.prompt(true);
}

async function main(): Promise<void> {
  const client = new HwfaClient({
    discoveryUrl,
    relayUrl,
    webSocketCtor: WebSocket as unknown as typeof globalThis.WebSocket,
    crypto: new NodeCryptoProvider(),
  });

  let activePeer: string | null = null;

  client.onText((m) => {
    if (activePeer === null) activePeer = m.fromUserId; // auto-reply target
    const short = m.fromUserId.slice(0, 8);
    log(`\x1b[36m${short}…\x1b[0m ${m.text}`);
    // Printing counts as "read" here — send a read receipt so the sender's
    // client shows ✓✓ (read).
    client.sendReadReceipt(m.fromUserId, m.envelopeId);
  });

  process.stdout.write(`Onboarding ${myPhone} …\n`);
  const myId = await client.onboard(myPhone);
  process.stdout.write(
    `\x1b[32m✓ online\x1b[0m as ${myId}\n` +
      `  phone:     ${myPhone}\n` +
      `  discovery: ${discoveryUrl}\n` +
      `  relay:     ${relayUrl}\n\n` +
      `Commands: /find <phone> · /to <id> · /who · /quit\n` +
      `Anything else is sent (encrypted) to the active peer.\n\n`,
  );

  rl.setPrompt("> ");
  rl.prompt();

  rl.on("line", async (raw) => {
    const line = raw.trim();
    try {
      if (line === "") {
        // nothing
      } else if (line === "/quit" || line === "/exit") {
        rl.close();
        return;
      } else if (line === "/who") {
        log(`me: ${myId}  |  peer: ${activePeer ?? "(none)"}`);
      } else if (line.startsWith("/find ")) {
        const phone = line.slice("/find ".length).trim();
        const found = await client.findContact(phone);
        if (found) {
          activePeer = found;
          log(`\x1b[32mfound\x1b[0m ${phone} → ${found} (now the active peer)`);
        } else {
          log(`\x1b[33mno account\x1b[0m registered for ${phone}`);
        }
      } else if (line.startsWith("/to ")) {
        activePeer = line.slice("/to ".length).trim();
        log(`active peer set to ${activePeer}`);
      } else if (line.startsWith("/")) {
        log(`unknown command: ${line}`);
      } else {
        if (!activePeer) {
          log(`no active peer — use /find <phone> or /to <accountId> first`);
        } else {
          await client.sendText(activePeer, line);
          log(`\x1b[90msent → ${activePeer.slice(0, 8)}…\x1b[0m`);
        }
      }
    } catch (err) {
      log(`\x1b[31merror\x1b[0m ${(err as Error).message}`);
    }
    rl.prompt();
  });

  rl.on("close", () => {
    client.close();
    process.stdout.write("\nbye\n");
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
