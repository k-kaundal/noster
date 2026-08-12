import type { NostrEvent } from '@nostrify/nostrify';
import { addressOf } from './eventKinds';
import { buildQuoteTags, type QuotedEvent } from './mention';

export { addressOf };

/**
 * NIP-22 comments (kind 1111), built to the letter.
 *
 * The rule that makes the whole scheme work is the case convention: uppercase
 * tags name the **root scope** — the thing being discussed — and lowercase
 * tags name the **immediate parent**. For a top-level comment the two are the
 * same item and both sets are written out, which looks redundant and is not:
 * it is what lets a relay answer "every comment anywhere under this article"
 * with one indexed filter on `#A`, while a client still knows which comment
 * each reply hangs from.
 *
 * `K` and `k` are MUST, not SHOULD, and they are the tags most often left off.
 * Without them a reader has to fetch the root event to find out what it even
 * was before it can decide how to render the thread.
 *
 * Kept out of the hooks because the interesting part is entirely a matter of
 * which of six tags to emit for which of three kinds of target, and that is
 * worth being able to test without a relay.
 */

/** Something a comment can be scoped to or hang from. */
export type CommentTarget =
  | {
      type: 'event';
      id: string;
      pubkey: string;
      kind: number;
      /** `kind:pubkey:d` for replaceable and addressable events. */
      address?: string;
      relay?: string;
    }
  | {
      /**
       * A NIP-73 external identity: a URL, a podcast GUID, a hashtag, an ISBN.
       * `kind` is a string here — `web`, `podcast:item:guid` — not a number.
       */
      type: 'external';
      value: string;
      kind: string;
      /** A web page where the thing can be seen, not a relay. */
      hint?: string;
    };

/**
 * Kinds a comment may not be scoped to.
 *
 * "Comments MUST NOT be used to reply to kind 1 notes. NIP-10 should instead
 * be followed." A kind 1111 under a note is not a slightly-wrong reply — it is
 * invisible, because every client showing that thread queries `e` tags the
 * NIP-10 way and never asks for 1111s.
 */
const FORBIDDEN_ROOT_KINDS = new Set([1]);

/** Whether a comment thread is allowed to hang off this event at all. */
export function acceptsComments(event: NostrEvent): boolean {
  return !FORBIDDEN_ROOT_KINDS.has(event.kind);
}

export function targetFromEvent(
  event: NostrEvent,
  relay?: string
): CommentTarget {
  return {
    type: 'event',
    id: event.id,
    pubkey: event.pubkey,
    kind: event.kind,
    address: addressOf(event),
    relay,
  };
}

/**
 * A web page as a comment target.
 *
 * The NIP-73 kind for a URL is the literal string `web` — not the hostname,
 * which is a value and not a type. Getting this wrong produces comments that
 * no other client can find, because everyone else filters on `#K: ["web"]`.
 */
export function targetFromUrl(url: URL | string): CommentTarget {
  return { type: 'external', value: url.toString(), kind: 'web' };
}

/** Drops empty trailing positions so tags stay the length they mean. */
function tag(...parts: (string | undefined)[]): string[] {
  const trimmed = [...parts];
  while (trimmed.length && !trimmed[trimmed.length - 1]) trimmed.pop();

  return trimmed.map((part) => part ?? '');
}

/**
 * The root-scope half: what the discussion is about.
 *
 * No `E` accompanies an `A` here even for addressable roots. The scope is the
 * address — the article as it stands, not one particular revision of it — and
 * pinning comments to a version id would orphan every one of them the next
 * time the author fixed a typo.
 */
function rootTags(root: CommentTarget): string[][] {
  if (root.type === 'external') {
    return [tag('I', root.value, root.hint), tag('K', root.kind)];
  }

  return [
    root.address
      ? tag('A', root.address, root.relay)
      : tag('E', root.id, root.relay, root.pubkey),
    tag('K', String(root.kind)),
    tag('P', root.pubkey, root.relay),
  ];
}

/**
 * The parent half: what this comment is a direct reply to.
 *
 * A replaceable or addressable parent gets both `a` and `e`, which NIP-22
 * asks for explicitly. The address says which thing, the id says which
 * version — and a reply that quotes text only present in one revision is
 * worth being able to place in the revision it answered.
 */
