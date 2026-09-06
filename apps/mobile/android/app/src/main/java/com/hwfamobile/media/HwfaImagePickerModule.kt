package com.hwfamobile.media

import android.app.Activity
import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
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
import java.io.File

/**
 * HwfaImagePicker — a dependency-free file chooser + saver.
 *
 * `pickImage`/`pickFile` launch the system document picker (ACTION_GET_CONTENT)
 * and return the chosen file's raw bytes (base64), MIME type, and name. The
 * bytes are handed straight to the `MediaCipher` for client-side encryption
 * before they ever leave the device; nothing here touches the network or object
 * storage. `saveToDownloads` writes decrypted bytes back out to the public
 * Downloads collection so a received attachment can leave the app.
 *
 * Hand-rolled rather than pulling in react-native-image-picker, matching the
 * app's pattern of small in-app native modules (crypto, push, media cipher).
 */
class HwfaImagePickerModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  /** ~12 MB cap on the picked file — base64 over the bridge grows it ~33%. */
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

  /** Open the image chooser. Resolves with {dataB64, mime, name, size} or null. */
  @ReactMethod
  fun pickImage(promise: Promise) = launchPicker("image/*", "Select image", promise)

  /** Open a chooser for any file type. Resolves with {dataB64, mime, name, size} or null. */
  @ReactMethod
  fun pickFile(promise: Promise) = launchPicker("*/*", "Select file", promise)

  private fun launchPicker(mime: String, title: String, promise: Promise) {
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
          type = mime
          addCategory(Intent.CATEGORY_OPENABLE)
        }
      activity.startActivityForResult(Intent.createChooser(intent, title), PICK_REQUEST)
    } catch (e: Exception) {
      pending = null
      promise.reject("pick", e)
    }
  }

  /**
   * Write decrypted bytes out to the public Downloads collection (API 29+ via
   * MediaStore, no permission needed) or the app's external files dir on older
   * OSes. Resolves with the saved name/path. Called after a received attachment
   * is downloaded and decrypted in JS.
   */
  @ReactMethod
  fun saveToDownloads(dataB64: String, name: String, mime: String, promise: Promise) {
    try {
      val bytes = Base64.decode(dataB64, Base64.NO_WRAP)
      val safeName = sanitize(name)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        val resolver = reactContext.contentResolver
        val values =
          ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, safeName)
            if (mime.isNotEmpty()) put(MediaStore.Downloads.MIME_TYPE, mime)
            put(MediaStore.Downloads.IS_PENDING, 1)
          }
        val uri =
          resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            ?: throw IllegalStateException("could not create Downloads entry")
        resolver.openOutputStream(uri)?.use { it.write(bytes) }
          ?: throw IllegalStateException("could not open output stream")
        values.clear()
        values.put(MediaStore.Downloads.IS_PENDING, 0)
        resolver.update(uri, values, null, null)
        promise.resolve(safeName)
      } else {
        // Pre-Q: app-specific external dir needs no runtime permission.
        val dir =
          reactContext.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
            ?: throw IllegalStateException("no external files dir")
        if (!dir.exists()) dir.mkdirs()
        val file = File(dir, safeName)
        file.outputStream().use { it.write(bytes) }
        promise.resolve(file.absolutePath)
      }
    } catch (e: Exception) {
      promise.reject("save", e)
    }
  }

  /** Strip path separators so a hostile name can't escape the target dir. */
  private fun sanitize(name: String): String {
    val base = name.substringAfterLast('/').substringAfterLast('\\').trim()
    return if (base.isEmpty()) "hwfa-file" else base
  }

  private fun read(uri: Uri): WritableMap {
    val resolver = reactContext.contentResolver
    val bytes =
      resolver.openInputStream(uri)?.use { it.readBytes() }
        ?: throw IllegalStateException("could not open file stream")
    if (bytes.size > maxBytes) {
      throw IllegalStateException("file too large (${bytes.size} bytes, max $maxBytes)")
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
        } ?: "file"
    } catch (e: Exception) {
      "file"
    }
  }

  companion object {
    private const val PICK_REQUEST = 0x4849 // 'HI'
  }
}
