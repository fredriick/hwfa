/**
 * One-call push setup, run once the user is online.
 *
 * Requests the notification permission, fetches the FCM token, and wires the
 * content-free wake push to a relay reconnect (so queued messages flow when the
 * app is woken). Registering the token with the push backend lands in the next
 * increment; for now the token is logged so it can be verified on device.
 */
import { getClient } from '../client/hwfaClient';
import { getFcmToken, onPushWake, onTokenRefresh, requestNotificationPermission } from './push';

let started = false;

/** Idempotent. Returns a cleanup that removes the push event subscriptions. */
export async function initPush(): Promise<() => void> {
  if (started) return () => {};
  started = true;

  await requestNotificationPermission();

  const token = await getFcmToken();
  if (token) {
    // Register with the relay so the server can wake this device when offline.
    getClient().registerPushToken(token);
    console.log('[push] FCM token registered');
  } else {
    console.log('[push] no FCM token (module not linked or Play Services missing)');
  }

  const offWake = onPushWake(() => {
    // Woken by a content-free push — reconnect so queued messages deliver.
    void getClient().connectRelay().catch(() => {});
  });
  const offRefresh = onTokenRefresh(t => {
    getClient().registerPushToken(t);
    console.log('[push] FCM token refreshed + re-registered');
  });

  return () => {
    offWake();
    offRefresh();
    started = false;
  };
}
