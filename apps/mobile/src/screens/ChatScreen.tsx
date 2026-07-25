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
import { SCAM_CATEGORY_LABELS, type MessageStatus } from '@hwfa/models';
import { conversationStore, useMessages, type ChatMessage } from '../store/conversations';
import { formatClock } from '../util/time';
import { theme } from '../theme';

/** Delivery ticks for an outbound message: ✓ sent, ✓✓ delivered, ✓✓ (blue) read. */
function StatusTicks({ status }: { status?: MessageStatus }): React.JSX.Element | null {
  if (!status) return null;
  if (status === 'sending') return <Text style={styles.tick}>🕓</Text>;
  const read = status === 'read';
  const glyph = status === 'sent' ? '✓' : '✓✓';
  return <Text style={[styles.tick, read && styles.tickRead]}>{glyph}</Text>;
}

/** Inline scam warning shown above a flagged inbound message (not a modal). */
function ScamWarning({
  message,
  onDismiss,
}: {
  message: ChatMessage;
  onDismiss: () => void;
}): React.JSX.Element {
  const label = message.verdict?.category
    ? SCAM_CATEGORY_LABELS[message.verdict.category].toLowerCase()
    : 'a known scam';
  return (
    <View style={styles.warning}>
      <View style={styles.warningHeader}>
        <Text style={styles.warningTitle}>⚠️  Scam pattern detected</Text>
        <TouchableOpacity onPress={onDismiss} hitSlop={8}>
          <Text style={styles.warningDismiss}>✕</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.warningBody}>
        This message matches patterns common in {label}. Do not send money or
        share personal information or codes.
      </Text>
    </View>
  );
}

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
        renderItem={({ item }) => {
          const flagged = !item.mine && item.verdict?.flagged && !item.dismissed;
          return (
            <View style={styles.messageRow}>
              {flagged && (
                <ScamWarning
                  message={item}
                  onDismiss={() => conversationStore.dismissScamWarning(peerUserId, item.id)}
                />
              )}
              <View style={[styles.bubble, item.mine ? styles.out : styles.in]}>
                <Text style={styles.bubbleText}>{item.text}</Text>
                <View style={styles.meta}>
                  <Text style={styles.time}>{formatClock(item.at)}</Text>
                  {item.mine && <StatusTicks status={item.status} />}
                </View>
              </View>
            </View>
          );
        }}
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
  messageRow: { gap: 4 },
  bubble: { maxWidth: '80%', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  out: { alignSelf: 'flex-end', backgroundColor: theme.bubbleOut },
  in: { alignSelf: 'flex-start', backgroundColor: theme.bubbleIn },
  bubbleText: { color: theme.text, fontSize: 15 },
  meta: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', gap: 4, marginTop: 2 },
  time: { color: theme.textDim, fontSize: 10 },
  tick: { color: theme.textDim, fontSize: 11 },
  tickRead: { color: '#53bdeb' },
  warning: {
    alignSelf: 'flex-start',
    maxWidth: '90%',
    backgroundColor: '#3a2417',
    borderColor: theme.warning,
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
  },
  warningHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  warningTitle: { color: theme.warning, fontWeight: '700', fontSize: 13 },
  warningDismiss: { color: theme.warning, fontSize: 15, fontWeight: '700', paddingLeft: 12 },
  warningBody: { color: theme.text, fontSize: 13, marginTop: 4, lineHeight: 18 },
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
