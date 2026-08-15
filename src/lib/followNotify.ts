/**
 * Which followers are news.
 *
 * A follow is not an event. Nostr has no "alice followed you" — there is only
 * alice's contact list, republished whole, with your key somewhere in it. So
 * the only way to tell a new follower from an old one is to remember who was
 * already there, and the only way to tell "already there" from "first time we
 * ever looked" is to remember that too.
 *
 * Both of those are what this holds. Without the second, connecting on a new
 * device would announce every follower you have ever had as if they had all
 * arrived at once — which is exactly the notification storm that makes people
 * switch the feature off and never turn it back on.
 *
 * Kept local rather than published. It describes what this browser has already
 * told you about, which is not a fact about you and is nobody else's business.
 */

/** Where the ledger lives. */
export const FOLLOWERS_SEEN_KEY = 'nostr:followers-seen';

export interface FollowerLedger {
  /** Everyone we have already counted as a follower. */
  pubkeys: string[];
  /**
   * Whether we have ever successfully looked.
   *
   * False means the list below is "nothing known yet" rather than "nobody
   * follows you", and the difference decides whether the first batch is news
   * or history.
   */
  seeded: boolean;
}

export const EMPTY_LEDGER: FollowerLedger = { pubkeys: [], seeded: false };

/**
 * How many to keep.
 *
 * The ledger only ever answers "have we seen this key before", so it can be
 * capped without becoming wrong in a way anyone notices — the worst case is
 * announcing a long-dormant follower a second time. Uncapped it grows without
 * limit in local storage, which is a few megabytes shared with everything else
 * the app stores.
 */
export const MAX_REMEMBERED = 5_000;

/**
 * The followers worth interrupting somebody for.
 *
 * Empty on the first look, whatever came back. That is the seeding rule and it
 * is deliberate: nothing observed before we started watching is news, and the
 * alternative announces your entire follower list the first time the app runs
 * on a phone.
 */
export function unseenFollowers(
  current: string[],
  ledger: FollowerLedger
): string[] {
  if (!ledger.seeded) return [];

  const known = new Set(ledger.pubkeys);

  // Deduped as we go: the same follower can appear twice in one batch when a
  // relay still holds two versions of their list
  const fresh: string[] = [];
  for (const pubkey of current) {
    if (known.has(pubkey)) continue;
    known.add(pubkey);
    fresh.push(pubkey);
  }

  return fresh;
}

/**
 * The ledger after taking this batch into account.
 *
 * Newest last, so the cap drops the oldest — a follower we have not seen in
 * five thousand others is the one whose re-announcement would cost least.
 * Returns the same object when nothing changed, so a caller can store it
 * unconditionally without writing on every poll.
 */
export function rememberFollowers(
  current: string[],
  ledger: FollowerLedger
): FollowerLedger {
  const known = new Set(ledger.pubkeys);
  const added = current.filter((pubkey) => !known.has(pubkey));

  if (!added.length && ledger.seeded) return ledger;

  const pubkeys = [...ledger.pubkeys, ...new Set(added)];

  return {
    seeded: true,
    pubkeys:
      pubkeys.length > MAX_REMEMBERED
        ? pubkeys.slice(pubkeys.length - MAX_REMEMBERED)
        : pubkeys,
  };
}
