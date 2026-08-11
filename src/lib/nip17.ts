import type { NostrEvent, NostrSigner } from '@nostrify/nostrify';
import { giftWrapMany, unwrapGift, type Rumor } from '@/lib/nip59';

/**
 * NIP-17: private messages, which are one application of NIP-59.
 *
 * The wrapping itself lives in `lib/nip59` — rumor, seal, wrap, and the checks
 * that make an unsigned inner event trustworthy. What is left here is what is
 * specific to chat: kind 14, the subject and reply tags, and the DM relay
 * list.
 */
export const CHAT_MESSAGE_KIND = 14;
/** NIP-17 preferred DM relays. */
export const DM_RELAY_LIST_KIND = 10050;

export { SEAL_KIND, GIFT_WRAP_KIND } from '@/lib/nip59';
export type { Rumor } from '@/lib/nip59';

/** A decrypted chat message, as shown in the UI. */
export interface ChatMessage {
  id: string;
  pubkey: string;
  createdAt: number;
  content: string;
  /** Everyone the message was addressed to, excluding the sender. */
  recipients: string[];
  subject?: string;
  /** Message this one replies to, if any. */
  replyTo?: string;
  /** The wrap this arrived in, so duplicates can be collapsed. */
  wrapId: string;
}

/** The chat-specific tags: who it is for, what it is about, what it answers. */
function messageTags(
  recipients: string[],
  options: { subject?: string; replyTo?: string; relayHint?: string }
): string[][] {
  const tags: string[][] = recipients.map((pubkey) =>
    options.relayHint ? ['p', pubkey, options.relayHint] : ['p', pubkey]
  );

  if (options.subject) tags.push(['subject', options.subject]);
  if (options.replyTo) tags.push(['e', options.replyTo]);

  return tags;
}

/**
 * Produces every gift wrap needed to send a message: one per recipient, plus
 * one addressed to the sender so their own history is readable on other
 * devices. Without the self-copy, sent messages vanish after a reload.
 *
 * The rumor comes back alongside the wraps so the sender can show the message
 * immediately. Its id is the one the relay will eventually echo back, so the
 * optimistic copy is replaced rather than duplicated.
 */
export async function createDirectMessage(
  signer: NostrSigner,
  senderPubkey: string,
  recipients: string[],
  content: string,
  options: { subject?: string; replyTo?: string; relayHint?: string } = {}
): Promise<{ rumor: Rumor; wraps: NostrEvent[] }> {
  const audience = [...new Set(recipients)].filter(Boolean);
  if (!audience.length) throw new Error('A message needs at least one recipient');

  return await giftWrapMany(
    signer,
    senderPubkey,
    {
      kind: CHAT_MESSAGE_KIND,
      content,
      tags: messageTags(audience, options),
    },
    audience
  );
}

/** The local view of a rumor, before any relay has confirmed it. */
export function rumorToMessage(rumor: Rumor): ChatMessage {
  return {
    id: rumor.id,
    pubkey: rumor.pubkey,
    createdAt: rumor.created_at,
    content: rumor.content,
    recipients: rumor.tags
      .filter(([name]) => name === 'p')
      .map(([, pubkey]) => pubkey)
      .filter(Boolean),
    subject: rumor.tags.find(([name]) => name === 'subject')?.[1],
    replyTo: rumor.tags.find(([name]) => name === 'e')?.[1],
    wrapId: '',
  };
}

/**
 * Peels a gift wrap back to the message inside.
 *
 * The unwrapping and its checks live in `lib/nip59`; what is added here is
 * that the rumor must actually be a chat message. Returns null for anything
 * that fails, since a relay will serve wraps addressed to other people and
 * those are expected rather than errors.
 */
export async function unwrapDirectMessage(
  signer: NostrSigner,
  wrap: NostrEvent
): Promise<ChatMessage | null> {
  const result = await unwrapGift(signer, wrap);
  if (!result.ok) return null;

  const { rumor } = result;
  if (rumor.kind !== CHAT_MESSAGE_KIND) return null;

  return { ...rumorToMessage(rumor), wrapId: wrap.id };
}

/**
 * Decrypts many wraps, reusing results across calls.
 *
 * Two things make the naive version unusable. Decryption is not free, and the
 * inbox is refetched on a timer, so re-decrypting the whole history every time
 * burns the main thread for no new information. Worse, with a NIP-07 extension
 * or a bunker every decrypt is an IPC round-trip, and firing hundreds at once
 * makes some signers queue for seconds or fail outright — which looks exactly
 * like messages not arriving.
 *
 * So: cache by wrap id, and only ever have `concurrency` decrypts in flight.
 */
export async function unwrapMany(
  signer: NostrSigner,
  wraps: NostrEvent[],
  cache: Map<string, ChatMessage | null>,
  concurrency = 8
): Promise<ChatMessage[]> {
  const pending = wraps.filter((wrap) => !cache.has(wrap.id));

  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, pending.length) },
    async () => {
      while (cursor < pending.length) {
        const wrap = pending[cursor++];
        cache.set(wrap.id, await unwrapDirectMessage(signer, wrap));
      }
    }
  );

  await Promise.all(workers);

  const messages: ChatMessage[] = [];
  for (const wrap of wraps) {
    const message = cache.get(wrap.id);
    if (message) messages.push(message);
  }
  return messages;
}

/**
 * The other party in a two-person conversation. Group threads are keyed by
 * their full participant set instead.
 */
export function conversationKey(
  message: ChatMessage,
  selfPubkey: string
): string {
  const participants = new Set([message.pubkey, ...message.recipients]);
  participants.delete(selfPubkey);

  const others = [...participants].sort();
  // A note to self has no other participant
  if (!others.length) return selfPubkey;
  return others.join(',');
}
