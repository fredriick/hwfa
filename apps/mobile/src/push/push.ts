/**
 * Push notifications (FCM) — app-side glue over the `HwfaPush` native module.
 *
 * Content-free by design: the push only wakes the app, which then reconnects the
 * relay and lets queued (encrypted) messages flow — the notification never
 * carries message content. This module handles the notification permission,
 * fetches the FCM token for backend registration, and forwards the native
 * `pushWake` / `fcmTokenRefresh` events to JS handlers.
 */
import {
  NativeEventEmitter,
  NativeModules,
  PermissionsAndroid,
  Platform,
} from 'react-native';
import { getNativePush, hasNativePush } from './NativeHwfaPush';

/** Ask for POST_NOTIFICATIONS on Android 13+ (auto-granted below 33 / other OS). */
export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  if (typeof Platform.Version === 'number' && Platform.Version < 33) return true;
  try {
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

/** The device FCM token, or null if unavailable / module not linked. */
export async function getFcmToken(): Promise<string | null> {
  if (!hasNativePush()) return null;
  try {
    return await getNativePush().getToken();
  } catch {
    return null;
  }
}

function emitter(): NativeEventEmitter | null {
  if (!hasNativePush()) return null;
  return new NativeEventEmitter(NativeModules.HwfaPush);
}

/** Subscribe to content-free wake pushes; returns an unsubscribe fn. */
export function onPushWake(handler: () => void): () => void {
  const sub = emitter()?.addListener('pushWake', handler);
  return () => sub?.remove();
}

/** Subscribe to FCM token rotations; returns an unsubscribe fn. */
export function onTokenRefresh(handler: (token: string) => void): () => void {
  const sub = emitter()?.addListener('fcmTokenRefresh', (e: { token: string }) =>
    handler(e.token),
  );
  return () => sub?.remove();
}
