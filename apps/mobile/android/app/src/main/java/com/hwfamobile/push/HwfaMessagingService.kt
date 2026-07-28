package com.hwfamobile.push

import android.util.Log
import com.facebook.react.bridge.Arguments
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Receives FCM pushes. The server sends content-free, data-only messages — no
 * title/body — so the notification never carries message content. When one
 * arrives and the JS runtime is alive, we tell it to sync (reconnect the relay,
 * flush the queue); the actual (encrypted) message is fetched from the relay,
 * never from the push.
 */
class HwfaMessagingService : FirebaseMessagingService() {

  override fun onNewToken(token: String) {
    Log.i(TAG, "FCM token refreshed")
    val map = Arguments.createMap().apply { putString("token", token) }
    HwfaPushModule.sendEvent("fcmTokenRefresh", map)
  }

  override fun onMessageReceived(message: RemoteMessage) {
    Log.i(TAG, "content-free push received; signalling sync")
    HwfaPushModule.sendEvent("pushWake", Arguments.createMap())
  }

  companion object {
    private const val TAG = "HwfaPush"
  }
}
