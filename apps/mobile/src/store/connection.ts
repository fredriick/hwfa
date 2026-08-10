/**
 * Live relay connection state for the UI.
 *
 * Bridges the client's `onConnectionChange` to `useSyncExternalStore` so the
 * top-bar status pill reflects the real socket: connecting → connected →
 * offline (with the client auto-reconnecting underneath).
 */
import { useSyncExternalStore } from 'react';
import type { ConnectionState } from '@hwfa/client';
import { getClient } from '../client/hwfaClient';

let state: ConnectionState = 'offline';
const listeners = new Set<() => void>();
let bound = false;

function bind(): void {
  if (bound) return;
  bound = true;
  getClient().onConnectionChange(s => {
    state = s;
    for (const l of listeners) l();
  });
}

function subscribe(listener: () => void): () => void {
  bind();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = (): ConnectionState => state;

/** Live relay connection state. */
export function useConnectionState(): ConnectionState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
