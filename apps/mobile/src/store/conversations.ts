/**
 * App-level conversation store.
 *
 * The relay delivers inbound text for *every* peer over the one client socket,
 * so the app must own a single `onText` subscription and fan messages out into
 * a per-peer inbox — otherwise a message only surfaces if that exact chat is
 * open (the Phase-1 scaffold bug). Screens read from here via `useSyncExternal-
 * Store`, so a message from any peer shows up in the conversation list and in
 * that peer's thread even when you're looking elsewhere.
 *
 * Phase 1: in-memory only (lost on reload, like the rest of the scaffold);
 * SQLCipher persistence is the next step.
 */
import { useSyncExternalStore } from 'react';
import type { MessageStatus, ScamVerdict } from '@hwfa/models';
import {
  buildMediaBody,
  isMediaBody,
  parseMediaBody,
  type MediaPlaintext,
  type MediaReference,
} from '@hwfa/client';
import { getClient, loadMessages, saveMessages } from '../client/hwfaClient';
import { downloadImage, toDataUri, uploadImage } from '../media/mediaService';
import { isStatusBody, parseStatusBody, statusStore } from './statuses';

export interface ChatMessage {
  id: string;
  text: string;
  mine: boolean;
  at: number;
  /** Outbound: correlation id for status updates; delivery status. */
  clientRef?: string;
  status?: MessageStatus;
  /** Inbound: server envelope id (to send a read receipt) + whether we sent it. */
  envelopeId?: string;
  readSent?: boolean;
  /** On-device scam verdict for inbound messages (absent for outbound). */
  verdict?: ScamVerdict;
  /** User dismissed the inline scam warning for this message. */
  dismissed?: boolean;
  /** Media attachment: the E2EE reference (key/IV/locator). Present ⇒ image message. */
  media?: MediaReference;
  /** In-memory `data:` URI for display (never persisted — re-fetched on demand). */
  mediaUri?: string;
  /** Attachment fetch/decrypt lifecycle. */
  mediaState?: 'loading' | 'ready' | 'error';
  /** User starred this message (persisted; shown in Starred messages). */
  starred?: boolean;
}

/** A starred message paired with the peer it belongs to (for the Starred list). */
export interface StarredMessage {
  message: ChatMessage;
  peerUserId: string;
  peerPhone?: string;
}

/** Monotonic ranking so a late status update never downgrades the tick. */
const STATUS_RANK: Record<MessageStatus, number> = {
  sending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
};

export interface Conversation {
  peerUserId: string;
  /** Known only when we discovered the peer by phone; inbound-first peers lack it. */
  peerPhone?: string;
  messages: ChatMessage[];
  unread: number;
  lastAt: number;
}

type Listener = () => void;

/** Stable empty array so `getSnapshot` for an unknown peer is referentially stable. */
const EMPTY: ChatMessage[] = [];

/** Shape persisted to the native encrypted store. */
interface PersistedState {
  v: number;
  counter: number;
  conversations: Conversation[];
}

class ConversationStore {
  private convs = new Map<string, Conversation>();
  private listeners = new Set<Listener>();
  private listSnapshot: Conversation[] = [];
  private counter = 0;
  private started = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Hydrate from the persisted blob, then subscribe the one client-wide inbound
   * handler. Idempotent. Subscribing after the (async) load can, in a tiny
   * window, race an inbound message; hydrate merges rather than clobbers.
   */
  start(): void {
    if (this.started) return;
    this.started = true;
    const client = getClient();
    client.onText(msg =>
      this.receive(msg.fromUserId, msg.text, msg.receivedAt, msg.envelopeId, msg.verdict),
    );
    client.onMessageStatus(u => this.applyStatus(u.clientRef, u.status));
    void this.hydrate();
  }

  private async hydrate(): Promise<void> {
    try {
      const json = await loadMessages();
      if (!json) return;
      const data = JSON.parse(json) as PersistedState;
      this.counter = Math.max(this.counter, data.counter ?? 0);
      for (const c of data.conversations ?? []) {
        const existing = this.convs.get(c.peerUserId);
        if (existing) {
          // A message arrived before hydrate finished — keep it, prepend history.
          existing.messages = [...(c.messages ?? []), ...existing.messages];
          existing.peerPhone = existing.peerPhone ?? c.peerPhone;
          existing.unread += c.unread ?? 0;
          existing.lastAt = Math.max(existing.lastAt, c.lastAt ?? 0);
        } else {
          this.convs.set(c.peerUserId, {
            peerUserId: c.peerUserId,
            peerPhone: c.peerPhone,
            messages: c.messages ?? [],
            unread: c.unread ?? 0,
            lastAt: c.lastAt ?? 0,
          });
        }
      }
      this.rebuild();
      this.emit();
    } catch {
      // Corrupt/absent blob: start empty rather than crash.
    }
  }

  /** Ensure a thread exists (e.g. right after discovering a peer by phone). */
  ensurePeer(peerUserId: string, peerPhone?: string): void {
    const conv = this.ensure(peerUserId);
    if (peerPhone && conv.peerPhone !== peerPhone) {
      conv.peerPhone = peerPhone;
      this.rebuild();
      this.emit();
    }
  }

