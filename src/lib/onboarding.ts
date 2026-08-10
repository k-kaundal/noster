/**
 * Who a brand-new account starts out following.
 *
 * A Nostr account with an empty contact list opens onto a global firehose of
 * strangers, which is the single most common reason people try Nostr once and
 * never come back. One follow is enough to make the Following tab mean
 * something on the first day.
 *
 * Deliberately one account, and deliberately the one that runs this app —
 * padding it out with people we picked would be putting our own reach in
 * someone else's contact list without asking.
 */
export const ADMIN_PUBKEY =
  'f1ee81bb843731c983fad98784dfe984efdd0b057bcbb5e8f16ff449787e59f6';

/** npub form, for showing rather than filtering. */
export const ADMIN_NPUB =
  'npub178hgrwuyxucunql6mxrcfhlfsnha6zc9009mt683dl6yj7r7t8mq7zq9kz';

/**
 * The contact list a new account is created with.
 *
 * Written without reading first, which is safe in exactly this one case: the
 * key was generated seconds ago, so there is provably nothing to merge with.
 * Everywhere else, `useFollows` reads before it writes.
 */
export function initialContactTags(): string[][] {
  return [['p', ADMIN_PUBKEY]];
}
