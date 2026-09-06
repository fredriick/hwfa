/**
 * Device address-book reader — thin JS wrapper over the `HwfaContacts` native
 * module, with the READ_CONTACTS runtime-permission dance.
 *
 * Returns raw {name, number} entries; the caller normalizes and hashes them
 * before anything leaves the device (see contact discovery in ContactsScreen).
 */
import { NativeModules, PermissionsAndroid, Platform } from 'react-native';

export interface DeviceContact {
  name: string;
  number: string;
}

interface NativeContactsSpec {
  getPhoneNumbers(): Promise<DeviceContact[]>;
}

const native = NativeModules.HwfaContacts as NativeContactsSpec | undefined;

/** Whether the native contacts module is linked in this build. */
export function hasContacts(): boolean {
  return !!native;
}

/** Request READ_CONTACTS. Resolves true if granted. */
export async function ensureContactsPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  const already = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_CONTACTS);
  if (already) return true;
  const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_CONTACTS, {
    title: 'Find your contacts on Hwfa',
    message:
      'Hwfa checks which of your contacts already use Hwfa. Numbers are hashed on your device — the server never sees them.',
    buttonPositive: 'Allow',
    buttonNegative: 'Not now',
  });
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

/**
 * Read the device address book. Throws if the native module isn't linked;
 * returns [] if permission is denied.
 */
export async function readDeviceContacts(): Promise<DeviceContact[]> {
  if (!native) {
    throw new Error('HwfaContacts native module is not linked. Rebuild the app (npm run android).');
  }
  const granted = await ensureContactsPermission();
  if (!granted) return [];
  return native.getPhoneNumbers();
}
