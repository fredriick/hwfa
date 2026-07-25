/**
 * ChatScreen — a 1:1 conversation. Messages live in the app-level conversation
 * store (so inbound arrives whether or not this screen is open); this component
 * just renders the thread and sends. Outbound text is encrypted and sent through
 * the relay by `@hwfa/client`; inbound is decrypted upstream and fanned into the
 * store's per-peer inbox.
 */
import React, { useEffect, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { conversationStore, useMessages } from '../store/conversations';
import { theme } from '../theme';

interface Props {
  peerUserId: string;
  peerPhone?: string;
  onBack: () => void;
}

export function ChatScreen({ peerUserId, peerPhone, onBack }: Props): React.JSX.Element {
  const messages = useMessages(peerUserId);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Opening the thread clears its unread badge.
  useEffect(() => {
    conversationStore.markRead(peerUserId);
  }, [peerUserId, messages.length]);

  async function handleSend() {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    setError(null);
    try {
      await conversationStore.send(peerUserId, text);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.back}>‹</Text>
        </TouchableOpacity>
        <View>
          <Text style={styles.peer}>{peerPhone ?? `${peerUserId.slice(0, 8)}…`}</Text>
          <Text style={styles.peerId}>{peerUserId.slice(0, 8)}…</Text>
        </View>
      </View>

      <FlatList
        data={messages}
        keyExtractor={m => m.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={[styles.bubble, item.mine ? styles.out : styles.in]}>
            <Text style={styles.bubbleText}>{item.text}</Text>
          </View>
        )}
      />

      {error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Message"
          placeholderTextColor={theme.textDim}
          multiline
        />
        <TouchableOpacity style={styles.sendButton} onPress={handleSend}>
          <Text style={styles.sendText}>Send</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
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
    backgroundColor: theme.surface,
  },
  back: { color: theme.text, fontSize: 34, lineHeight: 34, marginRight: 4 },
  peer: { color: theme.text, fontSize: 16, fontWeight: '700' },
  peerId: { color: theme.textDim, fontSize: 12 },
  list: { padding: 12, gap: 8 },
  bubble: { maxWidth: '80%', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  out: { alignSelf: 'flex-end', backgroundColor: theme.bubbleOut },
  in: { alignSelf: 'flex-start', backgroundColor: theme.bubbleIn },
  bubbleText: { color: theme.text, fontSize: 15 },
  error: { color: theme.danger, textAlign: 'center', paddingHorizontal: 16, paddingBottom: 8 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 8,
    gap: 8,
    backgroundColor: theme.surface,
  },
  input: {
    flex: 1,
    backgroundColor: theme.bg,
    color: theme.text,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    maxHeight: 120,
  },
  sendButton: {
    backgroundColor: theme.accent,
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  sendText: { color: theme.text, fontWeight: '700' },
});
