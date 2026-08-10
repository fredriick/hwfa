/**
 * Call signaling wire format.
 *
 * All WebRTC signaling (SDP offer/answer, ICE candidates, and call control:
 * ring / accept / decline / hangup) rides the existing end-to-end encrypted
 * text path with a `hwfa-call:` body marker — so there are NO backend changes
 * and the signaling itself is E2EE. The conversation store detects the marker
 * on inbound and routes it to the call manager instead of a chat thread.
 */
const CALL_PREFIX = 'hwfa-call:';

export type CallSignalType =
  | 'ring' // caller → callee: incoming call (carries the offer)
  | 'accept' // callee → caller: accepted (carries the answer)
  | 'decline' // callee → caller: rejected
  | 'ice' // both ways: a trickled ICE candidate
  | 'hangup'; // either side: end the call

export interface CallSignal {
  type: CallSignalType;
  /** Correlates all messages of one call. */
  callId: string;
  /** Whether the call is video (vs audio-only). Set on `ring`. */
  video?: boolean;
  /** SDP for ring (offer) / accept (answer). */
  sdp?: { type: string; sdp: string };
  /** A single ICE candidate (for type === "ice"). */
  candidate?: { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null };
}

export function buildCallBody(signal: CallSignal): string {
  return CALL_PREFIX + JSON.stringify(signal);
}

export function isCallBody(body: string): boolean {
  return body.startsWith(CALL_PREFIX);
}

export function parseCallBody(body: string): CallSignal | null {
  if (!isCallBody(body)) return null;
  try {
    return JSON.parse(body.slice(CALL_PREFIX.length)) as CallSignal;
  } catch {
    return null;
  }
}

export function newCallId(): string {
  return `call-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
