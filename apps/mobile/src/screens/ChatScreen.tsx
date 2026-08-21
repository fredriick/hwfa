/**
 * ChatScreen — a 1:1 conversation. Messages live in the app-level conversation
 * store (so inbound arrives whether or not this screen is open); this component
 * just renders the thread and sends. Outbound text is encrypted and sent through
 * the relay by `@hwfa/client`; inbound is decrypted upstream and fanned into the
 * store's per-peer inbox.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SCAM_CATEGORY_LABELS, type MessageStatus } from '@hwfa/models';
import {
  conversationStore,
  useConversations,
  useMessages,
  type ChatMessage,
} from '../store/conversations';
import { useTyping } from '../store/typing';
import { pickImage } from '../media/imagePicker';
import { callManager } from '../call/manager';
import { falsePositiveReporter } from '../scam/reporter';
import { formatClock } from '../util/time';
import { theme } from '../theme';

/** Re-announce "typing" at most this often while the user keeps typing. */
const TYPING_THROTTLE_MS = 3000;
/** Clear our typing signal after this long with no keystroke. */
const TYPING_IDLE_MS = 4000;

/** Delivery ticks for an outbound message: ✓ sent, ✓✓ delivered, ✓✓ (blue) read. */
function StatusTicks({ status }: { status?: MessageStatus }): React.JSX.Element | null {
  if (!status) return null;
  if (status === 'sending') return <Text style={styles.tick}>🕓</Text>;
  const read = status === 'read';
  const glyph = status === 'sent' ? '✓' : '✓✓';
  return <Text style={[styles.tick, read && styles.tickRead]}>{glyph}</Text>;
}

/** An image attachment inside a bubble: preview, spinner, or a tap-to-retry error. */
function MediaBubble({
  message,
  onRetry,
}: {
  message: ChatMessage;
  onRetry: () => void;
}): React.JSX.Element {
  if (message.mediaUri) {
    return <Image source={{ uri: message.mediaUri }} style={styles.image} resizeMode="cover" />;
  }
  if (message.mediaState === 'error') {
    return (
      <TouchableOpacity style={styles.imagePlaceholder} onPress={onRetry}>
        <Text style={styles.imageNote}>Couldn't load photo</Text>
        <Text style={styles.imageRetry}>Tap to retry</Text>
      </TouchableOpacity>
    );
  }
  return (
    <View style={styles.imagePlaceholder}>
      <ActivityIndicator color={theme.textDim} />
      <Text style={styles.imageNote}>Loading photo…</Text>
    </View>
  );
}

