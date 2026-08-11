import type { NostrEvent } from '@nostrify/nostrify';
import { nip19 } from 'nostr-tools';

/**
 * NIP-C7: chat.
 *
 * A chat message is a kind 9. A reply is another kind 9 that quotes its parent
 * with a `q` tag — not an `e` tag, which is the detail that keeps chat out of
 * the threading model: a chat reply is a quote, so a client that renders it
 * without understanding the reference still shows a message rather than an
 * orphaned fragment of a thread.
 *
 * The MUST here is about what a chat view is allowed to ask for: "Clients that
 * render a 'chat view' as a stream of ordered events MUST only fetch `kind 9`
 * events in order to prevent missing context across implementations." Mixing
 * other kinds into the stream means two clients reading the same room disagree
 * about what was said in it, which is worse than either one showing less.
 */

export const CHAT_KIND = 9;

export interface ChatQuote {
  eventId: string;
  relay?: string;
  pubkey?: string;
}

export interface ChatMessage {
  content: string;
  /** The parent this replies to, from the `q` tag. */
  quoted?: ChatQuote;
  /** Group id, when this message belongs to a NIP-29 group. */
  groupId?: string;
  event: NostrEvent;
}

/**
 * The `q` tag: `["q", <event-id>, <relay-url>, <pubkey>]`.
 *
 * The pubkey is in the fourth position rather than the third, which is where
 * an `e` tag puts its marker — reading it positionally by habit produces a
 * relay URL treated as an author.
 */
export function parseChatQuote(event: NostrEvent): ChatQuote | null {
  const tag = event.tags.find(([name, value]) => name === 'q' && !!value);
  if (!tag) return null;

  const [, eventId, relay, pubkey] = tag;

  return {
    eventId: eventId.trim(),
    relay: relay?.trim() || undefined,
    pubkey: pubkey?.trim() || undefined,
  };
}

export function parseChatMessage(event: NostrEvent): ChatMessage | null {
  if (event.kind !== CHAT_KIND) return null;

  return {
    content: event.content,
    quoted: parseChatQuote(event) ?? undefined,
    groupId: event.tags.find(([name]) => name === 'h')?.[1]?.trim() || undefined,
    event,
  };
}

/**
 * The text of a reply, without the quote URI it opens with.
 *
 * A reply carries `nostr:nevent1…\nthe actual words`, because the reference
 * has to survive clients that do not read `q` tags. Ones that do should not
 * print the URI as well as rendering the quote — that is the same reference
 * twice, once as a link nobody can read.
 */
export function replyBody(message: ChatMessage): string {
  if (!message.quoted) return message.content;

  return message.content
    .replace(/^\s*nostr:(nevent1|note1)[023456789acdefghjklmnpqrstuvwxyz]+\s*/i, '')
    .trimStart();
}

export interface ChatMessageInput {
  content: string;
  /** The message being replied to. */
  replyTo?: NostrEvent;
  /** Relay hint for the parent. */
  relay?: string;
  /** NIP-29 group this belongs to, if any. */
  groupId?: string;
}

/**
 * The content and tags of a chat message.
 *
 * A reply's content is prefixed with the parent's `nostr:` URI, which is what
 * the spec's example shows and what makes the reference visible to a client
 * that only renders text.
 */
export function buildChatMessage(input: ChatMessageInput): {
  content: string;
  tags: string[][];
} {
  const tags: string[][] = [];
  let content = input.content.trim();

  if (input.groupId) tags.push(['h', input.groupId]);

  if (input.replyTo) {
    tags.push([
      'q',
      input.replyTo.id,
      input.relay ?? '',
      input.replyTo.pubkey,
    ]);

    try {
      const uri = nip19.neventEncode({
        id: input.replyTo.id,
        author: input.replyTo.pubkey,
        relays: input.relay ? [input.relay] : undefined,
      });

      content = `nostr:${uri}\n${content}`;
    } catch {
      // An unencodable parent still gets the `q` tag, which is the reference
      // that matters; only the inline URI is lost
    }
  }

  return { content, tags };
}

/**
 * Groups consecutive messages from the same person.
 *
 * Purely presentational, and the reason it lives here rather than in a
 * component: a chat that repeats the avatar and name on every line of a
 * six-line burst is mostly furniture.
 */
export function groupConsecutive(
  messages: ChatMessage[],
  maxGapSeconds = 300
): ChatMessage[][] {
  const runs: ChatMessage[][] = [];

  for (const message of messages) {
    const current = runs[runs.length - 1];
    const last = current?.[current.length - 1];

    const continues =
      last &&
      last.event.pubkey === message.event.pubkey &&
      message.event.created_at - last.event.created_at <= maxGapSeconds &&
      // A reply starts a new run: it is answering something, not continuing
      !message.quoted;

    if (continues) current.push(message);
    else runs.push([message]);
  }

  return runs;
}
