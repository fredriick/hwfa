/**
 * NewGroupScreen — create a client-side group.
 *
 * Pick members from your existing 1:1 conversations, name the group, and create
 * it. Messages then fan out end-to-end encrypted to each member (see the
 * conversation store's group path). There's no server-side group.
 */
import React, { useMemo, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { conversationStore, useConversations, type Conversation } from '../store/conversations';
import { theme } from '../theme';

interface Props {
  onBack: () => void;
  onCreated: (groupId: string) => void;
}

export function NewGroupScreen({ onBack, onCreated }: Props): React.JSX.Element {
  const conversations = useConversations();
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Candidate members: existing 1:1 peers (exclude groups).
  const peers = useMemo<Conversation[]>(
    () => conversations.filter(c => !c.group),
    [conversations],
  );

  function toggle(peerUserId: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(peerUserId)) next.delete(peerUserId);
      else next.add(peerUserId);
      return next;
    });
  }

  function create() {
    const members = [...selected];
    if (members.length === 0) return;
    const groupName = name.trim() || 'New group';
    const gid = conversationStore.createGroup(groupName, members);
    onCreated(gid);
  }

  const canCreate = selected.size > 0;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} hitSlop={10}>
          <Text style={styles.back}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.title}>New group</Text>
        <TouchableOpacity onPress={create} disabled={!canCreate} hitSlop={10}>
          <Text style={[styles.create, !canCreate && styles.createOff]}>Create</Text>
        </TouchableOpacity>
      </View>

      <TextInput
        style={styles.nameInput}
        value={name}
        onChangeText={setName}
        placeholder="Group name"
        placeholderTextColor={theme.textDim}
      />

      <Text style={styles.sectionLabel}>
        Members {selected.size > 0 ? `(${selected.size})` : ''}
      </Text>

      {peers.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No contacts yet</Text>
          <Text style={styles.emptyHint}>
            Start a 1:1 chat first, then you can add people to a group.
          </Text>
        </View>
      ) : (
        <FlatList
          data={peers}
          keyExtractor={c => c.peerUserId}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const label = item.peerPhone ?? `${item.peerUserId.slice(0, 8)}…`;
            const on = selected.has(item.peerUserId);
            const initial =
              label.replace(/[^0-9a-zA-Z]/g, '').slice(-2).toUpperCase() || '#';
            return (
              <TouchableOpacity
                style={styles.row}
                onPress={() => toggle(item.peerUserId)}
                activeOpacity={0.7}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{initial}</Text>
                </View>
                <Text style={styles.rowLabel}>{label}</Text>
                <View style={[styles.check, on && styles.checkOn]}>
                  {on && <Text style={styles.checkMark}>✓</Text>}
                </View>
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
  title: { color: theme.text, fontSize: 18, fontWeight: '700', flex: 1 },
  create: { color: theme.neon, fontSize: 16, fontWeight: '800' },
  createOff: { color: theme.textDim },
  nameInput: {
    backgroundColor: theme.surface,
    color: theme.text,
    fontSize: 16,
    margin: 16,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.hairline,
  },
  sectionLabel: {
    color: theme.textDim,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginHorizontal: 20,
    marginBottom: 4,
  },
  list: { padding: 12, gap: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: theme.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.hairline,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: theme.elevated,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.hairline,
  },
  avatarText: { color: theme.neon, fontSize: 15, fontWeight: '800' },
  rowLabel: { color: theme.text, fontSize: 16, flex: 1 },
  check: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: theme.textDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  checkMark: { color: theme.bg, fontSize: 15, fontWeight: '800' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyText: { color: theme.text, fontSize: 16, fontWeight: '700' },
  emptyHint: { color: theme.textDim, marginTop: 8, textAlign: 'center', lineHeight: 20 },
});
