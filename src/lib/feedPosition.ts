import type { NostrEvent } from '@nostrify/nostrify';

/**
 * Where the reader was when they last looked.
 *
 * The id alone is not enough, which is the whole reason this file exists — see
 * `countUnseen`.
 */
export interface FeedMarker {
  id: string;
  created_at: number;
}

export function markerFor(event: NostrEvent | undefined): FeedMarker | null {
  return event ? { id: event.id, created_at: event.created_at } : null;
}

/**
 * How many notes arrived above the reader.
 *
 * The feed holds these back rather than rendering them: a note inserted at the
 * top pushes everything down by its own height, which moves the paragraph
 * somebody is halfway through, and does it again for every note that lands.
 * They are counted in the pill instead, and appear when the reader asks.
 *
 * That all worked, and then flushed anyway, because the reader's position was
 * a single note id looked up in the list. Two things routinely remove that
 * note: the sixty-second poll replaces the first page with the newest thirty
 * notes, and the live subscription's cap drops the tail of that page. Global
 * is busy enough for both. The lookup then failed, the count fell to zero, and
 * every held-back note rendered at once — the jump this was built to prevent,
 * arriving in one lump on a timer.
 *
 * So the timestamp decides. It survives the note being evicted, because it
 * describes a moment rather than an object: everything published after it is
 * new, whether or not the note that marked it is still in the list.
 */
export function countUnseen(
  posts: NostrEvent[] | undefined,
  marker: FeedMarker | null
): number {
  if (!posts?.length || !marker) return 0;

  const exact = posts.findIndex((post) => post.id === marker.id);
  if (exact >= 0) return exact;

  /**
   * The marker is gone. Its timestamp still partitions the list — posts are
   * newest first, so the first one at or below it is where the reader was.
   */
  const index = posts.findIndex((post) => post.created_at <= marker.created_at);

  /**
   * Every post is newer than the marker, so nothing on screen is anything the
   * reader has seen and there is no position left to protect. Holding all of
   * them back would leave an empty timeline under a pill; showing them is the
   * only option that has content in it.
   */
  return index >= 0 ? index : 0;
}
