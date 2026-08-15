import { ZAP_RECEIPT_KIND } from '@/lib/zap';

/** Kinds that make up the engagement row, zaps excluded. */
const SOCIAL_KINDS = [1, 6, 7, 16];

/**
 * The filters for a batch of notes.
 *
 * Extracted so the one decision that kept going wrong here is testable: zap
 * receipts get a filter of their own. A relay applies `limit` per filter and
 * answers newest-first, so sharing one with reactions and replies — which
 * outnumber zaps by an order of magnitude on anything popular — lets the
 * receipts fall off the end of the response. The total then reads zero for a
 * post that was definitely paid, and reads zero only sometimes, depending on
 * how busy the rest of the batch was.
 *
 * Addressable events are referenced by coordinate, not by id: an article's
 * zaps carry `a` = `30023:<pubkey>:<d>` and often no `e` tag at all, so asking
 * only for `#e` finds none of them.
 */
/**
 * The key a person's own zaps are counted under.
 *
 * A profile zap — NIP-57 zapping the human rather than a note — carries a `p`
 * tag and no `e` or `a` at all. So it is not findable by any note id, which is
 * the only thing this loader knew how to ask for: every zap sent from a profile
 * page landed in no bucket and the total on that page stayed at zero however
 * many arrived.
 *
 * Prefixed rather than passed bare so a pubkey cannot be mistaken for an event
 * id — both are 64 hex characters.
 */
export function profileStatsKey(pubkey: string): string {
  return `profile:${pubkey}`;
}

/** An addressable event's coordinate, which always starts with its kind. */
function isAddressKey(key: string): boolean {
  return /^\d+:/.test(key);
}

export function buildStatsFilters(keys: string[]) {
  const profiles = keys
    .filter((key) => key.startsWith('profile:'))
    .map((key) => key.slice('profile:'.length));

  const addresses = keys.filter(isAddressKey);

  const eventIds = keys.filter(
    (key) => !key.startsWith('profile:') && !isAddressKey(key)
  );

  // Bounded so a full batch stays under typical relay max_limit
  const limit = Math.min(keys.length * 40, 2000);
  const zapLimit = Math.min(keys.length * 40, 1000);

  return [
    ...(eventIds.length
      ? [
          { kinds: SOCIAL_KINDS, '#e': eventIds, limit },
          { kinds: [ZAP_RECEIPT_KIND], '#e': eventIds, limit: zapLimit },
        ]
      : []),
    ...(addresses.length
      ? [
          { kinds: SOCIAL_KINDS, '#a': addresses, limit },
          { kinds: [ZAP_RECEIPT_KIND], '#a': addresses, limit: zapLimit },
        ]
      : []),
    /*
     * Receipts only. The social kinds are deliberately not asked for by `p`:
     * that tag means "mentioned" on a note, not "about this person", so the
     * same filter would report every reply that name-dropped somebody as a
     * reply to them.
     */
    ...(profiles.length
      ? [{ kinds: [ZAP_RECEIPT_KIND], '#p': profiles, limit: zapLimit }]
      : []),
  ];
}
