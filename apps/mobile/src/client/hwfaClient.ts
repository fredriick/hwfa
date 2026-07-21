/**
 * The app's single HwfaClient instance.
 *
 * Wires the portable core (`@hwfa/client`) to the platform: React Native's
 * global `WebSocket`, the native crypto provider, and the emulator/host URLs.
 * The core does the rest (Discovery onboarding, relay socket, sessions).
 */
import { HwfaClient, type WebSocketCtor } from '@hwfa/client';
import { RNCryptoProvider } from '../crypto/rnCryptoProvider';
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
