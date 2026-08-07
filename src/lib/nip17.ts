import type { NostrEvent, NostrSigner } from '@nostrify/nostrify';
import { getEventHash, nip59 } from 'nostr-tools';

/** NIP-17 / NIP-59 event kinds. */
export const CHAT_MESSAGE_KIND = 14;
export const SEAL_KIND = 13;
export const GIFT_WRAP_KIND = 1059;
/** NIP-17 preferred DM relays. */
export const DM_RELAY_LIST_KIND = 10050;

/** The unsigned inner event. Deniable precisely because it carries no signature. */
export interface Rumor {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
}

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

/**
 * A timestamp up to two days in the past. The spec asks for this on the seal
 * and the wrap so an observer cannot correlate them by time.
 */
function randomPastTimestamp(): number {
  return Math.round(Date.now() / 1000 - Math.random() * 2 * 24 * 60 * 60);
}

/** Builds the unsigned rumor that carries the actual message. */
function buildRumor(
  senderPubkey: string,
  recipients: string[],
  content: string,
  options: { subject?: string; replyTo?: string; relayHint?: string } = {}
): Rumor {
  const tags: string[][] = recipients.map((pubkey) =>
    options.relayHint ? ['p', pubkey, options.relayHint] : ['p', pubkey]
  );

  if (options.subject) tags.push(['subject', options.subject]);
  if (options.replyTo) tags.push(['e', options.replyTo]);

  const rumor = {
    pubkey: senderPubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: CHAT_MESSAGE_KIND,
    tags,
    content,
  };

  // The rumor still gets an id even though it is never signed
  return { ...rumor, id: getEventHash(rumor as never) };
}

/**
 * Wraps a message for one recipient.
 *
 * The seal must be signed by the sender, so it goes through the signer rather
 * than a raw key — that keeps extension and bunker logins working, since they
 * never expose a private key. Only the outer wrap uses a throwaway key, which
 * `nip59.createWrap` generates itself.
 */
async function sealAndWrap(
  signer: NostrSigner,
  senderPubkey: string,
  rumor: Rumor,
  recipientPubkey: string
): Promise<NostrEvent> {
  if (!signer.nip44) {
    throw new Error(
      'Your signer does not support NIP-44 encryption, which private messages require.'
    );
  }

  const sealedContent = await signer.nip44.encrypt(
    recipientPubkey,
    JSON.stringify(rumor)
  );

  // A seal deliberately carries no p tag; only the wrap reveals the recipient
  const seal = await signer.signEvent({
    kind: SEAL_KIND,
    content: sealedContent,
    tags: [],
    created_at: randomPastTimestamp(),
  });

  return nip59.createWrap(seal as never, recipientPubkey) as NostrEvent;
}

/**
 * Produces every gift wrap needed to send a message: one per recipient, plus
 * one addressed to the sender so their own history is readable on other
 * devices. Without the self-copy, sent messages vanish after a reload.
 */
export async function createDirectMessage(
  signer: NostrSigner,
  senderPubkey: string,
  recipients: string[],
  content: string,
  options: { subject?: string; replyTo?: string; relayHint?: string } = {}
): Promise<NostrEvent[]> {
  const audience = [...new Set(recipients)].filter(Boolean);
  if (!audience.length) throw new Error('A message needs at least one recipient');

  const rumor = buildRumor(senderPubkey, audience, content, options);

  return Promise.all(
    [...audience, senderPubkey].map((pubkey) =>
      sealAndWrap(signer, senderPubkey, rumor, pubkey)
    )
  );
}

/**
 * Peels a gift wrap back to the message inside. Returns null for anything that
 * fails to decrypt or is not a chat message, since a relay will happily serve
 * wraps addressed to other people.
 */
export async function unwrapDirectMessage(
  signer: NostrSigner,
  wrap: NostrEvent
): Promise<ChatMessage | null> {
  if (!signer.nip44) return null;

  try {
    const sealJson = await signer.nip44.decrypt(wrap.pubkey, wrap.content);
    const seal = JSON.parse(sealJson) as NostrEvent;
    if (seal.kind !== SEAL_KIND) return null;

    const rumorJson = await signer.nip44.decrypt(seal.pubkey, seal.content);
    const rumor = JSON.parse(rumorJson) as Rumor;
    if (rumor.kind !== CHAT_MESSAGE_KIND) return null;

    // The seal's author is the real sender; the wrap's author is throwaway
    if (rumor.pubkey !== seal.pubkey) return null;

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
      wrapId: wrap.id,
    };
  } catch {
    // Wraps addressed to someone else are expected and not worth reporting
    return null;
  }
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
