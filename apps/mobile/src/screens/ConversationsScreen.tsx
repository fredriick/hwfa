/**
 * ConversationsScreen — the home list of threads. Reads the app-level store, so
 * a message from any peer appears here (with an unread badge) even if that chat
 * has never been opened. Tap a row to open it, or start a new one by phone.
 */
import React from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useConversations, type Conversation } from '../store/conversations';
import { theme } from '../theme';

interface Props {
  myUserId: string;
  onNewChat: () => void;
  onOpenChat: (peerUserId: string, peerPhone?: string) => void;
}

function title(conv: Conversation): string {
  return conv.peerPhone ?? `${conv.peerUserId.slice(0, 8)}…`;
}

function preview(conv: Conversation): string {
  const last = conv.messages[conv.messages.length - 1];
  if (!last) return 'No messages yet';
  return `${last.mine ? 'You: ' : ''}${last.text}`;
}

export function ConversationsScreen({ myUserId, onNewChat, onOpenChat }: Props): React.JSX.Element {
  const conversations = useConversations();

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.heading}>Chats</Text>
          <Text style={styles.you}>You are {myUserId.slice(0, 8)}…</Text>
        </View>
        <TouchableOpacity style={styles.newButton} onPress={onNewChat}>
          <Text style={styles.newButtonText}>New chat</Text>
        </TouchableOpacity>
      </View>

      {conversations.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No conversations yet.</Text>
          <Text style={styles.emptyHint}>Tap “New chat” to find someone by phone number.</Text>
        </View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={c => c.peerUserId}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.row}
              onPress={() => onOpenChat(item.peerUserId, item.peerPhone)}>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{title(item)}</Text>
                <Text style={styles.rowPreview} numberOfLines={1}>
                  {preview(item)}
                </Text>
              </View>
              {item.unread > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{item.unread}</Text>
                </View>
              )}
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 16,
  },
  headerText: { flex: 1 },
  heading: { color: theme.text, fontSize: 26, fontWeight: '700' },
  you: { color: theme.textDim, marginTop: 4 },
  newButton: {
    backgroundColor: theme.accent,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  newButtonText: { color: theme.text, fontWeight: '700' },
  list: { paddingHorizontal: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: theme.surface,
    marginBottom: 8,
  },
  rowText: { flex: 1 },
  rowTitle: { color: theme.text, fontSize: 16, fontWeight: '600' },
  rowPreview: { color: theme.textDim, marginTop: 2 },
  badge: {
    backgroundColor: theme.accent,
    borderRadius: 12,
    minWidth: 24,
    height: 24,
    paddingHorizontal: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: theme.text, fontSize: 12, fontWeight: '700' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyText: { color: theme.text, fontSize: 16 },
  emptyHint: { color: theme.textDim, marginTop: 8, textAlign: 'center' },
});
