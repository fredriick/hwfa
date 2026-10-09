/**
 * LinkedDevicesScreen — review and revoke the devices on this account.
 *
 * Lists the primary device plus any linked ones (from the Discovery account).
 * A linked device can be revoked, which removes it from the account directory
 * so peers stop fanning messages out to it and its key bundle is gone. The
 * primary can't be revoked here — deleting the whole account is the way to
 * remove it (Settings → Delete my account).
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { DeviceInfo } from '@hwfa/client';
import { getClient } from '../client/hwfaClient';
import { theme } from '../theme';

interface Props {
  myUserId: string;
  onBack: () => void;
}

export function LinkedDevicesScreen({ myUserId, onBack }: Props): React.JSX.Element {
  const [devices, setDevices] = useState<DeviceInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setDevices(await getClient().myDevices());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function confirmRevoke(d: DeviceInfo) {
    Alert.alert(
      'Revoke this device?',
      'It will be removed from your account and stop receiving your messages. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Revoke', style: 'destructive', onPress: () => void revoke(d) },
      ],
    );
  }

  async function revoke(d: DeviceInfo) {
    setBusyId(d.userId);
    setError(null);
    try {
      await getClient().removeDevice(d.userId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={onBack} hitSlop={10}>
          <Text style={styles.back}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.heading}>Linked devices</Text>
      </View>

      {devices === null && !error ? (
        <ActivityIndicator color={theme.accent} style={styles.spinner} />
      ) : (
        <FlatList
          style={styles.list}
          data={devices ?? []}
          keyExtractor={d => d.userId}
          ListEmptyComponent={
            error ? null : <Text style={styles.empty}>No devices found.</Text>
          }
          renderItem={({ item }) => {
            const isThis = item.userId === myUserId;
            return (
              <View style={styles.row}>
                <View style={styles.rowText}>
                  <Text style={styles.rowName}>
                    {item.primary ? 'Primary device' : 'Linked device'}
                    {isThis ? ' (this device)' : ''}
                  </Text>
                  <Text style={styles.rowId}>
                    {item.userId.slice(0, 8)}… · device {item.deviceId}
                  </Text>
                </View>
                {item.primary ? (
                  <Text style={styles.primaryTag}>primary</Text>
                ) : busyId === item.userId ? (
                  <ActivityIndicator color={theme.danger} />
                ) : (
                  <TouchableOpacity onPress={() => confirmRevoke(item)} hitSlop={8}>
                    <Text style={styles.revoke}>Revoke</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          }}
        />
      )}

      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg, padding: 24 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  back: { color: theme.text, fontSize: 34, lineHeight: 34, marginRight: 4 },
  heading: { color: theme.text, fontSize: 24, fontWeight: '700' },
  spinner: { marginTop: 40 },
  list: { marginTop: 20 },
  empty: { color: theme.textDim, marginTop: 40, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.hairline,
  },
  rowText: { flex: 1 },
  rowName: { color: theme.text, fontSize: 16, fontWeight: '600' },
  rowId: { color: theme.textDim, fontSize: 12, marginTop: 2, fontFamily: 'monospace' },
  primaryTag: { color: theme.textDim, fontSize: 12 },
  revoke: { color: theme.danger, fontSize: 15, fontWeight: '700' },
  error: { color: theme.danger, marginTop: 20, textAlign: 'center' },
});
