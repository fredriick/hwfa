package com.hwfamobile.crypto

import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import org.signal.libsignal.protocol.IdentityKey
import org.signal.libsignal.protocol.IdentityKeyPair
import org.signal.libsignal.protocol.SessionBuilder
import org.signal.libsignal.protocol.SessionCipher
import org.signal.libsignal.protocol.SignalProtocolAddress
import org.signal.libsignal.protocol.ecc.Curve
import org.signal.libsignal.protocol.kem.KEMKeyPair
import org.signal.libsignal.protocol.kem.KEMKeyType
import org.signal.libsignal.protocol.kem.KEMPublicKey
import org.signal.libsignal.protocol.message.CiphertextMessage
import org.signal.libsignal.protocol.message.PreKeySignalMessage
import org.signal.libsignal.protocol.message.SignalMessage
import org.signal.libsignal.protocol.state.KyberPreKeyRecord
import org.signal.libsignal.protocol.state.PreKeyBundle
import org.signal.libsignal.protocol.state.PreKeyRecord
import org.signal.libsignal.protocol.state.SignedPreKeyRecord
import org.signal.libsignal.protocol.state.impl.InMemorySignalProtocolStore
import java.util.Random

/**
 * HwfaCrypto — the on-device Signal-Protocol binding for React Native.
 *
 * Implements the four operations of `CryptoProvider` (see
 * packages/client/src/crypto-provider.ts) against the OFFICIAL Signal Rust core
 * via `org.signal:libsignal-android` — the same core as the Node
 * `@signalapp/libsignal-client`, so key bundles and ciphertext are byte-for-byte
 * compatible with the backend and the headless tests (Kyber PQXDH included).
 *
 * Phase 1: keys + ratchet state live in an in-memory store, exactly like the
 * spikes. Production must persist the store to SQLCipher and the identity key to
 * the Android Keystore.
 *
 * LICENSING: libsignal-android is AGPL-3.0. Shipping it makes this app subject
 * to the AGPL. Resolve that (open-source the client, or a different arrangement)
 * before release — it is a product decision, not a technical one.
 */
class HwfaCryptoModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private var store: InMemorySignalProtocolStore? = null
  private var localDeviceId: Int = 1

  override fun getName(): String = "HwfaCrypto"

  private fun b64(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.NO_WRAP)
  private fun unb64(s: String): ByteArray = Base64.decode(s, Base64.NO_WRAP)

  private fun requireStore(): InMemorySignalProtocolStore =
    store ?: throw IllegalStateException("generateRegistration() must run before this call")

  /** Mint identity + prekeys, seed the store, and return the publishable bundle. */
  @ReactMethod
  fun generateRegistration(deviceId: Int, oneTimeCount: Int, promise: Promise) {
    try {
      val identityKeyPair = IdentityKeyPair.generate()
      val registrationId = 1 + Random().nextInt(16380) // 14-bit, matches the TS core
      val s = InMemorySignalProtocolStore(identityKeyPair, registrationId)
      store = s
      localDeviceId = if (deviceId > 0) deviceId else 1

      val now = System.currentTimeMillis()
      val identityPriv = identityKeyPair.privateKey

      // Signed prekey (EC), signed by the identity key.
      val signedPreKeyId = 1
      val signedKeys = Curve.generateKeyPair()
      val signedSig = identityPriv.calculateSignature(signedKeys.publicKey.serialize())
      s.storeSignedPreKey(signedPreKeyId, SignedPreKeyRecord(signedPreKeyId, now, signedKeys, signedSig))

      // Kyber prekey (post-quantum KEM), also signed by the identity key.
      val kyberPreKeyId = 1
      val kyberKeys = KEMKeyPair.generate(KEMKeyType.KYBER_1024)
      val kyberSig = identityPriv.calculateSignature(kyberKeys.publicKey.serialize())
      s.storeKyberPreKey(kyberPreKeyId, KyberPreKeyRecord(kyberPreKeyId, now, kyberKeys, kyberSig))

      // One-time prekey pool.
      val oneTimeArray = Arguments.createArray()
      var firstId = -1
      var firstPubB64: String? = null
      for (i in 0 until oneTimeCount) {
        val id = i + 1
        val kp = Curve.generateKeyPair()
        s.storePreKey(id, PreKeyRecord(id, kp))
        val pubB64 = b64(kp.publicKey.serialize())
        val entry = Arguments.createMap()
        entry.putInt("id", id)
        entry.putString("publicB64", pubB64)
        oneTimeArray.pushMap(entry)
        if (i == 0) {
          firstId = id
          firstPubB64 = pubB64
        }
      }

      val bundle: WritableMap = Arguments.createMap()
      bundle.putInt("registrationId", registrationId)
      bundle.putInt("deviceId", localDeviceId)
      bundle.putString("identityKeyB64", b64(identityKeyPair.publicKey.serialize()))
      bundle.putInt("signedPreKeyId", signedPreKeyId)
      bundle.putString("signedPreKeyPublicB64", b64(signedKeys.publicKey.serialize()))
      bundle.putString("signedPreKeySignatureB64", b64(signedSig))
      bundle.putInt("kyberPreKeyId", kyberPreKeyId)
      bundle.putString("kyberPreKeyPublicB64", b64(kyberKeys.publicKey.serialize()))
      bundle.putString("kyberPreKeySignatureB64", b64(kyberSig))
      if (firstId >= 0) {
        bundle.putInt("oneTimePreKeyId", firstId)
        bundle.putString("oneTimePreKeyPublicB64", firstPubB64)
      } else {
        bundle.putNull("oneTimePreKeyId")
        bundle.putNull("oneTimePreKeyPublicB64")
      }

      val result: WritableMap = Arguments.createMap()
      result.putInt("registrationId", registrationId)
      result.putInt("deviceId", localDeviceId)
      result.putMap("publishedBundle", bundle)
      result.putArray("oneTimePreKeys", oneTimeArray)
      promise.resolve(result)
    } catch (e: Exception) {
      promise.reject("generateRegistration", e)
    }
  }

  /** X3DH/PQXDH initiator step from a peer's published bundle. */
  @ReactMethod
  fun establishSession(peerId: String, peerDeviceId: Int, bundle: ReadableMap, promise: Promise) {
    try {
      val s = requireStore()
      val hasOneTime =
        bundle.hasKey("oneTimePreKeyId") && !bundle.isNull("oneTimePreKeyId")
      if (!hasOneTime) {
        throw IllegalArgumentException("bundle has no one-time prekey (pool exhausted upstream)")
      }
      val preKeyBundle = PreKeyBundle(
        bundle.getInt("registrationId"),
        bundle.getInt("deviceId"),
        bundle.getInt("oneTimePreKeyId"),
        Curve.decodePoint(unb64(bundle.getString("oneTimePreKeyPublicB64")!!), 0),
        bundle.getInt("signedPreKeyId"),
        Curve.decodePoint(unb64(bundle.getString("signedPreKeyPublicB64")!!), 0),
        unb64(bundle.getString("signedPreKeySignatureB64")!!),
        IdentityKey(unb64(bundle.getString("identityKeyB64")!!)),
        bundle.getInt("kyberPreKeyId"),
        KEMPublicKey(unb64(bundle.getString("kyberPreKeyPublicB64")!!)),
        unb64(bundle.getString("kyberPreKeySignatureB64")!!),
      )
      SessionBuilder(s, SignalProtocolAddress(peerId, peerDeviceId)).process(preKeyBundle)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("establishSession", e)
    }
  }

  /** Encrypt one UTF-8 string to an established peer. */
  @ReactMethod
  fun encrypt(peerId: String, peerDeviceId: Int, plaintext: String, promise: Promise) {
    try {
      val s = requireStore()
      val address = SignalProtocolAddress(peerId, peerDeviceId)
      val cipher = SessionCipher(s, s, s, s, s, address)
      val message: CiphertextMessage = cipher.encrypt(plaintext.toByteArray(Charsets.UTF_8))
      val result = Arguments.createMap()
      result.putInt("type", message.type)
      result.putString("ciphertextB64", b64(message.serialize()))
      promise.resolve(result)
    } catch (e: Exception) {
      promise.reject("encrypt", e)
    }
  }

  /** Decrypt one message from a peer, routing on the ciphertext type. */
  @ReactMethod
  fun decrypt(peerId: String, peerDeviceId: Int, type: Int, ciphertextB64: String, promise: Promise) {
    try {
      val s = requireStore()
      val address = SignalProtocolAddress(peerId, peerDeviceId)
      val cipher = SessionCipher(s, s, s, s, s, address)
      val raw = unb64(ciphertextB64)
      val plaintext: ByteArray = if (type == CiphertextMessage.PREKEY_TYPE) {
        cipher.decrypt(PreKeySignalMessage(raw))
      } else {
        cipher.decrypt(SignalMessage(raw))
      }
      promise.resolve(String(plaintext, Charsets.UTF_8))
    } catch (e: Exception) {
      promise.reject("decrypt", e)
    }
  }
}
