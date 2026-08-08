package com.hwfamobile.media

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap

/**
 * HwfaImagePicker — a dependency-free image chooser.
 *
 * Launches the system document picker (ACTION_GET_CONTENT, images) and returns
 * the chosen image's raw bytes (base64), MIME type, and file name. The bytes are
 * handed straight to the `MediaCipher` for client-side encryption before they
 * ever leave the device; nothing here touches the network or object storage.
 *
 * Hand-rolled rather than pulling in react-native-image-picker, matching the
 * app's pattern of small in-app native modules (crypto, push, media cipher).
 */
class HwfaImagePickerModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  /** ~12 MB cap on the picked image — base64 over the bridge grows it ~33%. */
  private val maxBytes = 12 * 1024 * 1024

  private var pending: Promise? = null

  private val activityListener: ActivityEventListener =
    object : BaseActivityEventListener() {
      override fun onActivityResult(
        activity: Activity,
        requestCode: Int,
        resultCode: Int,
        data: Intent?,
      ) {
        if (requestCode != PICK_REQUEST) return
        val promise = pending ?: return
        pending = null
        if (resultCode != Activity.RESULT_OK || data?.data == null) {
          promise.resolve(null) // user cancelled
          return
        }
        try {
          promise.resolve(read(data.data!!))
        } catch (e: Exception) {
          promise.reject("pick", e)
        }
      }
    }

  init {
    reactContext.addActivityEventListener(activityListener)
  }

  override fun getName(): String = "HwfaImagePicker"

  /** Open the picker. Resolves with {dataB64, mime, name, size} or null if cancelled. */
  @ReactMethod
  fun pickImage(promise: Promise) {
    val activity = getCurrentActivity()
    if (activity == null) {
      promise.reject("pick", "no foreground activity")
      return
    }
    if (pending != null) {
      promise.reject("pick", "a pick is already in progress")
      return
    }
    pending = promise
    try {
      val intent =
        Intent(Intent.ACTION_GET_CONTENT).apply {
          type = "image/*"
          addCategory(Intent.CATEGORY_OPENABLE)
        }
      activity.startActivityForResult(
        Intent.createChooser(intent, "Select image"),
        PICK_REQUEST,
      )
    } catch (e: Exception) {
      pending = null
      promise.reject("pick", e)
    }
  }

  private fun read(uri: Uri): WritableMap {
    val resolver = reactContext.contentResolver
    val bytes =
      resolver.openInputStream(uri)?.use { it.readBytes() }
        ?: throw IllegalStateException("could not open image stream")
    if (bytes.size > maxBytes) {
      throw IllegalStateException("image too large (${bytes.size} bytes, max $maxBytes)")
    }
    val out = Arguments.createMap()
    out.putString("dataB64", Base64.encodeToString(bytes, Base64.NO_WRAP))
    out.putString("mime", resolver.getType(uri) ?: "application/octet-stream")
    out.putString("name", displayName(uri))
    out.putInt("size", bytes.size)
    return out
  }

  private fun displayName(uri: Uri): String {
    return try {
      reactContext.contentResolver
        .query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
        ?.use { c ->
          if (c.moveToFirst() && !c.isNull(0)) c.getString(0) else null
        } ?: "image"
    } catch (e: Exception) {
      "image"
    }
  }

  companion object {
    private const val PICK_REQUEST = 0x4849 // 'HI'
  }
}
