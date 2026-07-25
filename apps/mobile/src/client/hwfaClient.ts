/**
 * The app's single HwfaClient instance.
 *
 * Wires the portable core (`@hwfa/client`) to the platform: React Native's
 * global `WebSocket`, the native crypto provider, and the emulator/host URLs.
 * The core does the rest (Discovery onboarding, relay socket, sessions).
 */
import { HwfaClient, type WebSocketCtor } from '@hwfa/client';
import { RNCryptoProvider } from '../crypto/rnCryptoProvider';
import { getNativeCrypto } from '../crypto/NativeHwfaCrypto';
import { config } from '../config';

let client: HwfaClient | null = null;

export function getClient(): HwfaClient {
  if (!client) {
    client = new HwfaClient({
      discoveryUrl: config.discoveryUrl,
      relayUrl: config.relayUrl,
      crypto: new RNCryptoProvider(),
      // RN exposes a global WebSocket with addEventListener — matches WebSocketLike.
      webSocketCtor: WebSocket as unknown as WebSocketCtor,
    });
  }
  return client;
}

/**
 * Resume a persisted identity on launch: if the native store holds a prior
 * account, reconnect the relay under it (no re-onboarding) and return its id.
 * Returns null when there is nothing to resume (first run / after reset).
 */
export async function tryResume(): Promise<string | null> {
  const account = await getNativeCrypto().loadAccount();
  if (!account) return null;
  await getClient().resume(account.accountId, account.deviceId);
  return account.accountId;
}

/** Persist the Discovery-assigned account after a successful onboarding. */
export function saveAccount(accountId: string, phone: string): Promise<null> {
  return getNativeCrypto().saveAccount(accountId, phone);
}
