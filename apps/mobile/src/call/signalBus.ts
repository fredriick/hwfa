/**
 * A tiny indirection so the conversation store can hand off inbound call
 * signals without importing the WebRTC-backed call manager (which pulls in the
 * native react-native-webrtc module). The manager registers a handler on init.
 */
import type { CallSignal } from './wire';

type Handler = (fromPeerId: string, signal: CallSignal) => void;

let handler: Handler | null = null;

export function onCallSignal(h: Handler): void {
  handler = h;
}

export function routeCallSignal(fromPeerId: string, signal: CallSignal): void {
  handler?.(fromPeerId, signal);
}
