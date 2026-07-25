/** Small, dependency-free time formatting for the chat UI. */

/** Clock time for a message bubble, e.g. "14:05". */
export function formatClock(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** Compact last-activity stamp for the conversation list. */
export function formatRelative(ts: number, now: number = Date.now()): string {
  if (!ts) return '';
  const diff = now - ts;
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (diff < min) return 'now';
  if (diff < hour) return `${Math.floor(diff / min)}m`;
  if (diff < day && new Date(ts).getDate() === new Date(now).getDate()) {
    return formatClock(ts);
  }
  if (diff < 7 * day) return `${Math.floor(diff / day) || 1}d`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
