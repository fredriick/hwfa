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
import { getClient, loadMessages, saveMessages } from '../client/hwfaClient';

export interface ChatMessage {
  id: string;
  text: string;
  mine: boolean;
  at: number;
}

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
    getClient().onText(msg => this.receive(msg.fromUserId, msg.text, msg.receivedAt));
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
    conv.messages = [...conv.messages, this.make(text, true, at)];
    conv.lastAt = at;
    this.rebuild();
    this.emit();
    await getClient().sendText(peerUserId, text);
  }

  markRead(peerUserId: string): void {
    const conv = this.convs.get(peerUserId);
    if (conv && conv.unread !== 0) {
      conv.unread = 0;
      this.rebuild();
      this.emit();
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

  private receive(peerUserId: string, text: string, at: number): void {
    const conv = this.ensure(peerUserId);
    conv.messages = [...conv.messages, this.make(text, false, at)];
    conv.unread += 1;
    conv.lastAt = at;
    this.rebuild();
    this.emit();
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
      const state: PersistedState = {
        v: 1,
        counter: this.counter,
        conversations: [...this.convs.values()],
      };
      void saveMessages(JSON.stringify(state)).catch(() => {
        /* best-effort; retried on the next mutation */
      });
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