  /** Optimistically append the outbound text, then send it through the client. */
  async send(peerUserId: string, text: string): Promise<void> {
    const conv = this.ensure(peerUserId);
    const at = Date.now();
    const message = this.make(text, true, at);
    const clientRef = `c${this.counter}-${at.toString(36)}`;
    message.clientRef = clientRef;
    message.status = 'sending';
    conv.messages = [...conv.messages, message];
    conv.lastAt = at;
    this.rebuild();
    this.emit();
    // Pass our clientRef so status updates (sent/delivered/read) map back here.
    await getClient().sendText(peerUserId, text, clientRef);
  }

  /**
   * Send an image: show it immediately from local bytes, then encrypt + upload
   * the ciphertext and send the `MediaReference` inside the E2EE body. The
   * plaintext and key never leave the device — only ciphertext reaches R2.
   */
  async sendMedia(peerUserId: string, media: MediaPlaintext): Promise<void> {
    const conv = this.ensure(peerUserId);
    const at = Date.now();
    const message = this.make('📷 Photo', true, at);
    const clientRef = `c${this.counter}-${at.toString(36)}`;
    message.clientRef = clientRef;
    message.status = 'sending';
    message.mediaUri = toDataUri(media.bytes, media.mime); // instant local preview
    message.mediaState = 'ready';
    conv.messages = [...conv.messages, message];
    conv.lastAt = at;
    this.rebuild();
    this.emit();
    try {
      const ref = await uploadImage(media);
      this.patch(peerUserId, message.id, { media: ref });
      await getClient().sendText(peerUserId, buildMediaBody(ref, ref.locator), clientRef);
    } catch (e) {
      this.patch(peerUserId, message.id, { mediaState: 'error' });
      throw e;
    }
  }

  /**
   * Fetch + decrypt inbound attachments that don't yet have an in-memory
   * preview (freshly received, or restored from disk where the bytes aren't
   * persisted). Safe to call repeatedly — skips ones already loaded/loading.
   */
  loadPendingMedia(peerUserId: string): void {
    const conv = this.convs.get(peerUserId);
    if (!conv) return;
    for (const m of conv.messages) {
      if (m.media && !m.mediaUri && m.mediaState !== 'loading') {
        void this.loadMedia(peerUserId, m.id, m.media);
      }
    }
  }

  private async loadMedia(
    peerUserId: string,
    messageId: string,
    ref: MediaReference,
  ): Promise<void> {
    this.patch(peerUserId, messageId, { mediaState: 'loading' });
    try {
      const plain = await downloadImage(ref);
      this.patch(peerUserId, messageId, {
        mediaUri: toDataUri(plain.bytes, plain.mime),
        mediaState: 'ready',
      });
    } catch {
      this.patch(peerUserId, messageId, { mediaState: 'error' });
    }
  }

  /** Immutably update one message by id (new array + object references). */
  private patch(peerUserId: string, messageId: string, fields: Partial<ChatMessage>): void {
    const conv = this.convs.get(peerUserId);
    if (!conv) return;
    const idx = conv.messages.findIndex(m => m.id === messageId);
    if (idx === -1) return;
    const updated = { ...conv.messages[idx]!, ...fields };
    conv.messages = [
      ...conv.messages.slice(0, idx),
      updated,
      ...conv.messages.slice(idx + 1),
    ];
    this.rebuild();
    this.emit();
  }

  /** Apply an outbound status update (sent → delivered → read), never downgrade. */
  private applyStatus(clientRef: string, status: MessageStatus): void {
    for (const conv of this.convs.values()) {
      const idx = conv.messages.findIndex(m => m.clientRef === clientRef);
      if (idx === -1) continue;
      const current = conv.messages[idx]!;
      const currentRank = current.status ? STATUS_RANK[current.status] : -1;
      if (STATUS_RANK[status] <= currentRank) return;
      const updated = { ...current, status };
      conv.messages = [
        ...conv.messages.slice(0, idx),
        updated,
        ...conv.messages.slice(idx + 1),
      ];
      this.rebuild();
      this.emit();
      return;
    }
  }

  markRead(peerUserId: string): void {
    const conv = this.convs.get(peerUserId);
    if (!conv) return;
    // Send a read receipt for each inbound message we haven't receipted yet.
    let changed = false;
    const client = getClient();
    conv.messages = conv.messages.map(m => {
      if (m.mine || m.readSent || !m.envelopeId) return m;
      try {
        client.sendReadReceipt(peerUserId, m.envelopeId);
      } catch {
        /* not connected — retried next open */
      }
      changed = true;
      return { ...m, readSent: true };
    });
    if (conv.unread !== 0) {
      conv.unread = 0;
      changed = true;
    }
    if (changed) {
      this.rebuild();
      this.emit();
    }
  }

