import type { NostrEvent, NostrSigner } from '@nostrify/nostrify';
import { finalizeEvent, generateSecretKey, getEventHash, nip44 } from 'nostr-tools';

/**
 * NIP-59: gift wrap.
 *
 * Three layers, each hiding a different thing. A rumor is an unsigned event —
 * unverifiable if it leaks, which is the deniability. A seal is kind 13,
 * signed by the real author, revealing who wrote something but not what or to
 * whom. A gift wrap is kind 1059 signed by a throwaway key, revealing the
 * recipient but not the author.
 *
 * Kept apart from any messaging protocol on purpose: "This NIP does not define
 * any messaging protocol. Applications of this NIP should be defined
 * separately." Chat is one application of it; a wrapped anything is the
 * general case.
 *
 * The unwrapping side is where the care goes. A rumor is unsigned, so every
 * field in it is a claim by whoever sealed it and none of it is self-proving —
 * `pubkey` and `id` in particular. What makes a rumor trustworthy is the
 * signature on the seal around it, and only after checking that the two agree.
 */

/** Signed by the real author; contains the encrypted rumor. */
export const SEAL_KIND = 13;
/** Stored. Signed by a one-time key; contains the encrypted seal. */
export const GIFT_WRAP_KIND = 1059;
/**
 * Not stored.
 *
 * Same structure as 1059 but with ephemeral semantics — relays MUST NOT keep
 * it. For live chat and real-time play, where a message that arrives after the
 * moment has passed is worse than one that never arrives.
 */
export const EPHEMERAL_GIFT_WRAP_KIND = 21059;

export type WrapKind = typeof GIFT_WRAP_KIND | typeof EPHEMERAL_GIFT_WRAP_KIND;

export function isGiftWrap(kind: number): kind is WrapKind {
  return kind === GIFT_WRAP_KIND || kind === EPHEMERAL_GIFT_WRAP_KIND;
}

/** An unsigned event: everything a `NostrEvent` has except the signature. */
export interface Rumor {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
}

const TWO_DAYS = 2 * 24 * 60 * 60;

/**
 * A timestamp somewhere in the last two days.
 *
 * "All other timestamps SHOULD be tweaked to thwart time-analysis attacks" —
 * the canonical time belongs to the rumor, and a seal or wrap carrying the
 * real one would leak it in the clear. Always in the past, because some relays
 * refuse events dated ahead of their own clock.
 *
 * Called separately for each layer rather than once and shared: two wrappers
 * around one rumor bearing the same odd timestamp are visibly a pair, which is
 * the correlation the tweak exists to prevent.
 */
export function randomPastTimestamp(): number {
  return Math.round(Date.now() / 1000 - Math.random() * TWO_DAYS);
}

export interface RumorTemplate {
  kind: number;
  content: string;
  tags?: string[][];
  /** The one timestamp that is real: the canonical time is the rumor's. */
  created_at?: number;
}

/** Builds the unsigned inner event, with the id it hashes to. */
export function createRumor(pubkey: string, template: RumorTemplate): Rumor {
  const rumor = {
    pubkey,
    created_at: template.created_at ?? Math.floor(Date.now() / 1000),
    kind: template.kind,
    tags: template.tags ?? [],
    content: template.content,
  };

  return { ...rumor, id: getEventHash(rumor as never) };
}

/**
 * Seals a rumor to one recipient.
 *
 * Through the signer rather than a raw key, so extension and bunker logins
 * keep working — neither ever exposes a private key, and a gift wrap
 * implementation that needs one locks those people out of private messaging
 * entirely.
 */
export async function sealRumor(
  signer: NostrSigner,
  rumor: Rumor,
  recipientPubkey: string
): Promise<NostrEvent> {
  if (!signer.nip44) {
    throw new Error(
      'Your signer does not support NIP-44 encryption, which gift wrapping requires.'
    );
  }

  const content = await signer.nip44.encrypt(
    recipientPubkey,
    JSON.stringify(rumor)
  );

  return await signer.signEvent({
    kind: SEAL_KIND,
    content,
    // "Tags MUST always be empty in a kind:13" — the seal reveals no recipient
    tags: [],
    created_at: randomPastTimestamp(),
  });
}

/**
 * Wraps a seal for one recipient under a throwaway key.
 *
 * The key is generated here and discarded immediately. Reusing one across
 * wraps would link them to each other, which is the one thing the outer layer
 * is for.
 */
export function wrapSeal(
  seal: NostrEvent,
  recipientPubkey: string,
  options: { ephemeral?: boolean; tags?: string[][] } = {}
): NostrEvent {
  const secret = generateSecretKey();

  const conversationKey = nip44.v2.utils.getConversationKey(
    secret,
    recipientPubkey
  );

  return finalizeEvent(
    {
      kind: options.ephemeral ? EPHEMERAL_GIFT_WRAP_KIND : GIFT_WRAP_KIND,
      content: nip44.v2.encrypt(JSON.stringify(seal), conversationKey),
      created_at: randomPastTimestamp(),
      /**
       * The recipient's `p` tag is what routes it. Extra tags are allowed —
       * proof of work, an expiration — and go alongside rather than replacing
       * it.
       */
      tags: [['p', recipientPubkey], ...(options.tags ?? [])],
    },
    secret
  ) as NostrEvent;
}

