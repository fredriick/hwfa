/**
 * Group message wire format.
 *
 * Groups are client-side: there's no server group. A group message is sent
 * pairwise — encrypted end-to-end to every member over the normal relay path —
 * carrying a `hwfa-group:` body so recipients can attribute it to the right
 * group and reconstruct the roster. The server still only sees ciphertext.
 */
const GROUP_PREFIX = 'hwfa-group:';

export interface GroupPayload {
  /** Stable group id (assigned by the creator). */
  gid: string;
  /** Human name. */
  name: string;
  /** Member user ids (includes the sender). */
  members: string[];
  /** The message text. */
  text: string;
}

export function buildGroupBody(payload: GroupPayload): string {
  return GROUP_PREFIX + JSON.stringify(payload);
}

export function isGroupBody(body: string): boolean {
  return body.startsWith(GROUP_PREFIX);
}

export function parseGroupBody(body: string): GroupPayload | null {
  if (!isGroupBody(body)) return null;
  try {
    return JSON.parse(body.slice(GROUP_PREFIX.length)) as GroupPayload;
  } catch {
    return null;
  }
}

/** A fresh group id. */
export function newGroupId(): string {
  return `group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
