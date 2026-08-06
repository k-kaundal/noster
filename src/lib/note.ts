import type { NostrEvent } from '@nostrify/nostrify';
import { nip19 } from 'nostr-tools';

/** A NIP-36 content warning, if the author set one. */
export interface ContentWarning {
  reason?: string;
}

/** Reads the NIP-36 `content-warning` tag. */
export function getContentWarning(event: NostrEvent): ContentWarning | null {
  const tag = event.tags.find(([name]) => name === 'content-warning');
  if (!tag) return null;
  return { reason: tag[1]?.trim() || undefined };
}

/**
 * Reads the NIP-18 `q` tag of a quote repost. Unlike an `e` tag this does not
 * make the note a thread reply, so quotes render as an embedded card instead.
 */
export function getQuotedEventId(event: NostrEvent): string | null {
  const tag = event.tags.find(([name]) => name === 'q');
  return tag?.[1] ?? null;
}

/**
 * Finds a `nostr:nevent…` / `nostr:note…` reference in the body, so notes that
 * quote by URI alone still render an embed. Returns the hex event id.
 */
export function getInlineQuoteId(content: string): string | null {
  const match = content.match(
    /nostr:((?:note1|nevent1)[023456789acdefghjklmnpqrstuvwxyz]+)/i
  );
  if (!match) return null;

  try {
    const decoded = nip19.decode(match[1]);
    if (decoded.type === 'note') return decoded.data;
    if (decoded.type === 'nevent') return decoded.data.id;
    return null;
  } catch {
    return null;
  }
}

/** Builds the NIP-18 tags for quoting an event. */
export function buildQuoteTags(event: NostrEvent): string[][] {
  return [
    ['q', event.id, '', event.pubkey],
    ['p', event.pubkey],
  ];
}

/** True for NIP-23 long-form content, which renders as an article. */
export function isLongForm(event: NostrEvent): boolean {
  return event.kind === 30023 || event.kind === 30024;
}

/** Reads a single-value tag, e.g. `title` or `summary` on long-form posts. */
export function getTagValue(event: NostrEvent, name: string): string | undefined {
  return event.tags.find(([tagName]) => tagName === name)?.[1] || undefined;
}

/** Rough reading time in minutes, for long-form previews. */
export function readingTimeMinutes(content: string): number {
  const words = content.trim().split(/\s+/).length;
  return Math.max(1, Math.round(words / 220));
}
