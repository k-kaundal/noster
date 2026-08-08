/**
 * Puts the primary relay at the head of the list, and guarantees it is in the
 * list at all.
 *
 * Both relay routers truncate to a cap, so ordering decides who gets dropped.
 * The primary is the one relay that must never be truncated away — without
 * this it would fall off simply by sitting late in the user's configured list.
 */
export function withPrimaryFirst(urls: string[], primary: string): string[] {
  const unique = [...new Set(urls)];
  if (!primary) return unique;

  return [primary, ...unique.filter((url) => url !== primary)];
}
