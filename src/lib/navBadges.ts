/**
 * The live figures at the end of the nav rows.
 *
 * A rail that says "Relays 6/7" answers a question that would otherwise take a
 * click, and a count beside Notifications is the difference between a menu and
 * a dashboard. Both are read from state the app already holds.
 *
 * Kept out of the hook so they can be tested: the hook reaches the notification
 * query and the relay monitor, and importing it drags in a Nostr provider that
 * will not load in this test environment.
 */

/** Past this the exact number stops being the point. */
const MAX_SHOWN = 99;

export function formatCount(value: number): string {
  if (value <= 0) return '';
  return value > MAX_SHOWN ? `${MAX_SHOWN}+` : String(value);
}

/**
 * How many of the configured relays are actually answering.
 *
 * Read from the health monitor, which is already recording every request the
 * app makes — so this is a lookup, not a probe. `unknown` counts as reachable:
 * a relay nobody has needed yet has not failed, and counting it as down would
 * greet a perfectly healthy app with "0/7" on its first screen and send
 * somebody to fix a relay list that is fine.
 */
export function countReachable(
  configured: readonly string[],
  metrics: readonly { url: string; status: string }[]
): { up: number; total: number } {
  const known = new Map(metrics.map((metric) => [metric.url, metric.status]));

  const up = configured.filter(
    (url) => (known.get(url) ?? 'unknown') !== 'dead'
  ).length;

  return { up, total: configured.length };
}
