/**
 * Call UI state (separate from the WebRTC engine in manager.ts).
 *
 * The manager drives this store; screens read it via `useCall`. It holds only
 * display-safe values — the actual MediaStreams live in the manager, which
 * pushes their `toURL()` strings here for `<RTCView>`.
 */
import { useSyncExternalStore } from 'react';

export type CallStatus =
  | 'idle'
  | 'outgoing' // dialing, awaiting accept
  | 'incoming' // ringing, awaiting our accept/decline
  | 'active' // media flowing
  | 'ended';

export interface CallState {
  status: CallStatus;
  callId?: string;
  peerId?: string;
  peerName?: string;
  video: boolean;
  muted: boolean;
  cameraOff: boolean;
  localUrl?: string | null;
  remoteUrl?: string | null;
  startedAt?: number;
  endedReason?: string;
}

export interface CallLogEntry {
  callId: string;
  peerId: string;
  peerName?: string;
  video: boolean;
  direction: 'outgoing' | 'incoming';
  outcome: 'completed' | 'missed' | 'declined' | 'failed';
  at: number;
}

const IDLE: CallState = { status: 'idle', video: false, muted: false, cameraOff: false };

type Listener = () => void;

class CallStore {
  private state: CallState = IDLE;
  private log: CallLogEntry[] = [];
  private listeners = new Set<Listener>();

  set(partial: Partial<CallState>): void {
    this.state = { ...this.state, ...partial };
    this.emit();
  }

  reset(): void {
    this.state = IDLE;
    this.emit();
  }

  addLog(entry: CallLogEntry): void {
    this.log = [entry, ...this.log].slice(0, 100);
    this.emit();
  }

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getState = (): CallState => this.state;
  getLog = (): CallLogEntry[] => this.log;

  private emit(): void {
    for (const l of this.listeners) l();
  }
}

export const callStore = new CallStore();

export function useCall(): CallState {
  return useSyncExternalStore(callStore.subscribe, callStore.getState, callStore.getState);
}

export function useCallLog(): CallLogEntry[] {
  return useSyncExternalStore(callStore.subscribe, callStore.getLog, callStore.getLog);
}
