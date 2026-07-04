/**
 * Session lifecycle: X3DH/PQXDH establishment and Double Ratchet
 * encrypt/decrypt. This is the whole 1:1 crypto surface the app calls.
 *
 * The wire format is the libsignal `CiphertextMessage`: its `type()` tells the
 * recipient whether this is the first message of a new session (a PreKey
 * message carrying the X3DH handshake) or a normal ratchet message. We surface
 * that as `CiphertextType` so it can ride in the `Envelope` and the recipient
 * knows which decrypt path to take — without the relay ever seeing plaintext.
 */
import {
  CiphertextMessage,
  PreKeySignalMessage,
  ProtocolAddress,
  SignalMessage,
  processPreKeyBundle,
  signalDecrypt,
  signalDecryptPreKey,
  signalEncrypt,
} from "@signalapp/libsignal-client";
import { CiphertextType } from "@hwfa/models";
import { PublishedKeyBundle, toPreKeyBundle } from "./identity.js";
import { InMemorySignalStores } from "./stores.js";

const utf8 = new TextEncoder();
const utf8dec = new TextDecoder();

/** An encrypted message ready to be placed in an `Envelope.ciphertext`. */
export interface EncryptedMessage {
  type: CiphertextType;
  ciphertextB64: string;
}

/** Build a libsignal address from a Hwfa account id + device id. */
export function addressFor(accountId: string, deviceId: number): ProtocolAddress {
  return ProtocolAddress.new(accountId, deviceId);
}

/**
 * X3DH initiator step: consume a peer's published bundle and establish an
 * outbound session. Must be called once before the first `encrypt` to a peer
 * you have no session with. Idempotent-safe to call again to re-key.
 */
export async function establishSession(
  self: InMemorySignalStores,
  peerAccountId: string,
  peerDeviceId: number,
  peerBundle: PublishedKeyBundle,
): Promise<void> {
  const address = addressFor(peerAccountId, peerDeviceId);
  await processPreKeyBundle(
    toPreKeyBundle(peerBundle),
    address,
    self.session,
    self.identity,
  );
}

/** Encrypt one plaintext string to an established (or bundle-seeded) peer. */
export async function encrypt(
  self: InMemorySignalStores,
  peerAccountId: string,
  peerDeviceId: number,
  plaintext: string,
): Promise<EncryptedMessage> {
  const address = addressFor(peerAccountId, peerDeviceId);
  const message: CiphertextMessage = await signalEncrypt(
    Buffer.from(utf8.encode(plaintext)),
    address,
    self.session,
    self.identity,
  );
  return {
    type: message.type() as CiphertextType,
    ciphertextB64: message.serialize().toString("base64"),
  };
}

/**
 * Decrypt one message from a peer. Routes on the ciphertext type:
 *  - PreKey  → `signalDecryptPreKey` (also completes X3DH as the responder and
 *              consumes a one-time prekey).
 *  - Whisper → `signalDecrypt` (normal Double Ratchet step).
 */
export async function decrypt(
  self: InMemorySignalStores,
  peerAccountId: string,
  peerDeviceId: number,
  encrypted: EncryptedMessage,
): Promise<string> {
  const address = addressFor(peerAccountId, peerDeviceId);
  const raw = Buffer.from(encrypted.ciphertextB64, "base64");

  let plaintext: Buffer;
  if (encrypted.type === CiphertextType.PreKey) {
    const msg = PreKeySignalMessage.deserialize(raw);
    plaintext = await signalDecryptPreKey(
      msg,
      address,
      self.session,
      self.identity,
      self.preKey,
      self.signedPreKey,
      self.kyberPreKey,
    );
  } else {
    const msg = SignalMessage.deserialize(raw);
    plaintext = await signalDecrypt(msg, address, self.session, self.identity);
  }
  return utf8dec.decode(plaintext);
}
