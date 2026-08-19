import type { NostrEvent } from '@nostrify/nostrify';

/**
 * What a community looks like from the outside, in numbers.
 *
 * A NIP-72 community page could previously say only how many posts had been
 * approved into it — which answers "is this thing alive?" badly. A board with
 * forty posts from one person and one with forty from thirty people are not
 * the same place, and a board whose last post was in March is not alive at
 * all whatever its total says.
 */

export interface CommunityStats {
  /** Posts a moderator has approved. */
  approved: number;
  /** Posts waiting on a moderator. */
  pending: number;
  /** Distinct people whose posts were approved. */
  contributors: number;
  /** Newest approved post, in seconds. Undefined when there are none. */
  lastPostAt?: number;
}

export function summarizeCommunity(
  approved: readonly NostrEvent[],
  pending: readonly NostrEvent[]
): CommunityStats {
  const contributors = new Set(approved.map((post) => post.pubkey));

  return {
    approved: approved.length,
    pending: pending.length,
    contributors: contributors.size,
    lastPostAt: approved.length
      ? Math.max(...approved.map((post) => post.created_at))
      : undefined,
  };
}

/**
 * How long ago, in words, at the coarseness people actually care about.
 *
 * "Active today" and "quiet since March" are the two useful answers about a
 * message board; the minutes between them are not, and a timestamp precise to
 * the second reads as data rather than as a judgement about whether to bother
 * posting here.
 */
export function describeActivity(
  lastPostAt: number | undefined,
  now = Date.now()
): string | null {
  if (!lastPostAt) return null;

  const days = Math.floor((now / 1000 - lastPostAt) / 86400);

  if (days <= 0) return 'Active today';
  if (days === 1) return 'Active yesterday';
  if (days < 7) return `Active ${days} days ago`;
  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return `Active ${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`;
  }
  if (days < 365) {
    const months = Math.floor(days / 30);
    return `Quiet for ${months} ${months === 1 ? 'month' : 'months'}`;
  }

  const years = Math.floor(days / 365);
  return `Quiet for ${years} ${years === 1 ? 'year' : 'years'}`;
}

/**
 * Approved-post counts for many communities at once, from their approvals.
 *
 * A directory card could state only when a community was *created*, which is
 * the least useful fact about a message board — a place started three years
 * ago and posted to yesterday and a place started last week and abandoned read
 * identically. What a browser wants to know is whether anyone is there.
 *
 * Derived from kind 4550 approvals rather than the posts themselves, because
 * an approval names its community in an `a` tag, so one query with every
 * address on the page answers for all of them at once. Deduplicated on the
 * approved post's `e` tag: a moderator re-approving a post, or two moderators
 * approving the same one, is one post on the board either way.
 */
export function activityByCommunity(
  approvals: readonly NostrEvent[]
): Map<string, { posts: number; lastPostAt: number }> {
  /** address -> the ids approved into it. */
  const seen = new Map<string, Set<string>>();
  const latest = new Map<string, number>();

  for (const approval of approvals) {
    const address = approval.tags.find(([name]) => name === 'a')?.[1];
    const postId = approval.tags.find(([name]) => name === 'e')?.[1];
    if (!address || !postId) continue;

    const ids = seen.get(address) ?? new Set<string>();
    ids.add(postId);
    seen.set(address, ids);

    latest.set(address, Math.max(latest.get(address) ?? 0, approval.created_at));
  }

  const result = new Map<string, { posts: number; lastPostAt: number }>();
  for (const [address, ids] of seen) {
    result.set(address, {
      posts: ids.size,
      lastPostAt: latest.get(address) ?? 0,
    });
  }

  return result;
}

/**
 * The posts somebody is waiting on a moderator for.
 *
 * The single most confusing thing about a moderated board: you post, the page
 * says a moderator has to approve it, and then your post is nowhere — it is in
 * a tab called "Unapproved" among strangers' posts, indistinguishable from
 * them. Pulling your own out is what makes the wait legible.
 */
export function ownPending(
  pending: readonly NostrEvent[],
  pubkey: string | undefined
): NostrEvent[] {
  if (!pubkey) return [];
  return pending.filter((post) => post.pubkey === pubkey);
}
