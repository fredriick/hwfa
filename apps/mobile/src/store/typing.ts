/**
 * Ephemeral typing state, keyed by conversation.
 *
 * The conversation store routes inbound `hwfa-typing:` signals here. A signal is
 * kept in memory only and auto-expires: a peer that keeps typing re-sends
 * `typing: true` every few seconds, so a live indicator lapses on its own if the
 * "stopped" signal is lost. State is per conversation (1:1 peer id or group id),
 * and within a group we track each typing member so several can show at once.
 */
import { useSyncExternalStore } from 'react';

/** How long a `typing: true` stays live without a refresh (sender re-sends ~3s). */
export const TYPING_TTL_MS = 6000;

type Listener = () => void;

class TypingStore {
  /** conversationId -> (senderId -> expiry timestamp). */
  private byConv = new Map<string, Map<string, number>>();
  private listeners = new Set<Listener>();
  private sweepTimer: ReturnType<typeof setTimeout> | null = null;
  private snapshots = new Map<string, string[]>();

  /** Record an inbound typing signal for a conversation from a given sender. */
  receiveTyping(conversationId: string, senderId: string, typing: boolean): void {
    let senders = this.byConv.get(conversationId);
    if (typing) {
      if (!senders) {
        senders = new Map();
        this.byConv.set(conversationId, senders);
      }
      senders.set(senderId, Date.now() + TYPING_TTL_MS);
      this.ensureSweep();
    } else if (senders) {
      senders.delete(senderId);
      if (senders.size === 0) this.byConv.delete(conversationId);
    } else {
      return; // nothing was live and this is a stop — no change.
    }
    this.invalidate(conversationId);
    this.emit();
  }

  /** Drop everything for a conversation (e.g. on log out / reset). */
  clear(): void {
    if (this.byConv.size === 0) return;
    this.byConv.clear();
    this.snapshots.clear();
    this.emit();
  }

  /** Live sender ids typing in a conversation (empty array is a stable ref). */
  getTyping = (conversationId: string): string[] => {
    const cached = this.snapshots.get(conversationId);
    if (cached) return cached;
    const fresh = this.compute(conversationId);
    this.snapshots.set(conversationId, fresh);
    return fresh;
  };

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  private compute(conversationId: string): string[] {
    const senders = this.byConv.get(conversationId);
    if (!senders || senders.size === 0) return EMPTY;
    const now = Date.now();
    const live: string[] = [];
    for (const [id, expiry] of senders) if (expiry > now) live.push(id);
    return live.length === 0 ? EMPTY : live;
  }

  /** Recompute one conversation's cached snapshot (new ref only if it changed). */
  private invalidate(conversationId: string): void {
    const next = this.compute(conversationId);
    const prev = this.snapshots.get(conversationId);
    if (prev && prev.length === next.length && prev.every((v, i) => v === next[i])) return;
    this.snapshots.set(conversationId, next);
  }

  /** Periodically drop expired entries so a lost "stop" signal still lapses. */
  private ensureSweep(): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [conv, senders] of this.byConv) {
        for (const [id, expiry] of senders) {
          if (expiry <= now) {
            senders.delete(id);
            changed = true;
          }
        }
        if (senders.size === 0) this.byConv.delete(conv);
        if (changed) this.invalidate(conv);
      }
      if (this.byConv.size === 0 && this.sweepTimer) {
        clearInterval(this.sweepTimer);
        this.sweepTimer = null;
      }
      if (changed) this.emit();
    }, 1000);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}

const EMPTY: string[] = [];

export const typingStore = new TypingStore();

/** Live list of sender ids typing in a conversation. */
export function useTyping(conversationId: string): string[] {
  return useSyncExternalStore(
    typingStore.subscribe,
    () => typingStore.getTyping(conversationId),
    () => typingStore.getTyping(conversationId),
  );
}
