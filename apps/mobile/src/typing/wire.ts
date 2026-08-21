/**
 * Typing indicator wire format.
 *
 * A typing signal ("Alice is typing…") rides the normal E2EE text path with a
 * `hwfa-typing:` body marker, exactly like status (`hwfa-status:`), groups
 * (`hwfa-group:`), media (`hwfa-media:`), and calls (`hwfa-call:`). The server
 * still only sees ciphertext; the conversation store detects the marker on
 * inbound and routes it to the typing store instead of into a chat thread.
 *
 * Signals are ephemeral and never persisted. `typing: true` is re-sent while the
 * user keeps typing and auto-expires on the receiver; `typing: false` clears it
 * immediately (on send, blur, or an idle pause).
 */
const TYPING_PREFIX = 'hwfa-typing:';

export interface TypingPayload {
  /** Whether the sender is currently typing. */
  typing: boolean;
  /** Set when the typing is in a group thread; absent for a 1:1 chat. */
  gid?: string;
}

export function buildTypingBody(payload: TypingPayload): string {
  return TYPING_PREFIX + JSON.stringify(payload);
}

export function isTypingBody(body: string): boolean {
  return body.startsWith(TYPING_PREFIX);
}

export function parseTypingBody(body: string): TypingPayload | null {
  if (!isTypingBody(body)) return null;
  try {
    return JSON.parse(body.slice(TYPING_PREFIX.length)) as TypingPayload;
  } catch {
    return null;
  }
}