/** Inline scam warning shown above a flagged inbound message (not a modal). */
function ScamWarning({
  message,
  onDismiss,
  onReport,
}: {
  message: ChatMessage;
  onDismiss: () => void;
  onReport: () => void;
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
      <TouchableOpacity onPress={onReport} hitSlop={6}>
        <Text style={styles.warningReport}>Not a scam? Report</Text>
      </TouchableOpacity>
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
  const conversations = useConversations();
  const group = conversations.find(c => c.peerUserId === peerUserId)?.group;
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const typingSenders = useTyping(peerUserId);

  // Outbound typing throttle: announce "typing" at most once per interval, and
  // clear it after a short idle pause. Refs (not state) so it never re-renders.
  const lastTypingSent = useRef(0);
  const typingActive = useRef(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopTyping = useCallback(() => {
    if (idleTimer.current) {
      clearTimeout(idleTimer.current);
      idleTimer.current = null;
    }
    if (typingActive.current) {
      typingActive.current = false;
      lastTypingSent.current = 0;
      conversationStore.sendTyping(peerUserId, false);
    }
  }, [peerUserId]);

  const handleDraftChange = useCallback(
    (text: string) => {
      setDraft(text);
      if (text.length === 0) {
        stopTyping();
        return;
      }
      const now = Date.now();
      if (now - lastTypingSent.current > TYPING_THROTTLE_MS) {
        lastTypingSent.current = now;
        typingActive.current = true;
        conversationStore.sendTyping(peerUserId, true);
      }
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(stopTyping, TYPING_IDLE_MS);
    },
    [peerUserId, stopTyping],
  );

  // Stop typing when the thread closes or the peer changes.
  useEffect(() => stopTyping, [peerUserId, stopTyping]);

  const headerTitle = group ? group.name : peerPhone ?? `${peerUserId.slice(0, 8)}…`;
  let headerSub: string;
  if (typingSenders.length > 0) {
    headerSub = group
      ? `${typingSenders[0]!.slice(0, 8)}… is typing…`
      : 'typing…';
  } else {
    headerSub = group ? `${group.members.length + 1} members` : `${peerUserId.slice(0, 8)}…`;
  }

  // Opening the thread clears its unread badge.
  useEffect(() => {
    conversationStore.markRead(peerUserId);
  }, [peerUserId, messages.length]);

  // Fetch + decrypt any attachments without an in-memory preview (e.g. restored
  // from disk, where the plaintext bytes aren't persisted).
  useEffect(() => {
    conversationStore.loadPendingMedia(peerUserId);
  }, [peerUserId, messages.length]);

  async function handleSend() {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    setError(null);
    stopTyping();
    try {
      await conversationStore.send(peerUserId, text);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleAttach() {
    setError(null);
    try {
      const image = await pickImage();
      if (!image) return; // cancelled
      await conversationStore.sendMedia(peerUserId, image);
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
        <View style={styles.headerText}>
          <Text style={styles.peer}>{headerTitle}</Text>
          <Text style={[styles.peerId, typingSenders.length > 0 && styles.typing]}>
            {headerSub}
          </Text>
        </View>
        {!group && (
          <View style={styles.callButtons}>
            <TouchableOpacity
              hitSlop={8}
              onPress={() => void callManager.start(peerUserId, peerPhone, false)}>
              <Text style={styles.callGlyph}>📞</Text>
            </TouchableOpacity>
            <TouchableOpacity
              hitSlop={8}
              onPress={() => void callManager.start(peerUserId, peerPhone, true)}>
              <Text style={styles.callGlyph}>🎥</Text>
            </TouchableOpacity>
          </View>
        )}
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
                  onReport={() => {
                    if (item.verdict) {
                      void falsePositiveReporter.report(item.text, item.verdict);
                    }
                    conversationStore.dismissScamWarning(peerUserId, item.id);
                  }}
                />
              )}
              <TouchableOpacity
                activeOpacity={0.8}
                onLongPress={() => conversationStore.toggleStar(peerUserId, item.id)}
                delayLongPress={250}
                style={[
                  styles.bubble,
                  item.mine ? styles.out : styles.in,
                  item.media && styles.mediaBubble,
                ]}>
                {group && !item.mine && item.senderId && (
                  <Text style={styles.sender}>{item.senderId.slice(0, 8)}…</Text>
                )}
                {item.media ? (
                  <MediaBubble
                    message={item}
                    onRetry={() => conversationStore.loadPendingMedia(peerUserId)}
                  />
                ) : (
                  <Text style={styles.bubbleText}>{item.text}</Text>
                )}
                <View style={styles.meta}>
                  {item.starred && <Text style={styles.star}>★</Text>}
                  <Text style={styles.time}>{formatClock(item.at)}</Text>
                  {item.mine && <StatusTicks status={item.status} />}
                </View>
              </TouchableOpacity>
            </View>
          );
        }}
      />

      {error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.composer}>
        <TouchableOpacity style={styles.attachButton} onPress={handleAttach} hitSlop={8}>
          <Text style={styles.attachIcon}>＋</Text>
        </TouchableOpacity>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={handleDraftChange}
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
  headerText: { flex: 1 },
  callButtons: { flexDirection: 'row', gap: 18, paddingRight: 4 },
  callGlyph: { fontSize: 22 },
  peer: { color: theme.text, fontSize: 16, fontWeight: '700' },
  peerId: { color: theme.textDim, fontSize: 12 },
  typing: { color: theme.neon, fontStyle: 'italic' },
  list: { padding: 12, gap: 8 },
  messageRow: { gap: 4 },
  bubble: { maxWidth: '80%', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  mediaBubble: { padding: 4 },
  out: { alignSelf: 'flex-end', backgroundColor: theme.bubbleOut },
  in: { alignSelf: 'flex-start', backgroundColor: theme.bubbleIn },
  bubbleText: { color: theme.text, fontSize: 15 },
  sender: { color: theme.neon, fontSize: 12, fontWeight: '700', marginBottom: 2 },
  image: { width: 220, height: 220, borderRadius: 10, backgroundColor: theme.bg },
  imagePlaceholder: {
    width: 220,
    height: 220,
    borderRadius: 10,
    backgroundColor: theme.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  imageNote: { color: theme.textDim, fontSize: 12 },
  imageRetry: { color: theme.accent, fontSize: 12, fontWeight: '600' },
  meta: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', gap: 4, marginTop: 2 },
  time: { color: theme.textDim, fontSize: 10 },
  star: { color: theme.warning, fontSize: 11 },
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
  warningReport: { color: theme.warning, fontSize: 12, marginTop: 6, fontWeight: '600' },
  error: { color: theme.danger, textAlign: 'center', paddingHorizontal: 16, paddingBottom: 8 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 8,
    gap: 8,
    backgroundColor: theme.surface,
  },
  attachButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.bg,
  },
  attachIcon: { color: theme.accent, fontSize: 26, lineHeight: 28 },
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
