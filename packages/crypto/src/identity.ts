/**
 * Identity and prekey generation — the X3DH/PQXDH key material each device
 * publishes so others can start a session with it.
 *
 * `generateRegistration()` produces the full local key state (seeded into the
 * device's stores) plus a `PublishedKeyBundle` — the serializable public half
 * that maps 1:1 onto the Discovery API and the `key_bundles` /
 * `one_time_prekeys` Postgres tables.
 */
import {
  IdentityKeyPair,
  KEMKeyPair,
  KyberPreKeyRecord,
  PreKeyBundle,
  PreKeyRecord,
  PrivateKey,
  PublicKey,
  KEMPublicKey,
  SignedPreKeyRecord,
} from "@signalapp/libsignal-client";
import { InMemorySignalStores } from "./stores.js";

const b64 = (b: Buffer): string => b.toString("base64");
const unb64 = (s: string): Buffer => Buffer.from(s, "base64");

/**
 * The public key material uploaded to the Discovery API. Field names mirror the
 * `key_bundles` + `one_time_prekeys` server schema. A fresh `oneTimePreKey`
 * is consumed per new session; the signed and kyber prekeys are reused until
 * rotated.
 */
export interface PublishedKeyBundle {
  registrationId: number;
  deviceId: number;
  identityKeyB64: string;
  signedPreKeyId: number;
  signedPreKeyPublicB64: string;
  signedPreKeySignatureB64: string;
  kyberPreKeyId: number;
  kyberPreKeyPublicB64: string;
  kyberPreKeySignatureB64: string;
  oneTimePreKeyId: number | null;
  oneTimePreKeyPublicB64: string | null;
}

/** One public one-time prekey, as uploaded to the Discovery API's pool. */
export interface OneTimePreKeyPublic {
  id: number;
  publicB64: string;
}

export interface DeviceRegistration {
  registrationId: number;
  deviceId: number;
  identityKeyPair: IdentityKeyPair;
  stores: InMemorySignalStores;
  /** A snapshot bundle ready to publish (uses the first one-time prekey). */
  publishedBundle: PublishedKeyBundle;
  /**
   * The full public one-time prekey pool, for uploading to Discovery at
   * registration (`oneTimePreKeys` in the register request). The server hands
   * these out one per new session; `publishedBundle` only carries the first.
   */
  oneTimePreKeys: OneTimePreKeyPublic[];
}

export interface GenerateOptions {
  deviceId?: number;
  /** How many one-time prekeys to mint into the pool. */
  oneTimePreKeyCount?: number;
  signedPreKeyId?: number;
  kyberPreKeyId?: number;
}

/** libsignal registration ids must fit in 14 bits (1..16380). */
function randomRegistrationId(): number {
  return 1 + Math.floor(Math.random() * 16379);
}

/**
 * Generate a device's full identity + prekey state, seed it into fresh stores,
 * and return a publishable bundle. This is what runs during onboarding.
 */
export function generateRegistration(opts: GenerateOptions = {}): DeviceRegistration {
  const deviceId = opts.deviceId ?? 1;
  const oneTimeCount = opts.oneTimePreKeyCount ?? 10;
  const signedPreKeyId = opts.signedPreKeyId ?? 1;
  const kyberPreKeyId = opts.kyberPreKeyId ?? 1;

  const identityKeyPair = IdentityKeyPair.generate();
  const registrationId = randomRegistrationId();
  const stores = new InMemorySignalStores(identityKeyPair.privateKey, registrationId);

  // Signed prekey: an EC keypair whose public key is signed by the identity key.
  const signedPreKeyPair = PrivateKey.generate();
  const signedPreKeyPublic = signedPreKeyPair.getPublicKey();
  const signedPreKeySignature = identityKeyPair.privateKey.sign(signedPreKeyPublic.serialize());
  const signedPreKeyRecord = SignedPreKeyRecord.new(
    signedPreKeyId,
    Date.now(),
    signedPreKeyPublic,
    signedPreKeyPair,
    signedPreKeySignature,
  );
  void stores.signedPreKey.saveSignedPreKey(signedPreKeyId, signedPreKeyRecord);

  // Kyber prekey: post-quantum KEM keypair, also signed by the identity key.
  const kyberKeyPair = KEMKeyPair.generate();
  const kyberPublic = kyberKeyPair.getPublicKey();
  const kyberSignature = identityKeyPair.privateKey.sign(kyberPublic.serialize());
  const kyberRecord = KyberPreKeyRecord.new(
    kyberPreKeyId,
    Date.now(),
    kyberKeyPair,
    kyberSignature,
  );
  void stores.kyberPreKey.saveKyberPreKey(kyberPreKeyId, kyberRecord);

  // One-time prekey pool: ephemeral, consumed one per new inbound session.
  let firstOneTime: { id: number; pub: PublicKey } | null = null;
  const oneTimePreKeys: OneTimePreKeyPublic[] = [];
  for (let i = 0; i < oneTimeCount; i++) {
    const id = i + 1;
    const kp = PrivateKey.generate();
    const pub = kp.getPublicKey();
    const record = PreKeyRecord.new(id, pub, kp);
    void stores.preKey.savePreKey(id, record);
    oneTimePreKeys.push({ id, publicB64: b64(pub.serialize()) });
    if (i === 0) firstOneTime = { id, pub };
  }

  const publishedBundle: PublishedKeyBundle = {
    registrationId,
    deviceId,
    identityKeyB64: b64(identityKeyPair.publicKey.serialize()),
    signedPreKeyId,
    signedPreKeyPublicB64: b64(signedPreKeyPublic.serialize()),
    signedPreKeySignatureB64: b64(signedPreKeySignature),
    kyberPreKeyId,
    kyberPreKeyPublicB64: b64(kyberPublic.serialize()),
    kyberPreKeySignatureB64: b64(kyberSignature),
    oneTimePreKeyId: firstOneTime?.id ?? null,
    oneTimePreKeyPublicB64: firstOneTime ? b64(firstOneTime.pub.serialize()) : null,
  };

  return { registrationId, deviceId, identityKeyPair, stores, publishedBundle, oneTimePreKeys };
}

/**
 * Rebuild a libsignal `PreKeyBundle` from a bundle fetched off the Discovery
 * API. This is the input to `processPreKeyBundle` (the X3DH initiator step).
 */
export function toPreKeyBundle(pub: PublishedKeyBundle): PreKeyBundle {
  const hasOneTime = pub.oneTimePreKeyId !== null && pub.oneTimePreKeyPublicB64 !== null;
  return PreKeyBundle.new(
    pub.registrationId,
    pub.deviceId,
    hasOneTime ? pub.oneTimePreKeyId : null,
    hasOneTime ? PublicKey.deserialize(unb64(pub.oneTimePreKeyPublicB64!)) : null,
    pub.signedPreKeyId,
    PublicKey.deserialize(unb64(pub.signedPreKeyPublicB64)),
    unb64(pub.signedPreKeySignatureB64),
    PublicKey.deserialize(unb64(pub.identityKeyB64)),
    pub.kyberPreKeyId,
    KEMPublicKey.deserialize(unb64(pub.kyberPreKeyPublicB64)),
    unb64(pub.kyberPreKeySignatureB64),
  );
}
