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
export function buildStatsFilters(keys: string[]) {
  const eventIds = keys.filter((key) => !key.includes(':'));
  const addresses = keys.filter((key) => key.includes(':'));

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
  ];
}
