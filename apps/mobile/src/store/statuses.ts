/**
 * Ephemeral status updates ("Updates" tab).
 *
 * A status is a short note broadcast to your conversation peers: it rides the
 * normal E2EE text path with a `hwfa-status:` body marker, so the server still
 * only sees ciphertext. The conversation store detects that marker on inbound
 * and routes it here instead of into a chat thread. Statuses expire after 24h
 * and are kept in memory only (they're ephemeral by nature).
 */
import { useSyncExternalStore } from 'react';

export const STATUS_TTL_MS = 24 * 60 * 60 * 1000;

/** The serialized payload that travels inside the E2EE body. */
export interface StatusPayload {
  id: string;
  text: string;
  at: number;
  expiresAt: number;
}

/** A status as shown in the UI (payload + who it's from). */
export interface StatusItem extends StatusPayload {
  fromUserId: string;
  fromPhone?: string;
  mine: boolean;
}

const STATUS_PREFIX = 'hwfa-status:';

export function buildStatusBody(payload: StatusPayload): string {
  return STATUS_PREFIX + JSON.stringify(payload);
}

export function isStatusBody(body: string): boolean {
  return body.startsWith(STATUS_PREFIX);
}

export function parseStatusBody(body: string): StatusPayload | null {
  if (!isStatusBody(body)) return null;
  try {
    return JSON.parse(body.slice(STATUS_PREFIX.length)) as StatusPayload;
  } catch {
    return null;
  }
}

type Listener = () => void;

class StatusStore {
  private items: StatusItem[] = [];
  private listeners = new Set<Listener>();

  /** Record our own posted status (shown immediately). */
  addOwn(payload: StatusPayload): void {
    this.upsert({ ...payload, fromUserId: 'me', mine: true });
  }

  /** Record an inbound status from a peer (from the conversation store). */
  receiveStatus(fromUserId: string, payload: StatusPayload, fromPhone?: string): void {
    this.upsert({ ...payload, fromUserId, fromPhone, mine: false });
  }

  private upsert(item: StatusItem): void {
    // De-dupe by id (a status may arrive more than once), then prune expired.
    const now = Date.now();
    const kept = this.items.filter(s => s.id !== item.id && s.expiresAt > now);
    if (item.expiresAt > now) kept.push(item);
    this.items = kept.sort((a, b) => b.at - a.at);
    this.emit();
  }

  /** Drop expired entries; returns whether anything changed. */
  prune(): void {
    const now = Date.now();
    const next = this.items.filter(s => s.expiresAt > now);
    if (next.length !== this.items.length) {
      this.items = next;
      this.emit();
    }
  }

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getSnapshot = (): StatusItem[] => this.items;

  private emit(): void {
    for (const l of this.listeners) l();
  }
}

export const statusStore = new StatusStore();

/** Live list of statuses (unfiltered; callers filter expiry as needed). */
export function useStatuses(): StatusItem[] {
  return useSyncExternalStore(statusStore.subscribe, statusStore.getSnapshot, statusStore.getSnapshot);
}
