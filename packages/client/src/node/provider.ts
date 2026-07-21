/**
 * NodeCryptoProvider — the libsignal-backed `CryptoProvider` for Node.
 *
 * This is the ONLY file in `@hwfa/client` that imports `@hwfa/crypto` (and thus
 * the `@signalapp/libsignal-client` native module) at runtime. It is exposed on
 * the `@hwfa/client/node` subpath so importing the portable core never pulls
 * libsignal into a React Native bundle.
 *
 * The provider owns the device's private stores; the client core never sees
 * them. Phase 1 uses in-memory stores (like the spikes); persisting the ratchet
 * state to SQLCipher is the production step.
 */
import {
  decrypt,
  encrypt,
  establishSession,
  generateRegistration,
  type InMemorySignalStores,
} from "@hwfa/crypto";
import type {
  CryptoProvider,
  EncryptedMessage,
  GenerateRegistrationOptions,
  LocalRegistration,
  PublishedKeyBundle,
} from "../crypto-provider.js";

export class NodeCryptoProvider implements CryptoProvider {
  private stores: InMemorySignalStores | null = null;

  async generateRegistration(
    opts: GenerateRegistrationOptions = {},
  ): Promise<LocalRegistration> {
    const reg = generateRegistration(opts);
    this.stores = reg.stores;
    return {
      registrationId: reg.registrationId,
      deviceId: reg.deviceId,
      publishedBundle: reg.publishedBundle,
      oneTimePreKeys: reg.oneTimePreKeys,
    };
  }

  async establishSession(
    peerAccountId: string,
    peerDeviceId: number,
    peerBundle: PublishedKeyBundle,
  ): Promise<void> {
    await establishSession(this.requireStores(), peerAccountId, peerDeviceId, peerBundle);
  }

  encrypt(
    peerAccountId: string,
    peerDeviceId: number,
    plaintext: string,
  ): Promise<EncryptedMessage> {
    return encrypt(this.requireStores(), peerAccountId, peerDeviceId, plaintext);
  }

  decrypt(
    peerAccountId: string,
    peerDeviceId: number,
    encrypted: EncryptedMessage,
  ): Promise<string> {
    return decrypt(this.requireStores(), peerAccountId, peerDeviceId, encrypted);
  }

  private requireStores(): InMemorySignalStores {
    if (!this.stores) throw new Error("generateRegistration() before using the crypto provider");
    return this.stores;
  }
}
