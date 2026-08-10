/**
 * HomeScreen — the post-login shell for the P2P messenger.
 *
 * Owns the top bar (wordmark + network status + a three-dot quick-access menu)
 * and a bottom tab bar switching between Chats, Updates, Discover, and Calls.
 * The Chats tab renders the live conversation list from the app-level store;
 * the others are Phase-1 placeholders. A floating action button starts a new
 * chat from anywhere.
 */
import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { ConnectionState } from '@hwfa/client';
import { useConversations, type Conversation } from '../store/conversations';
import { useConnectionState } from '../store/connection';
import { useStatuses, type StatusItem } from '../store/statuses';
import { postStatus } from '../status/post';
import { useCallLog, type CallLogEntry } from '../call/store';
import { callManager } from '../call/manager';
import { formatRelative } from '../util/time';
import { theme } from '../theme';

type Tab = 'chats' | 'updates' | 'discover' | 'calls';

interface Props {
  myUserId: string;
  onNewChat: () => void;
  onOpenChat: (peerUserId: string, peerPhone?: string) => void;
  onSettings: () => void;
  onStarred: () => void;
  onNewGroup: () => void;
}

/** Share an invite via the OS share sheet. */
async function shareInvite(): Promise<void> {
  try {
    await Share.share({
      message:
        'Chat with me on Hwfa — encrypted messaging with on-device scam detection. https://hwfa.app',
    });
  } catch {
    /* user dismissed the share sheet */
  }
}

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'chats', label: 'Chats', icon: '💬' },
  { key: 'updates', label: 'Updates', icon: '📡' },
  { key: 'discover', label: 'Discover', icon: '🧭' },
  { key: 'calls', label: 'Calls', icon: '📞' },
];

export function HomeScreen({
  myUserId,
  onNewChat,
  onOpenChat,
  onSettings,
  onStarred,
  onNewGroup,
}: Props): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('chats');
  const [menuOpen, setMenuOpen] = useState(false);

  const runAndClose = (fn: () => void) => () => {
    setMenuOpen(false);
    fn();
  };

  return (
    <View style={styles.container}>
      <TopBar onMenu={() => setMenuOpen(true)} />

      <View style={styles.body}>
        {tab === 'chats' && <ChatsTab onOpenChat={onOpenChat} onNewChat={onNewChat} />}
        {tab === 'updates' && <UpdatesTab />}
        {tab === 'discover' && <DiscoverTab onNewChat={onNewChat} />}
        {tab === 'calls' && <CallsTab />}
      </View>

      {/* Floating action: start a new chat from any tab. */}
      <TouchableOpacity style={styles.fab} onPress={onNewChat} activeOpacity={0.85}>
        <Text style={styles.fabIcon}>＋</Text>
      </TouchableOpacity>

      <BottomNav tab={tab} onSelect={setTab} />

      <QuickMenu
        visible={menuOpen}
        myUserId={myUserId}
        onClose={() => setMenuOpen(false)}
        onNewChat={runAndClose(onNewChat)}
        onNewGroup={runAndClose(onNewGroup)}
        onStarred={runAndClose(onStarred)}
        onSettings={runAndClose(onSettings)}
        onInvite={runAndClose(() => void shareInvite())}
      />
    </View>
  );
}

const STATUS_META: Record<ConnectionState, { label: string; color: string }> = {
  connected: { label: 'peer-to-peer', color: theme.neon },
  connecting: { label: 'connecting…', color: theme.warning },
  offline: { label: 'offline', color: theme.textDim },
};

/** Top bar: brand + live network status pill + three-dot menu trigger. */
function TopBar({ onMenu }: { onMenu: () => void }): React.JSX.Element {
  const conn = useConnectionState();
  const meta = STATUS_META[conn];
  return (
    <View style={styles.topBar}>
      <View style={styles.brandRow}>
        <Text style={styles.brand}>Hwfa</Text>
        <View style={styles.statusPill}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: meta.color, shadowColor: meta.color },
              conn !== 'connected' && styles.statusDotDim,
            ]}
          />
          <Text style={styles.statusText}>{meta.label}</Text>
        </View>
      </View>
      <TouchableOpacity onPress={onMenu} hitSlop={10} style={styles.menuButton}>
        <Text style={styles.menuDots}>⋮</Text>
      </TouchableOpacity>
    </View>
  );
}

