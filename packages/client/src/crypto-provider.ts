/**
 * CryptoProvider — the seam between the portable client core and the platform's
 * Signal-Protocol implementation.
 *
 * The core (discovery + relay + conversation orchestration) is pure TS and runs
 * anywhere fetch + WebSocket exist (Node, React Native, browser). The actual
 * X3DH/Double-Ratchet crypto is NOT portable: `@signalapp/libsignal-client` is a
 * Node N-API native module, and React Native needs its own native binding. So
 * all crypto lives behind this interface — the core never touches key material.
 *
 * These are *type-only* imports of the wire shapes from `@hwfa/crypto`; they are
 * erased at compile time, so importing the core into a React Native bundle never
 * pulls in libsignal. The Node implementation lives at `@hwfa/client/node`.
 */
import type {
  EncryptedMessage,
  OneTimePreKeyPublic,
  PublishedKeyBundle,
} from "@hwfa/crypto";

export type { EncryptedMessage, OneTimePreKeyPublic, PublishedKeyBundle };

/** Options for minting a fresh device identity + prekeys. */
export interface GenerateRegistrationOptions {
  deviceId?: number;
  oneTimePreKeyCount?: number;
}

/**
 * The public half of a freshly generated device registration — everything the
 * Discovery API needs. The private key material stays inside the provider and
 * is never handed to the core.
 */
export interface LocalRegistration {
  registrationId: number;
  deviceId: number;
  publishedBundle: PublishedKeyBundle;
  oneTimePreKeys: OneTimePreKeyPublic[];
}

/**
 * The whole crypto surface the client core depends on. A provider owns the
 * device's private stores; the core only ever passes peer ids and plaintext in,
 * and gets ciphertext / plaintext out.
 */
export interface CryptoProvider {
  /** Mint identity + prekeys and seed the local stores. Call once per device. */
  generateRegistration(opts?: GenerateRegistrationOptions): Promise<LocalRegistration>;

  /** X3DH initiator step from a peer's published bundle (before first encrypt). */
  establishSession(
    peerAccountId: string,
    peerDeviceId: number,
    peerBundle: PublishedKeyBundle,
  ): Promise<void>;

  /** Encrypt one plaintext string to an established peer. */
  encrypt(
    peerAccountId: string,
    peerDeviceId: number,
    plaintext: string,
  ): Promise<EncryptedMessage>;

  /** Decrypt one message from a peer (completes X3DH as responder on a PreKey msg). */
  decrypt(
    peerAccountId: string,
    peerDeviceId: number,
    encrypted: EncryptedMessage,
  ): Promise<string>;
}