/** Rumor, seal and wrap in one call, for a single recipient. */
export async function giftWrap(
  signer: NostrSigner,
  senderPubkey: string,
  template: RumorTemplate,
  recipientPubkey: string,
  options: { ephemeral?: boolean; tags?: string[][] } = {}
): Promise<{ rumor: Rumor; wrap: NostrEvent }> {
  const rumor = createRumor(senderPubkey, template);
  const seal = await sealRumor(signer, rumor, recipientPubkey);

  return { rumor, wrap: wrapSeal(seal, recipientPubkey, options) };
}

/**
 * Wraps one rumor for several recipients, and for the sender.
 *
 * A separate wrap each, as the NIP requires: "a single rumor may be wrapped
 * and addressed for each recipient individually". The sender's own copy is
 * what makes their history readable on another device — without it, everything
 * they send disappears the moment they reload.
 */
export async function giftWrapMany(
  signer: NostrSigner,
  senderPubkey: string,
  template: RumorTemplate,
  recipients: string[],
  options: { ephemeral?: boolean; tags?: string[][] } = {}
): Promise<{ rumor: Rumor; wraps: NostrEvent[] }> {
  const audience = [...new Set(recipients)].filter(Boolean);
  if (!audience.length) throw new Error('A gift wrap needs at least one recipient');

  const rumor = createRumor(senderPubkey, template);

  const wraps = await Promise.all(
    [...new Set([...audience, senderPubkey])].map(async (pubkey) => {
      const seal = await sealRumor(signer, rumor, pubkey);
      return wrapSeal(seal, pubkey, options);
    })
  );

  return { rumor, wraps };
}

/** Why a wrap was rejected, for the paths that care to distinguish. */
export type UnwrapFailure =
  | 'not-a-wrap'
  | 'no-nip44'
  | 'undecryptable'
  | 'bad-seal'
  | 'sealed-tags'
  | 'signed-rumor'
  | 'author-mismatch'
  | 'bad-id';

export type UnwrapResult =
  | { ok: true; rumor: Rumor; seal: NostrEvent; wrap: NostrEvent }
  | { ok: false; reason: UnwrapFailure };

/**
 * Peels a gift wrap, verifying everything the layers claim.
 *
 * The checks are the substance of this function. A rumor carries no signature,
 * so nothing inside it proves itself — the seal's signature is the only
 * evidence, and it only covers the rumor if the two agree about who wrote it.
 *
 * - `pubkey` must match the seal's signer, or anyone could wrap a rumor
 *   attributed to somebody else and it would render as theirs.
 * - `id` must be the hash of the rumor's own fields. It is used for threading
 *   and de-duplication, so a sender free to choose it could collide with
 *   another message and displace it.
 * - The rumor must be unsigned, per the spec. A signed inner event is
 *   verifiable by anyone who obtains it, which is exactly the deniability the
 *   three layers exist to provide.
 * - A seal must carry no tags, since the whole point of kind 13 is that it
 *   says nothing but who signed it.
 */
export async function unwrapGift(
  signer: NostrSigner,
  wrap: NostrEvent
): Promise<UnwrapResult> {
  if (!isGiftWrap(wrap.kind)) return { ok: false, reason: 'not-a-wrap' };
  if (!signer.nip44) return { ok: false, reason: 'no-nip44' };

  let seal: NostrEvent;
  let rumor: Rumor & { sig?: string };

  try {
    seal = JSON.parse(
      await signer.nip44.decrypt(wrap.pubkey, wrap.content)
    ) as NostrEvent;
  } catch {
    // Wraps addressed to somebody else are expected, not an error
    return { ok: false, reason: 'undecryptable' };
  }

  if (seal?.kind !== SEAL_KIND || typeof seal.pubkey !== 'string') {
    return { ok: false, reason: 'bad-seal' };
  }

  if (Array.isArray(seal.tags) && seal.tags.length > 0) {
    return { ok: false, reason: 'sealed-tags' };
  }

  try {
    rumor = JSON.parse(
      await signer.nip44.decrypt(seal.pubkey, seal.content)
    ) as Rumor & { sig?: string };
  } catch {
    return { ok: false, reason: 'undecryptable' };
  }

  if (!rumor || typeof rumor.kind !== 'number') {
    return { ok: false, reason: 'bad-seal' };
  }

  if (rumor.sig) return { ok: false, reason: 'signed-rumor' };

  if (rumor.pubkey !== seal.pubkey) {
    return { ok: false, reason: 'author-mismatch' };
  }

  const expected = getEventHash({
    pubkey: rumor.pubkey,
    created_at: rumor.created_at,
    kind: rumor.kind,
    tags: rumor.tags ?? [],
    content: rumor.content,
  } as never);

  if (rumor.id !== expected) return { ok: false, reason: 'bad-id' };

  return { ok: true, rumor: { ...rumor, id: expected }, seal, wrap };
}
