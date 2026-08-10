/**
 * StarredScreen — every message the user has starred, across all conversations.
 * Long-press a bubble in a chat to star it (see ChatScreen). Tap a row here to
 * jump to that conversation. Reads the app-level store, so it stays live.
 */
import React, { useMemo } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useConversations, type StarredMessage } from '../store/conversations';
import { formatRelative } from '../util/time';
import { theme } from '../theme';

interface Props {
  onBack: () => void;
  onOpenChat: (peerUserId: string, peerPhone?: string) => void;
}

export function StarredScreen({ onBack, onOpenChat }: Props): React.JSX.Element {
  const conversations = useConversations();
  const starred = useMemo<StarredMessage[]>(() => {
    const out: StarredMessage[] = [];
    for (const c of conversations) {
      for (const m of c.messages) {
        if (m.starred) out.push({ message: m, peerUserId: c.peerUserId, peerPhone: c.peerPhone });
      }
    }
    return out.sort((a, b) => b.message.at - a.message.at);
  }, [conversations]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} hitSlop={10}>
          <Text style={styles.back}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Starred messages</Text>
      </View>

      {starred.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyStar}>★</Text>
          <Text style={styles.emptyTitle}>No starred messages</Text>
          <Text style={styles.emptyHint}>
            Long-press any message in a chat to star it for quick access here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={starred}
          keyExtractor={s => `${s.peerUserId}:${s.message.id}`}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const name = item.peerPhone ?? `${item.peerUserId.slice(0, 8)}…`;
            const body = item.message.media ? '📷 Photo' : item.message.text;
            return (
              <TouchableOpacity
                style={styles.row}
                onPress={() => onOpenChat(item.peerUserId, item.peerPhone)}
                activeOpacity={0.7}>
                <View style={styles.rowHead}>
                  <Text style={styles.rowName} numberOfLines={1}>
                    {item.message.mine ? 'You → ' : ''}
                    {name}
                  </Text>
                  <Text style={styles.rowTime}>{formatRelative(item.message.at)}</Text>
                </View>
                <Text style={styles.rowBody} numberOfLines={2}>
                  {body}
                </Text>
              </TouchableOpacity>
            );
          }}
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
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.hairline,
  },
  back: { color: theme.text, fontSize: 34, lineHeight: 34 },
  title: { color: theme.text, fontSize: 18, fontWeight: '700' },
  list: { padding: 12, gap: 8 },
  row: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.hairline,
  },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  rowName: { color: theme.neon, fontSize: 13, fontWeight: '700', flex: 1 },
  rowTime: { color: theme.textDim, fontSize: 11 },
  rowBody: { color: theme.text, fontSize: 15, marginTop: 6 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyStar: { color: theme.warning, fontSize: 44 },
  emptyTitle: { color: theme.text, fontSize: 18, fontWeight: '700', marginTop: 12 },
  emptyHint: { color: theme.textDim, marginTop: 8, textAlign: 'center', lineHeight: 20, maxWidth: 300 },
});