/** Bottom navigation: four tabs with a neon active indicator. */
function BottomNav({
  tab,
  onSelect,
}: {
  tab: Tab;
  onSelect: (t: Tab) => void;
}): React.JSX.Element {
  return (
    <View style={styles.nav}>
      {TABS.map(t => {
        const active = t.key === tab;
        return (
          <TouchableOpacity
            key={t.key}
            style={styles.navItem}
            onPress={() => onSelect(t.key)}
            activeOpacity={0.7}>
            <View style={[styles.navIndicator, active && styles.navIndicatorActive]} />
            <Text style={[styles.navIcon, active && styles.navIconActive]}>{t.icon}</Text>
            <Text style={[styles.navLabel, active && styles.navLabelActive]}>{t.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/** Three-dot quick-access dropdown, anchored under the top-right menu button. */
function QuickMenu({
  visible,
  myUserId,
  onClose,
  onNewChat,
  onNewGroup,
  onStarred,
  onSettings,
  onInvite,
}: {
  visible: boolean;
  myUserId: string;
  onClose: () => void;
  onNewChat: () => void;
  onNewGroup: () => void;
  onStarred: () => void;
  onSettings: () => void;
  onInvite: () => void;
}): React.JSX.Element {
  const items: { label: string; icon: string; onPress?: () => void; soon?: boolean }[] = [
    { label: 'New chat', icon: '✏️', onPress: onNewChat },
    { label: 'New group', icon: '👥', onPress: onNewGroup },
    { label: 'Starred messages', icon: '⭐', onPress: onStarred },
    { label: 'Settings', icon: '⚙️', onPress: onSettings },
    { label: 'Invite a friend', icon: '🔗', onPress: onInvite },
  ];
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View style={styles.menu}>
          <View style={styles.menuHeader}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>H</Text>
            </View>
            <View style={styles.menuHeaderText}>
              <Text style={styles.menuName}>You</Text>
              <Text style={styles.menuId}>{myUserId.slice(0, 10)}…</Text>
            </View>
          </View>
          <View style={styles.menuDivider} />
          {items.map(item => (
            <TouchableOpacity
              key={item.label}
              style={styles.menuItem}
              disabled={!item.onPress}
              onPress={item.onPress}
              activeOpacity={0.7}>
              <Text style={styles.menuItemIcon}>{item.icon}</Text>
              <Text style={[styles.menuItemText, item.soon && styles.menuItemDim]}>
                {item.label}
              </Text>
              {item.soon && <Text style={styles.soonTag}>soon</Text>}
            </TouchableOpacity>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}

// --- Chats tab (the live conversation list) ---

function convTitle(conv: Conversation): string {
  return conv.peerPhone ?? `${conv.peerUserId.slice(0, 8)}…`;
}

function convPreview(conv: Conversation): string {
  const last = conv.messages[conv.messages.length - 1];
  if (!last) return 'No messages yet';
  return `${last.mine ? 'You: ' : ''}${last.text}`;
}

function hasScam(conv: Conversation): boolean {
  return conv.messages.some(m => m.verdict?.flagged && !m.dismissed);
}

function ChatsTab({
  onOpenChat,
  onNewChat,
}: {
  onOpenChat: (peerUserId: string, peerPhone?: string) => void;
  onNewChat: () => void;
}): React.JSX.Element {
  const conversations = useConversations();

  if (conversations.length === 0) {
    return (
      <EmptyTab
        icon="🔒"
        title="No conversations yet"
        hint="Start an end-to-end encrypted chat — tap ＋ or find someone by number."
        actionLabel="New chat"
        onAction={onNewChat}
      />
    );
  }

  return (
    <FlatList
      data={conversations}
      keyExtractor={c => c.peerUserId}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => {
        const initial = convTitle(item).replace(/[^0-9a-zA-Z]/g, '').slice(-2).toUpperCase() || '#';
        return (
          <TouchableOpacity
            style={styles.row}
            onPress={() => onOpenChat(item.peerUserId, item.peerPhone)}
            activeOpacity={0.7}>
            <View style={styles.rowAvatar}>
              <Text style={styles.rowAvatarText}>{initial}</Text>
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {hasScam(item) && <Text style={styles.scamFlag}>⚠️ </Text>}
                {convTitle(item)}
              </Text>
              <Text style={styles.rowPreview} numberOfLines={1}>
                {convPreview(item)}
              </Text>
            </View>
            <View style={styles.rowMeta}>
              {item.lastAt > 0 && (
                <Text style={styles.rowTime}>{formatRelative(item.lastAt)}</Text>
              )}
              {item.unread > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{item.unread}</Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
        );
      }}
    />
  );
}

/** Discover tab — the P2P entry point: find people by number (nodes later). */
function DiscoverTab({ onNewChat }: { onNewChat: () => void }): React.JSX.Element {
  const conn = useConnectionState();
  const meta = STATUS_META[conn];
  const relayLabel =
    conn === 'connected'
      ? 'Connected to the Hwfa relay'
      : conn === 'connecting'
        ? 'Connecting to the Hwfa relay…'
        : 'Offline — reconnecting…';
  return (
    <View style={styles.discover}>
      <TouchableOpacity style={styles.discoverCard} onPress={onNewChat} activeOpacity={0.85}>
        <Text style={styles.discoverCardIcon}>🔎</Text>
        <View style={styles.discoverCardText}>
          <Text style={styles.discoverCardTitle}>Find someone</Text>
          <Text style={styles.discoverCardHint}>Look up a contact by phone number.</Text>
        </View>
        <Text style={styles.discoverChevron}>›</Text>
      </TouchableOpacity>

      <View style={styles.networkBox}>
        <Text style={styles.networkTitle}>Your network</Text>
        <View style={styles.networkStat}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: meta.color, shadowColor: meta.color },
              conn !== 'connected' && styles.statusDotDim,
            ]}
          />
          <Text style={[styles.networkStatText, { color: meta.color }]}>{relayLabel}</Text>
        </View>
        <Text style={styles.networkHint}>
          Nearby-peer and direct node discovery arrive in a later phase.
        </Text>
      </View>
    </View>
  );
}

/** Updates tab — compose + view ephemeral, E2EE status broadcasts (24h TTL). */
function UpdatesTab(): React.JSX.Element {
  const all = useStatuses();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // Only show unexpired statuses; recompute when the list changes.
  const active = useMemo<StatusItem[]>(() => {
    const now = Date.now();
    return all.filter(s => s.expiresAt > now);
  }, [all]);

  async function share() {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setNote(null);
    setDraft('');
    try {
      const reached = await postStatus(text);
      setNote(reached > 0 ? `Shared with ${reached} contact${reached === 1 ? '' : 's'}` : 'Shared');
    } catch {
      setNote('Could not share status');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.updates}>
      <View style={styles.composer}>
        <TextInput
          style={styles.composerInput}
          value={draft}
          onChangeText={setDraft}
          placeholder="Share an update…"
          placeholderTextColor={theme.textDim}
          maxLength={280}
          multiline
        />
        <TouchableOpacity
          style={[styles.shareBtn, (!draft.trim() || busy) && styles.shareBtnOff]}
          onPress={share}
          disabled={!draft.trim() || busy}>
          <Text style={styles.shareBtnText}>Share</Text>
        </TouchableOpacity>
      </View>
      {note && <Text style={styles.updatesNote}>{note}</Text>}

      {active.length === 0 ? (
        <EmptyTab
          icon="📡"
          title="No updates yet"
          hint="Share an ephemeral, end-to-end encrypted update — it reaches your contacts and disappears after 24 hours."
        />
      ) : (
        <FlatList
          data={active}
          keyExtractor={s => s.id}
          contentContainerStyle={styles.updatesList}
          renderItem={({ item }) => (
            <View style={styles.statusRow}>
              <View style={styles.statusRing}>
                <Text style={styles.statusRingText}>
                  {item.mine ? 'You' : (item.fromPhone ?? item.fromUserId).slice(-2).toUpperCase()}
                </Text>
              </View>
              <View style={styles.statusCard}>
                <View style={styles.statusHead}>
                  <Text style={styles.statusName}>
                    {item.mine ? 'My update' : item.fromPhone ?? `${item.fromUserId.slice(0, 8)}…`}
                  </Text>
                  <Text style={styles.statusTime}>{formatRelative(item.at)}</Text>
                </View>
                <Text style={styles.statusBody}>{item.text}</Text>
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

/** Calls tab — recent call history with one-tap redial. */
function CallsTab(): React.JSX.Element {
  const log = useCallLog();
  if (log.length === 0) {
    return (
      <EmptyTab
        icon="📞"
        title="No calls yet"
        hint="Start an encrypted voice or video call from any chat — tap 📞 or 🎥 in the conversation header."
      />
    );
  }
  return (
    <FlatList
      data={log}
      keyExtractor={c => c.callId}
      contentContainerStyle={styles.list}
      renderItem={({ item }: { item: CallLogEntry }) => {
        const name = item.peerName ?? `${item.peerId.slice(0, 8)}…`;
        const missed = item.outcome === 'missed' || item.outcome === 'declined';
        const arrow = item.direction === 'outgoing' ? '↗' : '↙';
        return (
          <View style={styles.row}>
            <View style={styles.rowAvatar}>
              <Text style={styles.rowAvatarText}>{item.video ? '🎥' : '📞'}</Text>
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {name}
              </Text>
              <Text style={[styles.rowPreview, missed && { color: theme.danger }]}>
                {arrow} {item.outcome} · {formatRelative(item.at)}
              </Text>
            </View>
            <TouchableOpacity
              hitSlop={8}
              onPress={() => void callManager.start(item.peerId, item.peerName, item.video)}>
              <Text style={styles.redial}>{item.video ? '🎥' : '📞'}</Text>
            </TouchableOpacity>
          </View>
        );
      }}
    />
  );
}

/** Generic centered empty-state used by tabs with no content yet. */
function EmptyTab({
  icon,
  title,
  hint,
  actionLabel,
  onAction,
}: {
  icon: string;
  title: string;
  hint: string;
  actionLabel?: string;
  onAction?: () => void;
}): React.JSX.Element {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyBadge}>
        <Text style={styles.emptyIcon}>{icon}</Text>
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyHint}>{hint}</Text>
      {actionLabel && onAction && (
        <TouchableOpacity style={styles.emptyAction} onPress={onAction} activeOpacity={0.85}>
          <Text style={styles.emptyActionText}>{actionLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },

  // Top bar
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.hairline,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  brand: { color: theme.accent, fontSize: 24, fontWeight: '800', letterSpacing: 0.5 },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: theme.elevated,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.hairline,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.neon,
    shadowColor: theme.neon,
    shadowOpacity: 0.9,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 0 },
  },
  statusDotDim: { shadowOpacity: 0 },
  statusText: { color: theme.textDim, fontSize: 11, fontWeight: '600', letterSpacing: 0.3 },
  menuButton: { paddingHorizontal: 8, paddingVertical: 2 },
  menuDots: { color: theme.text, fontSize: 26, fontWeight: '700', lineHeight: 28 },

  body: { flex: 1 },

  // Conversation list
  list: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 120 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: theme.surface,
    marginBottom: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.hairline,
  },
  rowAvatar: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: theme.elevated,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.hairline,
  },
  rowAvatarText: { color: theme.neon, fontSize: 16, fontWeight: '800' },
  rowText: { flex: 1 },
  rowTitle: { color: theme.text, fontSize: 16, fontWeight: '600' },
  scamFlag: { fontSize: 13 },
  rowPreview: { color: theme.textDim, marginTop: 2 },
  redial: { fontSize: 22 },
  rowMeta: { alignItems: 'flex-end', gap: 6, minWidth: 40 },
  rowTime: { color: theme.textDim, fontSize: 11 },
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

  // Empty states
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyBadge: {
    width: 84,
    height: 84,
    borderRadius: 26,
    backgroundColor: theme.elevated,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.hairline,
    marginBottom: 20,
  },
  emptyIcon: { fontSize: 38 },
  emptyTitle: { color: theme.text, fontSize: 18, fontWeight: '700' },
  emptyHint: {
    color: theme.textDim,
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 300,
  },
  emptyAction: {
    marginTop: 20,
    backgroundColor: theme.accent,
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  emptyActionText: { color: theme.bg, fontWeight: '800' },

  // Updates
  updates: { flex: 1 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    padding: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.hairline,
  },
  composerInput: {
    flex: 1,
    backgroundColor: theme.surface,
    color: theme.text,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxHeight: 100,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.hairline,
  },
  shareBtn: {
    backgroundColor: theme.accent,
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  shareBtnOff: { opacity: 0.4 },
  shareBtnText: { color: theme.bg, fontWeight: '800' },
  updatesNote: { color: theme.neon, fontSize: 12, textAlign: 'center', paddingTop: 8 },
  updatesList: { padding: 12, gap: 10, paddingBottom: 120 },
  statusRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  statusRing: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 2,
    borderColor: theme.neon,
    backgroundColor: theme.elevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusRingText: { color: theme.neon, fontSize: 13, fontWeight: '800' },
  statusCard: {
    flex: 1,
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.hairline,
  },
  statusHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusName: { color: theme.text, fontSize: 14, fontWeight: '700' },
  statusTime: { color: theme.textDim, fontSize: 11 },
  statusBody: { color: theme.text, fontSize: 15, marginTop: 4, lineHeight: 20 },

  // Discover
  discover: { flex: 1, padding: 16, gap: 16 },
  discoverCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: theme.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.hairline,
  },
  discoverCardIcon: { fontSize: 26 },
  discoverCardText: { flex: 1 },
  discoverCardTitle: { color: theme.text, fontSize: 16, fontWeight: '700' },
  discoverCardHint: { color: theme.textDim, marginTop: 2, fontSize: 13 },
  discoverChevron: { color: theme.textDim, fontSize: 26, fontWeight: '700' },
  networkBox: {
    backgroundColor: theme.elevated,
    borderRadius: 16,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.hairline,
    gap: 8,
  },
  networkTitle: { color: theme.text, fontSize: 14, fontWeight: '700' },
  networkStat: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  networkStatText: { color: theme.neon, fontSize: 13, fontWeight: '600' },
  networkHint: { color: theme.textDim, fontSize: 12, lineHeight: 18 },

  // Floating action button
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 96,
    width: 58,
    height: 58,
    borderRadius: 20,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: theme.neon,
    shadowOpacity: 0.5,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  fabIcon: { color: theme.bg, fontSize: 32, fontWeight: '800', lineHeight: 34 },

  // Bottom nav
  nav: {
    flexDirection: 'row',
    backgroundColor: theme.bar,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.hairline,
    paddingTop: 6,
    paddingBottom: 10,
  },
  navItem: { flex: 1, alignItems: 'center', paddingVertical: 4 },
  navIndicator: {
    width: 28,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'transparent',
    marginBottom: 6,
  },
  navIndicatorActive: {
    backgroundColor: theme.neon,
    shadowColor: theme.neon,
    shadowOpacity: 0.9,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  navIcon: { fontSize: 20, opacity: 0.55 },
  navIconActive: { opacity: 1 },
  navLabel: { color: theme.textDim, fontSize: 11, marginTop: 3, fontWeight: '600' },
  navLabelActive: { color: theme.neon },

  // Quick menu (three-dot dropdown)
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  menu: {
    position: 'absolute',
    top: 56,
    right: 12,
    minWidth: 240,
    backgroundColor: theme.elevated,
    borderRadius: 16,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.hairline,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  menuHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: theme.bg, fontSize: 20, fontWeight: '800' },
  menuHeaderText: { flex: 1 },
  menuName: { color: theme.text, fontSize: 15, fontWeight: '700' },
  menuId: { color: theme.textDim, fontSize: 12, marginTop: 1 },
  menuDivider: { height: StyleSheet.hairlineWidth, backgroundColor: theme.hairline, marginVertical: 6 },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 12 },
  menuItemIcon: { fontSize: 16, width: 20, textAlign: 'center' },
  menuItemText: { color: theme.text, fontSize: 15, flex: 1 },
  menuItemDim: { color: theme.textDim },
  soonTag: {
    color: theme.textDim,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    backgroundColor: theme.surface,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
});
