/**
 * SettingsScreen — account, privacy, notifications, and sign-out.
 *
 * Everything here reads/acts through the platform seams already in the app: the
 * native crypto store (account + reset), the push permission helper, and the
 * conversation store. Signing out wipes the on-device identity and history and
 * returns to onboarding.
 */
import React, { useEffect, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { getClient } from '../client/hwfaClient';
import { getNativeCrypto } from '../crypto/NativeHwfaCrypto';
import { conversationStore } from '../store/conversations';
import { useConnectionState } from '../store/connection';
import { requestNotificationPermission } from '../push/push';
import { theme } from '../theme';

interface Props {
  myUserId: string;
  onBack: () => void;
  onSignedOut: () => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function Row({
  label,
  value,
  onPress,
  danger,
}: {
  label: string;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
}) {
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={0.7}>
      <Text style={[styles.rowLabel, danger && styles.rowDanger]}>{label}</Text>
      {value !== undefined && <Text style={styles.rowValue}>{value}</Text>}
    </TouchableOpacity>
  );
}

export function SettingsScreen({ myUserId, onBack, onSignedOut }: Props): React.JSX.Element {
  const conn = useConnectionState();
  const [phone, setPhone] = useState<string | null>(null);
  const [notif, setNotif] = useState<'unknown' | 'granted' | 'denied'>('unknown');

  useEffect(() => {
    void getNativeCrypto()
      .loadAccount()
      .then(a => setPhone(a?.phone ?? null))
      .catch(() => setPhone(null));
  }, []);

  async function enableNotifications() {
    try {
      const ok = await requestNotificationPermission();
      setNotif(ok ? 'granted' : 'denied');
    } catch {
      setNotif('denied');
    }
  }

  function confirmSignOut() {
    Alert.alert(
      'Sign out?',
      'This erases your identity and message history on this device. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: () => void signOut(),
        },
      ],
    );
  }

  async function signOut() {
    try {
      getClient().close();
    } catch {
      /* ignore */
    }
    await conversationStore.reset();
    try {
      await getNativeCrypto().reset();
    } catch {
      /* ignore */
    }
    onSignedOut();
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} hitSlop={10}>
          <Text style={styles.back}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Settings</Text>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.profile}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>H</Text>
          </View>
          <Text style={styles.profileName}>{phone ?? 'You'}</Text>
          <Text style={styles.profileId}>{myUserId}</Text>
        </View>

        <Section title="Account">
          {phone && <Row label="Phone" value={phone} />}
          <Row label="Account ID" value={`${myUserId.slice(0, 12)}…`} />
          <Row
            label="Relay"
            value={conn === 'connected' ? 'Connected' : conn === 'connecting' ? 'Connecting…' : 'Offline'}
          />
        </Section>

        <Section title="Notifications">
          <Row
            label="Push notifications"
            value={notif === 'granted' ? 'Enabled' : notif === 'denied' ? 'Denied' : 'Enable'}
            onPress={enableNotifications}
          />
        </Section>

        <Section title="Privacy & security">
          <Row label="End-to-end encryption" value="On" />
          <Row label="On-device scam detection" value="On" />
        </Section>

        <Section title="About">
          <Row label="Version" value="0.0.1" />
          <Row label="Backend" value="ciphertext-only" />
        </Section>

        <Section title="Danger zone">
          <Row label="Sign out & erase this device" danger onPress={confirmSignOut} />
        </Section>

        <Text style={styles.footer}>
          Hwfa stores only ciphertext on the server; your phone number is kept as a
          salted hash. Keys never leave this device.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.hairline,
  },
  back: { color: theme.text, fontSize: 34, lineHeight: 34 },
  title: { color: theme.text, fontSize: 18, fontWeight: '700' },
  body: { padding: 16, paddingBottom: 40 },
  profile: { alignItems: 'center', marginBottom: 12 },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  avatarText: { color: theme.bg, fontSize: 36, fontWeight: '800' },
  profileName: { color: theme.text, fontSize: 18, fontWeight: '700' },
  profileId: { color: theme.textDim, fontSize: 12, marginTop: 4 },
  section: { marginTop: 20 },
  sectionTitle: {
    color: theme.textDim,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginLeft: 4,
  },
  card: {
    backgroundColor: theme.surface,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.hairline,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 15,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.hairline,
  },
  rowLabel: { color: theme.text, fontSize: 15, flexShrink: 1 },
  rowDanger: { color: theme.danger, fontWeight: '600' },
  rowValue: { color: theme.textDim, fontSize: 14 },
  footer: { color: theme.textDim, fontSize: 12, lineHeight: 18, marginTop: 24, textAlign: 'center' },
});
