/**
 * ChatScreen — a 1:1 conversation. Outbound text is encrypted and sent through
 * the relay by `@hwfa/client`; inbound text arrives decrypted via `onText`.
 * Messages are held in component state only (Phase 1 scaffold) — SQLCipher
 * persistence is the next step.
 */
import React, { useEffect, useRef, useState } from 'react';
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
import { getClient } from '../client/hwfaClient';
import { theme } from '../theme';

interface Props {
  peerUserId: string;
  peerPhone: string;
  onBack: () => void;
}

interface ChatMessage {
  id: string;
  text: string;
  mine: boolean;
}

export function ChatScreen({ peerUserId, peerPhone, onBack }: Props): React.JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const counter = useRef(0);

  const nextId = () => `m${counter.current++}`;

  useEffect(() => {
    // Deliver inbound texts from this peer into the list.
    getClient().onText(msg => {
      if (msg.fromUserId !== peerUserId) return;
      setMessages(prev => [...prev, { id: nextId(), text: msg.text, mine: false }]);
    });
    // Note: onText handlers accumulate for the app's lifetime in this scaffold;
    // a real unsubscribe belongs on the client API before production.
  }, [peerUserId]);

  async function handleSend() {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    setError(null);
    setMessages(prev => [...prev, { id: nextId(), text, mine: true }]);
    try {
      await getClient().sendText(peerUserId, text);
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
          <Text style={styles.peer}>{peerPhone}</Text>
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
