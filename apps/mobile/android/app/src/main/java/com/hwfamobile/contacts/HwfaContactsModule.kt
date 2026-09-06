package com.hwfamobile.contacts

import android.provider.ContactsContract
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray

/**
 * HwfaContacts — a dependency-free address-book reader for contact discovery.
 *
 * `getPhoneNumbers` returns each contact's display name + phone number(s). The
 * numbers never leave the device in the clear: the JS layer normalizes them,
 * hashes each with the server salt (base64(sha256(salt||number))), and sends
 * only the hash set to Discovery's intersect endpoint. This module just reads;
 * the caller must hold READ_CONTACTS (requested via PermissionsAndroid in JS).
 *
 * Hand-rolled rather than pulling in react-native-contacts, matching the app's
 * pattern of small in-app native modules (crypto, push, media, picker).
 */
class HwfaContactsModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "HwfaContacts"

  /** Resolve with [{name, number}] for every phone entry, or reject on error. */
  @ReactMethod
  fun getPhoneNumbers(promise: Promise) {
    try {
      val out: WritableArray = Arguments.createArray()
      val projection =
        arrayOf(
          ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
          ContactsContract.CommonDataKinds.Phone.NUMBER,
        )
      reactContext.contentResolver
        .query(
          ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
          projection,
          null,
          null,
          null,
        )
        ?.use { c ->
          val nameIdx = c.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME)
          val numberIdx = c.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER)
          while (c.moveToNext()) {
            val number = if (numberIdx >= 0) c.getString(numberIdx) else null
            if (number.isNullOrBlank()) continue
            val entry = Arguments.createMap()
            entry.putString("name", if (nameIdx >= 0) c.getString(nameIdx) ?: "" else "")
            entry.putString("number", number)
            out.pushMap(entry)
          }
        }
      promise.resolve(out)
    } catch (e: Exception) {
      promise.reject("contacts", e)
    }
  }
}
