/**
 * ContactsScreen — find a peer by phone number via privacy-preserving contact
 * discovery (salted-hash intersection through Discovery), then open a chat. The
 * server never sees the raw number; `@hwfa/client` hashes it with the fetched
 * salt before the intersect call.
 */
import React, { useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { getClient } from '../client/hwfaClient';
import { conversationStore } from '../store/conversations';
import { theme } from '../theme';

interface Props {
  myUserId: string;
  onOpenChat: (peerUserId: string, peerPhone: string) => void;
  onBack: () => void;
}

export function ContactsScreen({ myUserId, onOpenChat, onBack }: Props): React.JSX.Element {
  const [phone, setPhone] = useState('+234');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function handleFind() {
    setBusy(true);
    setStatus(null);
    try {
      const peerId = await getClient().findContact(phone.trim());
      if (peerId) {
        conversationStore.ensurePeer(peerId, phone.trim());
        onOpenChat(peerId, phone.trim());
      } else {
        setStatus('No Hwfa account is registered for that number.');
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg, padding: 24 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  back: { color: theme.text, fontSize: 34, lineHeight: 34, marginRight: 4 },
  heading: { color: theme.text, fontSize: 26, fontWeight: '700' },
  you: { color: theme.textDim, marginTop: 4, marginBottom: 32 },
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
    marginTop: 24,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: theme.text, fontSize: 16, fontWeight: '700' },
  status: { color: theme.textDim, marginTop: 20, textAlign: 'center' },
});
