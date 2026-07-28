package com.hwfamobile.push

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.google.firebase.messaging.FirebaseMessaging

/**
 * HwfaPush — the React Native bridge to Firebase Cloud Messaging.
 *
 * Exposes the device FCM token so the app can register it with the push backend,
 * and forwards two events to JS: `fcmTokenRefresh` (token rotated) and `pushWake`
 * (a content-free push arrived — the app should reconnect the relay and flush any
 * queued messages). Push payloads are deliberately content-free: the ciphertext
 * lives only in the relay/queue, never in the notification.
 */
class HwfaPushModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  init {
    instance = this
  }

  override fun getName(): String = "HwfaPush"

  /** Resolve the current FCM registration token for this device. */
  @ReactMethod
  fun getToken(promise: Promise) {
    FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
      if (task.isSuccessful) {
        promise.resolve(task.result)
      } else {
        promise.reject("getToken", task.exception ?: Exception("unknown FCM token error"))
      }
    }
  }

  // NativeEventEmitter requires these to exist (no-ops on Android).
  @ReactMethod fun addListener(eventName: String) {}

  @ReactMethod fun removeListeners(count: Int) {}

  private fun emit(event: String, data: WritableMap?) {
    if (reactContext.hasActiveReactInstance()) {
      reactContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(event, data)
    }
  }

  companion object {
    @Volatile private var instance: HwfaPushModule? = null

    /** Called from the messaging service to forward events into JS, if alive. */
    fun sendEvent(event: String, data: WritableMap?) {
      instance?.emit(event, data)
    }
  }
}
