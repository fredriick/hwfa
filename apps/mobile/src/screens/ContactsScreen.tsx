/**
 * ContactsScreen — start a chat two ways, both via privacy-preserving contact
 * discovery (salted-hash intersection through Discovery; the server never sees a
 * raw number):
 *   • Find one contact by typing a phone number.
 *   • Scan your address book to see which of your contacts already use Hwfa.
 *
 * For the scan, `@hwfa/client` fetches the salt once, hashes every normalized
 * number on-device, and intersects in a single round-trip.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { getClient } from '../client/hwfaClient';
import { getNativeCrypto } from '../crypto/NativeHwfaCrypto';
import { conversationStore } from '../store/conversations';
import { readDeviceContacts, hasContacts } from '../contacts/deviceContacts';
import { callingCodeOf, normalizeE164 } from '../contacts/normalize';
import { theme } from '../theme';

interface Props {
  myUserId: string;
  onOpenChat: (peerUserId: string, peerPhone: string) => void;
  onBack: () => void;
}

interface Match {
  userId: string;
  phoneNumber: string;
  name: string;
}

export function ContactsScreen({ myUserId, onOpenChat, onBack }: Props): React.JSX.Element {
  const [phone, setPhone] = useState('+234');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const [scanning, setScanning] = useState(false);
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [ownPhone, setOwnPhone] = useState<string | null>(null);

  useEffect(() => {
    void getNativeCrypto()
      .loadAccount()
      .then(a => setOwnPhone(a?.phone ?? null))
      .catch(() => setOwnPhone(null));
  }, []);

  const defaultCallingCode = useMemo(
    () => (ownPhone ? callingCodeOf(ownPhone) ?? undefined : undefined),
    [ownPhone],
  );

  function openChat(peerId: string, peerPhone: string) {
    conversationStore.ensurePeer(peerId, peerPhone);
    onOpenChat(peerId, peerPhone);
  }

  async function handleFind() {
    setBusy(true);
    setStatus(null);
    try {
      const peerId = await getClient().findContact(phone.trim());
      if (peerId) {
        openChat(peerId, phone.trim());
      } else {
        setStatus('No Hwfa account is registered for that number.');
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleScan() {
    setScanning(true);
    setScanNote(null);
    setMatches(null);
    try {
      const contacts = await readDeviceContacts();
      if (contacts.length === 0) {
        setScanNote('No contacts to scan (permission denied or address book empty).');
        return;
      }
      // Normalize + de-dupe, keeping the first name seen for each number.
      const nameByNumber = new Map<string, string>();
      for (const c of contacts) {
        const e164 = normalizeE164(c.number, defaultCallingCode);
        if (!e164 || e164 === ownPhone) continue;
        if (!nameByNumber.has(e164)) nameByNumber.set(e164, c.name || e164);
      }
      const numbers = [...nameByNumber.keys()];
      if (numbers.length === 0) {
        setScanNote('No valid phone numbers found in your contacts.');
        return;
      }
      const found = await getClient().discoverContacts(numbers);
      const rows: Match[] = found.map(f => ({
        userId: f.userId,
        phoneNumber: f.phoneNumber,
        name: nameByNumber.get(f.phoneNumber) ?? f.phoneNumber,
      }));
      rows.sort((a, b) => a.name.localeCompare(b.name));
      setMatches(rows);
      if (rows.length === 0) {
        setScanNote(`Scanned ${numbers.length} contacts — none are on Hwfa yet.`);
      }
    } catch (e) {
      setScanNote(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.back}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.heading}>New chat</Text>
      </View>
      <Text style={styles.you}>You are {myUserId.slice(0, 8)}…</Text>

      <Text style={styles.label}>Contact's phone number</Text>
      <TextInput
        style={styles.input}
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        placeholder="+234…"
        placeholderTextColor={theme.textDim}
      />
      <TouchableOpacity
        style={[styles.button, busy && styles.buttonDisabled]}
        onPress={handleFind}
        disabled={busy}>
        {busy ? (
          <ActivityIndicator color={theme.text} />
        ) : (
          <Text style={styles.buttonText}>Find & message</Text>
        )}
      </TouchableOpacity>
      {status && <Text style={styles.status}>{status}</Text>}

      {hasContacts() && (
        <>
          <View style={styles.divider} />
          <Text style={styles.label}>Or find people you already know</Text>
          <TouchableOpacity
            style={[styles.buttonAlt, scanning && styles.buttonDisabled]}
            onPress={handleScan}
            disabled={scanning}>
            {scanning ? (
              <ActivityIndicator color={theme.accent} />
            ) : (
              <Text style={styles.buttonAltText}>Find contacts on Hwfa</Text>
            )}
          </TouchableOpacity>
          {scanNote && <Text style={styles.status}>{scanNote}</Text>}

          {matches && matches.length > 0 && (
            <FlatList
              style={styles.list}
              data={matches}
              keyExtractor={m => m.userId}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.row}
                  onPress={() => openChat(item.userId, item.phoneNumber)}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>
                      {item.name.slice(0, 2).toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.rowText}>
                    <Text style={styles.rowName}>{item.name}</Text>
                    <Text style={styles.rowNumber}>{item.phoneNumber}</Text>
                  </View>
                  <Text style={styles.rowChevron}>›</Text>
                </TouchableOpacity>
              )}
            />
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg, padding: 24 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  back: { color: theme.text, fontSize: 34, lineHeight: 34, marginRight: 4 },
  heading: { color: theme.text, fontSize: 26, fontWeight: '700' },
  you: { color: theme.textDim, marginTop: 4, marginBottom: 24 },
  label: { color: theme.textDim, marginBottom: 8 },
  input: {
    backgroundColor: theme.surface,
    color: theme.text,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 18,
  },
  button: {
    backgroundColor: theme.accent,
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 16,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: theme.text, fontSize: 16, fontWeight: '700' },
  buttonAlt: {
    borderColor: theme.accent,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonAltText: { color: theme.accent, fontSize: 15, fontWeight: '700' },
  divider: { height: 1, backgroundColor: theme.hairline, marginVertical: 24 },
  status: { color: theme.textDim, marginTop: 16, textAlign: 'center' },
  list: { marginTop: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: theme.accent, fontWeight: '800' },
  rowText: { flex: 1 },
  rowName: { color: theme.text, fontSize: 16, fontWeight: '600' },
  rowNumber: { color: theme.textDim, fontSize: 12, marginTop: 2 },
  rowChevron: { color: theme.textDim, fontSize: 24 },
});
