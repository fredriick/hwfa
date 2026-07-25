package com.hwfamobile.crypto

import android.content.SharedPreferences
import android.util.Base64
import org.signal.libsignal.protocol.IdentityKeyPair
import org.signal.libsignal.protocol.SignalProtocolAddress
import org.signal.libsignal.protocol.state.KyberPreKeyRecord
import org.signal.libsignal.protocol.state.PreKeyRecord
import org.signal.libsignal.protocol.state.SessionRecord
import org.signal.libsignal.protocol.state.SignedPreKeyRecord
import org.signal.libsignal.protocol.state.impl.InMemorySignalProtocolStore

/**
 * A SignalProtocolStore whose state survives app restarts.
 *
 * It extends the library's in-memory store (so the loads/queries and every
 * method signature track the exact libsignal-android version) and adds
 * write-through persistence: each `store*`/`delete*` mutation is mirrored into a
 * SharedPreferences as base64 of the record's libsignal `serialize()` form. On
 * construction, `load()` reads those blobs back into the in-memory maps.
 *
 * The backing prefs are EncryptedSharedPreferences (master key in the Android
 * Keystore) — see HwfaCryptoModule. Persisting the ratchet is what makes the
 * account stable across reloads; without it, every reload minted a fresh
 * identity and re-registered under a new account id.
 *
 * Peer identity-trust records (saveIdentity) are intentionally NOT persisted:
 * they are trust-on-first-use and get re-established when a peer's bundle is
 * re-fetched or a prekey message arrives, so dropping them is safe.
 */
class PersistentSignalProtocolStore private constructor(
  private val prefs: SharedPreferences,
  identityKeyPair: IdentityKeyPair,
  registrationId: Int,
) : InMemorySignalProtocolStore(identityKeyPair, registrationId) {

  /** While true, mutations only touch the in-memory super — used during restore. */
  private var loading = false

  companion object {
    private const val IDENTITY_KEYPAIR = "identityKeyPair"
    private const val REGISTRATION_ID = "registrationId"
    private const val PRE = "pk:"
    private const val SIGNED = "spk:"
    private const val KYBER = "kpk:"
    private const val SESSION = "sess:"

    private fun enc(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.NO_WRAP)
    private fun dec(s: String): ByteArray = Base64.decode(s, Base64.NO_WRAP)

    /** Load the persisted store, or null if no identity has been created yet. */
    fun load(prefs: SharedPreferences): PersistentSignalProtocolStore? {
      val idB64 = prefs.getString(IDENTITY_KEYPAIR, null) ?: return null
      val regId = prefs.getInt(REGISTRATION_ID, 0)
      val store = PersistentSignalProtocolStore(prefs, IdentityKeyPair(dec(idB64)), regId)
      store.restore()
      return store
    }

    /** Start a fresh store with a new identity, clearing any previous state. */
    fun create(
      prefs: SharedPreferences,
      identityKeyPair: IdentityKeyPair,
      registrationId: Int,
    ): PersistentSignalProtocolStore {
      // Drop any prior identity's prekeys/sessions before seeding the new one.
      prefs.edit().clear()
        .putString(IDENTITY_KEYPAIR, enc(identityKeyPair.serialize()))
        .putInt(REGISTRATION_ID, registrationId)
        .apply()
      return PersistentSignalProtocolStore(prefs, identityKeyPair, registrationId)
    }
  }

  private fun addrKey(prefix: String, a: SignalProtocolAddress): String =
    "$prefix${a.name}:${a.deviceId}"

  /** Reload persisted records into the in-memory super without re-persisting. */
  private fun restore() {
    loading = true
    try {
      for ((key, value) in prefs.all) {
        if (value !is String) continue
        val bytes = dec(value)
        when {
          key.startsWith(PRE) ->
            storePreKey(key.removePrefix(PRE).toInt(), PreKeyRecord(bytes))
          key.startsWith(SIGNED) ->
            storeSignedPreKey(key.removePrefix(SIGNED).toInt(), SignedPreKeyRecord(bytes))
          key.startsWith(KYBER) ->
            storeKyberPreKey(key.removePrefix(KYBER).toInt(), KyberPreKeyRecord(bytes))
          key.startsWith(SESSION) -> {
            val addr = parseAddr(key.removePrefix(SESSION)) ?: continue
            storeSession(addr, SessionRecord(bytes))
          }
        }
      }
    } finally {
      loading = false
    }
  }

  /** "<uuid>:<deviceId>" → address. The name (a UUID) never contains a colon. */
  private fun parseAddr(s: String): SignalProtocolAddress? {
    val i = s.lastIndexOf(':')
    if (i <= 0) return null
    val device = s.substring(i + 1).toIntOrNull() ?: return null
    return SignalProtocolAddress(s.substring(0, i), device)
  }

  // --- write-through overrides ---

  override fun storePreKey(preKeyId: Int, record: PreKeyRecord) {
    super.storePreKey(preKeyId, record)
    if (!loading) prefs.edit().putString("$PRE$preKeyId", enc(record.serialize())).apply()
  }

  override fun removePreKey(preKeyId: Int) {
    super.removePreKey(preKeyId)
    if (!loading) prefs.edit().remove("$PRE$preKeyId").apply()
  }

  override fun storeSignedPreKey(signedPreKeyId: Int, record: SignedPreKeyRecord) {
    super.storeSignedPreKey(signedPreKeyId, record)
    if (!loading) prefs.edit().putString("$SIGNED$signedPreKeyId", enc(record.serialize())).apply()
  }

  override fun removeSignedPreKey(signedPreKeyId: Int) {
    super.removeSignedPreKey(signedPreKeyId)
    if (!loading) prefs.edit().remove("$SIGNED$signedPreKeyId").apply()
  }

  override fun storeKyberPreKey(kyberPreKeyId: Int, record: KyberPreKeyRecord) {
    super.storeKyberPreKey(kyberPreKeyId, record)
    if (!loading) prefs.edit().putString("$KYBER$kyberPreKeyId", enc(record.serialize())).apply()
  }

  override fun storeSession(address: SignalProtocolAddress, record: SessionRecord) {
    super.storeSession(address, record)
    if (!loading) prefs.edit().putString(addrKey(SESSION, address), enc(record.serialize())).apply()
  }

  override fun deleteSession(address: SignalProtocolAddress) {
    super.deleteSession(address)
    if (!loading) prefs.edit().remove(addrKey(SESSION, address)).apply()
  }

  override fun deleteAllSessions(name: String) {
    super.deleteAllSessions(name)
    if (!loading) {
      val editor = prefs.edit()
      for (key in prefs.all.keys) if (key.startsWith("$SESSION$name:")) editor.remove(key)
      editor.apply()
    }
  }
}
