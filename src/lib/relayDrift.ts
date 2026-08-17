import { normalizeRelayUrl, type RelayEntry } from '@/lib/relay';

/**
 * Whether the relays you use are the relays you told everyone about.
 *
 * These are two different lists and nothing keeps them together. The local one
 * is what this app reads and writes; the published kind 10002 is what every
 * other client uses to find you — the outbox model in `lib/outboxRouting` is
 * this same lookup, run against somebody else.
 *
 * So a stale published list is not cosmetic. Add a relay here and never
 * republish, and your notes go somewhere nobody is told to look; drop one and
 * strangers keep querying a relay you left. Both failures are silent, and both
 * look like "Nostr is unreliable" from the outside.
 *
 * The mockups surface this as one line on the relays page. It is the best idea
 * in them for the same reason it is easy to miss: nothing else in the app can
 * tell you that your own reachability is quietly wrong.
 */

export interface RelayDrift {
  /** Used here, absent from the published list. */
  added: string[];
  /** Published, no longer used here. */
  dropped: string[];
  /** Whether the two lists agree. */
  inSync: boolean;
  /** Whether anything was published at all. */
  published: boolean;
}

export const NO_DRIFT: RelayDrift = {
  added: [],
  dropped: [],
  inSync: true,
  published: false,
};

function canonical(entries: readonly RelayEntry[]): Set<string> {
  const urls = new Set<string>();

  for (const entry of entries) {
    const url = normalizeRelayUrl(entry.url);
    if (url) urls.add(url);
  }

  return urls;
}

/**
 * Compares the two lists.
 *
 * Read and write markers are deliberately ignored. A relay moving from read to
 * write is a change worth republishing, but it is not the failure this exists
 * to catch, and folding it in here would report drift on lists that name the
 * same relays — which is the fastest way to teach somebody to ignore a warning.
 */
export function compareRelayLists(
  local: readonly RelayEntry[],
  published: readonly RelayEntry[] | undefined
): RelayDrift {
  /*
   * Nothing published is not drift. It is somebody who has never published a
   * relay list, which wants a different sentence — "other clients cannot find
   * you" rather than "your list is out of date".
   */
  if (!published) return NO_DRIFT;

  const here = canonical(local);
  const there = canonical(published);

  const added = [...here].filter((url) => !there.has(url)).sort();
  const dropped = [...there].filter((url) => !here.has(url)).sort();

  return {
    added,
    dropped,
    inSync: !added.length && !dropped.length,
    published: true,
  };
}

/** A short count, or empty when the lists agree. */
export function describeDrift(drift: RelayDrift): string {
  if (!drift.published || drift.inSync) return '';

  const parts: string[] = [];

  if (drift.added.length) {
    parts.push(
      `${drift.added.length} ${drift.added.length === 1 ? 'relay' : 'relays'} added`
    );
  }

  if (drift.dropped.length) {
    parts.push(
      `${drift.dropped.length} ${drift.dropped.length === 1 ? 'relay' : 'relays'} dropped`
    );
  }

  return parts.join(', ');
}
