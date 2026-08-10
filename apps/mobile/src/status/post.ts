/**
 * Post an ephemeral status: record it locally, then fan it out end-to-end
 * encrypted to every conversation peer over the normal relay path.
 *
 * Kept in its own module (imports both stores + the client) so neither store has
 * to depend on the other — the conversation store only imports the status store,
 * never the reverse.
 */
import { getClient } from '../client/hwfaClient';
import { conversationStore } from '../store/conversations';
import { buildStatusBody, statusStore, STATUS_TTL_MS, type StatusPayload } from '../store/statuses';

/** Broadcast `text` as a status. Returns how many peers it reached. */
export async function postStatus(text: string): Promise<number> {
  const at = Date.now();
  const payload: StatusPayload = {
    id: `s-${at.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    text,
    at,
    expiresAt: at + STATUS_TTL_MS,
  };
  // Show it immediately on our own device.
  statusStore.addOwn(payload);

  const body = buildStatusBody(payload);
  const peers = conversationStore.getConversations();
  let sent = 0;
  await Promise.all(
    peers.map(async p => {
      try {
        await getClient().sendText(p.peerUserId, body);
        sent += 1;
      } catch {
        /* peer unreachable — status is best-effort */
      }
    }),
  );
  return sent;
}
