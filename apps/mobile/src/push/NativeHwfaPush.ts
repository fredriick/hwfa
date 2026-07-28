/**
 * Typed access to the `HwfaPush` native module (see
 * android/.../push/HwfaPushModule.kt). Thin JS ↔ native seam; `push.ts` wraps it
 * with permission handling and event subscriptions.
 */
import { NativeModules } from 'react-native';

export interface NativeHwfaPushSpec {
  /** The device's current FCM registration token. */
  getToken(): Promise<string>;
  // Required by NativeEventEmitter (no-ops in the module).
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

const native = NativeModules.HwfaPush as NativeHwfaPushSpec | undefined;

/** True when the native push module is linked (needs a native build). */
export function hasNativePush(): boolean {
  return !!native;
}

export function getNativePush(): NativeHwfaPushSpec {
  if (!native) {
    throw new Error(
      'HwfaPush native module is not linked. Rebuild the app (npm run android) — ' +
        'a JS-only reload cannot pick up new native modules.',
    );
  }
  return native;
}