  /** Toggle the starred flag on one message. */
  toggleStar(peerUserId: string, messageId: string): void {
    const conv = this.convs.get(peerUserId);
    if (!conv) return;
    conv.messages = conv.messages.map(m =>
      m.id === messageId ? { ...m, starred: !m.starred } : m,
    );
    this.rebuild();
    this.emit();
  }

  /** All starred messages across conversations, most recent first. */
  getStarred(): StarredMessage[] {
    const out: StarredMessage[] = [];
    for (const conv of this.convs.values()) {
      for (const m of conv.messages) {
        if (m.starred) {
          out.push({ message: m, peerUserId: conv.peerUserId, peerPhone: conv.peerPhone });
        }
      }
    }
    return out.sort((a, b) => b.message.at - a.message.at);
  }

  /** Dismiss the inline scam warning on one message (user override). */
  dismissScamWarning(peerUserId: string, messageId: string): void {
    const conv = this.convs.get(peerUserId);
    if (!conv) return;
    conv.messages = conv.messages.map(m =>
      m.id === messageId ? { ...m, dismissed: true } : m,
    );
    this.rebuild();
    this.emit();
  }

  /** Wipe all in-memory + persisted conversation state (used on log out). */
  async reset(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.convs.clear();
    this.counter = 0;
    // Keep `started` true: the single client-wide onText subscription must stay,
    // or a re-login would add a duplicate handler and double every message.
    this.rebuild();
    this.emit();
    try {
      await Promise.resolve(saveMessages(JSON.stringify({ v: 1, counter: 0, conversations: [] })));
    } catch {
      /* best-effort */
    }
  }

  // --- read side (for useSyncExternalStore) ---

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getConversations = (): Conversation[] => this.listSnapshot;

  getMessages = (peerUserId: string): ChatMessage[] =>
    this.convs.get(peerUserId)?.messages ?? EMPTY;

  // --- internals ---

  private receive(
    peerUserId: string,
    text: string,
    at: number,
    envelopeId?: string,
    verdict?: ScamVerdict,
  ): void {
    // A status update rides the text path but belongs in the Updates tab, not
    // a chat thread — route it there and stop.
    if (isStatusBody(text)) {
      const payload = parseStatusBody(text);
      if (payload) {
        const conv = this.convs.get(peerUserId);
        statusStore.receiveStatus(peerUserId, payload, conv?.peerPhone);
      }
      return;
    }

    const conv = this.ensure(peerUserId);
    const mediaRef = isMediaBody(text) ? parseMediaBody(text) : null;
    const message = this.make(mediaRef ? '📷 Photo' : text, false, at);
    if (envelopeId) message.envelopeId = envelopeId;
    // A media body is opaque JSON — the upstream scam verdict on it is noise.
    if (verdict && !mediaRef) message.verdict = verdict;
    if (mediaRef) {
      message.media = mediaRef;
      message.mediaState = 'loading';
    }
    conv.messages = [...conv.messages, message];
    conv.unread += 1;
    conv.lastAt = at;
    this.rebuild();
    this.emit();
    if (mediaRef) void this.loadMedia(peerUserId, message.id, mediaRef);
  }

  private ensure(peerUserId: string): Conversation {
    let conv = this.convs.get(peerUserId);
    if (!conv) {
      conv = { peerUserId, messages: EMPTY, unread: 0, lastAt: 0 };
      this.convs.set(peerUserId, conv);
    }
    return conv;
  }

  private make(text: string, mine: boolean, at: number): ChatMessage {
    return { id: `m${this.counter++}`, text, mine, at };
  }

  /** Rebuild the list snapshot (most-recent first) as a new array reference. */
  private rebuild(): void {
    this.listSnapshot = [...this.convs.values()].sort((a, b) => b.lastAt - a.lastAt);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
    this.schedulePersist();
  }

  /** Coalesce rapid mutations into a single write to the native store. */
  private schedulePersist(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      // Persist the media *reference* (key/IV/locator) but never the decrypted
      // bytes: strip the in-memory preview so plaintext images stay off disk.
      const state: PersistedState = {
        v: 1,
        counter: this.counter,
        conversations: [...this.convs.values()].map(c => ({
          ...c,
          messages: c.messages.map(({ mediaUri: _u, mediaState: _s, ...m }) => m),
        })),
      };
      try {
        // Guard the synchronous path too: an old native build without
        // saveMessages would otherwise throw out of this timer and crash.
        void Promise.resolve(saveMessages(JSON.stringify(state))).catch(() => {
          /* best-effort; retried on the next mutation */
        });
      } catch {
        /* native method missing (stale build) — skip persistence this tick */
      }
    }, 300);
  }
}

export const conversationStore = new ConversationStore();

/** Live list of conversations, newest activity first. */
export function useConversations(): Conversation[] {
  return useSyncExternalStore(
    conversationStore.subscribe,
    conversationStore.getConversations,
    conversationStore.getConversations,
  );
}

/** Live message thread for one peer. */
export function useMessages(peerUserId: string): ChatMessage[] {
  const getSnapshot = () => conversationStore.getMessages(peerUserId);
  return useSyncExternalStore(conversationStore.subscribe, getSnapshot, getSnapshot);
}