function parentTags(parent: CommentTarget): string[][] {
  if (parent.type === 'external') {
    return [tag('i', parent.value, parent.hint), tag('k', parent.kind)];
  }

  const tags: string[][] = [];

  if (parent.address) {
    tags.push(tag('a', parent.address, parent.relay));
    tags.push(tag('e', parent.id, parent.relay, parent.pubkey));
  } else {
    tags.push(tag('e', parent.id, parent.relay, parent.pubkey));
  }

  tags.push(tag('k', String(parent.kind)));
  tags.push(tag('p', parent.pubkey, parent.relay));

  return tags;
}

export interface CommentInput {
  /** What the whole thread is about. */
  root: CommentTarget;
  /** What this comment answers. Omit for a top-level comment on the root. */
  parent?: CommentTarget;
  /** Pubkeys named in the content with `nostr:` URIs. */
  mentions?: string[];
  /** Events cited in the content with `nostr:` URIs. */
  quotes?: QuotedEvent[];
}

/**
 * Every tag a kind 1111 event needs, in the order the spec presents them.
 *
 * Order carries no meaning to relays, but it costs nothing to emit them the
 * way the spec's examples read, and a human comparing an event against the
 * document should not have to hunt.
 */
export function buildCommentTags(input: CommentInput): string[][] {
  /**
   * Enforced here rather than left to call sites, because this is the one
   * mistake that fails silently: the event publishes, the relay stores it, and
   * nobody ever sees it — including the person who wrote it, in any client but
   * the one that made the error.
   */
  if (input.root.type === 'event' && FORBIDDEN_ROOT_KINDS.has(input.root.kind)) {
    throw new Error(
      'Kind 1 notes take NIP-10 replies, not comments. A kind 1111 under a note is invisible to every client that reads the thread.'
    );
  }

  const parent = input.parent ?? input.root;

  const tags = [...rootTags(input.root), ...parentTags(parent)];

  tags.push(...buildQuoteTags(input.quotes ?? []));

  /**
   * Mentions are appended rather than merged into the `p` tags above, but a
   * pubkey already tagged as the parent's author is skipped: two `p` tags for
   * one person is how a single reply arrives as two notifications.
   */
  const tagged = new Set(
    tags.filter(([name]) => name === 'p').map(([, value]) => value)
  );

  for (const pubkey of input.mentions ?? []) {
    if (pubkey && !tagged.has(pubkey)) {
      tags.push(tag('p', pubkey));
      tagged.add(pubkey);
    }
  }

  return tags;
}

/**
 * Whether a kind 1111 event is well-formed enough to place in a thread.
 *
 * `K` and `k` are required by the spec and are exactly what a reader needs
 * before it can decide how to render anything. An event missing them cannot
 * be positioned, so showing it would mean guessing where it belongs.
 */
export function isValidComment(event: NostrEvent): boolean {
  if (event.kind !== 1111) return false;

  const has = (name: string) =>
    event.tags.some(([tagName, value]) => tagName === name && !!value);

  const hasRootScope = has('A') || has('E') || has('I');
  const hasParent = has('a') || has('e') || has('i');

  if (!hasRootScope || !hasParent || !has('K') || !has('k')) return false;

  /**
   * A comment scoped to a kind 1 is the thing the spec forbids. Rejected on
   * read as well as on write: somebody else's client may have made it, and
   * rendering it here would put a reply in a thread where the note's actual
   * readers cannot see it or answer it.
   */
  const rootKind = event.tags.find(([name]) => name === 'K')?.[1];

  return !FORBIDDEN_ROOT_KINDS.has(Number(rootKind));
}

/**
 * The item a comment is a direct reply to.
 *
 * Lowercase only, and `e` before `a`: a reply to a specific comment always
 * carries an `e`, whereas a top-level comment on an article carries both and
 * the `a` is the one that names the article rather than the reply target.
 */
export function parentOf(event: NostrEvent): string | undefined {
  const value = (name: string) =>
    event.tags.find(([tagName, tagValue]) => tagName === name && !!tagValue)?.[1];

  return value('e') ?? value('a') ?? value('i');
}

/**
 * Whether a comment sits directly under the root rather than under another
 * comment.
 *
 * Compared against the root's own identifiers rather than by asking whether a
 * parent exists, because a top-level comment names the root twice — once as
 * scope and once as parent — and "has a parent" is therefore true of every
 * comment ever written.
 */
export function isTopLevel(event: NostrEvent, root: CommentTarget): boolean {
  const values = event.tags
    .filter(([name]) => name === 'e' || name === 'a' || name === 'i')
    .map(([, value]) => value);

  if (root.type === 'external') return values.includes(root.value);

  return values.includes(root.address ?? root.id);
}
