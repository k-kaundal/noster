import { normalizeRelayUrl } from '@/lib/relay';

/**
 * Canonical, deduplicated relay targets.
 *
 * The pool keys its connections by the exact string it is handed, so
 * `wss://nos.lol` and `wss://nos.lol/` are two websockets to one relay — and
 * every query and publish then goes out twice. Config is normalized on load,
 * but this is the last point before a socket is opened, so it is normalized
 * here too rather than trusting whatever reached it.
 */
export function canonicalTargets(urls: string[]): string[] {
  const seen = new Set<string>();
  const targets: string[] = [];

  for (const url of urls) {
    const normalized = normalizeRelayUrl(url);
    if (!normalized || seen.has(normalized)) continue;

    seen.add(normalized);
    targets.push(normalized);
  }

  return targets;
}

/**
 * Puts the primary relay at the head of the list, and guarantees it is in the
 * list at all.
 *
 * Both relay routers truncate to a cap, so ordering decides who gets dropped.
 * The primary is the one relay that must never be truncated away — without
 * this it would fall off simply by sitting late in the user's configured list.
 */
export function withPrimaryFirst(urls: string[], primary: string): string[] {
  const unique = canonicalTargets(urls);
  const head = normalizeRelayUrl(primary);
  if (!head) return unique;

  return [head, ...unique.filter((url) => url !== head)];
}
