import { describe, it, expect } from 'vitest';
import { generateSecretKey, getPublicKey, nip44 } from 'nostr-tools';
import type { NostrEvent, NostrSigner } from '@nostrify/nostrify';
import { finalizeEvent } from 'nostr-tools';
import {
  CHAT_MESSAGE_KIND,
  GIFT_WRAP_KIND,
  SEAL_KIND,
  conversationKey,
  createDirectMessage,
  unwrapDirectMessage,
  type ChatMessage,
} from './nip17';

/**
 * A signer backed by a raw key, standing in for a browser extension or bunker.
 * The production code never sees a private key, so the whole NIP-17 path has
 * to work through exactly this interface.
 */
function makeSigner(secretKey: Uint8Array): NostrSigner {
  const pubkey = getPublicKey(secretKey);

  return {
    async getPublicKey() {
      return pubkey;
    },
    async signEvent(event) {
      return finalizeEvent(
        {
          kind: event.kind,
          content: event.content,
          tags: event.tags,
          created_at: event.created_at,
        },
        secretKey
      ) as NostrEvent;
    },
    nip44: {
      async encrypt(peer: string, plaintext: string) {
        return nip44.encrypt(
          plaintext,
          nip44.getConversationKey(secretKey, peer)
        );
      },
      async decrypt(peer: string, ciphertext: string) {
        return nip44.decrypt(
          ciphertext,
          nip44.getConversationKey(secretKey, peer)
        );
      },
    },
  };
}

const aliceKey = generateSecretKey();
const bobKey = generateSecretKey();
const eveKey = generateSecretKey();

const alice = { key: aliceKey, pubkey: getPublicKey(aliceKey), signer: makeSigner(aliceKey) };
const bob = { key: bobKey, pubkey: getPublicKey(bobKey), signer: makeSigner(bobKey) };
const eve = { key: eveKey, pubkey: getPublicKey(eveKey), signer: makeSigner(eveKey) };

describe('createDirectMessage', () => {
  it('produces a wrap for the recipient and one for the sender', async () => {
    const wraps = await createDirectMessage(
      alice.signer,
      alice.pubkey,
      [bob.pubkey],
      'Hola, que tal?'
    );

    // Without the self-copy, senders lose their own history on reload
    expect(wraps).toHaveLength(2);

    const addressed = wraps.map(
      (wrap) => wrap.tags.find(([name]) => name === 'p')?.[1]
    );
    expect(addressed).toContain(bob.pubkey);
    expect(addressed).toContain(alice.pubkey);
  });

  it('signs each wrap with a throwaway key, not the sender key', async () => {
    const wraps = await createDirectMessage(
      alice.signer,
      alice.pubkey,
      [bob.pubkey],
      'hello'
    );

    for (const wrap of wraps) {
      expect(wrap.kind).toBe(GIFT_WRAP_KIND);
      // A wrap authored by Alice would deanonymize the whole scheme
      expect(wrap.pubkey).not.toBe(alice.pubkey);
      expect(wrap.pubkey).not.toBe(bob.pubkey);
    }

    // Two wraps of the same message must not share an ephemeral key either
    expect(wraps[0].pubkey).not.toBe(wraps[1].pubkey);
  });

  it('leaks neither the plaintext nor the recipient on the outside', async () => {
    const [wrap] = await createDirectMessage(
      alice.signer,
      alice.pubkey,
      [bob.pubkey],
      'meet me at the usual place'
    );

    const serialized = JSON.stringify(wrap);
    expect(serialized).not.toContain('meet me at the usual place');
    // The sender's identity must not appear anywhere on the wrap
    expect(serialized).not.toContain(alice.pubkey);
  });

  it('backdates the wrap so timestamps cannot be correlated', async () => {
    const wraps = await createDirectMessage(
      alice.signer,
      alice.pubkey,
      [bob.pubkey],
      'hi'
    );
    const now = Math.floor(Date.now() / 1000);

    for (const wrap of wraps) {
      expect(wrap.created_at).toBeLessThanOrEqual(now + 1);
      // Randomized within the last two days, per the spec
      expect(wrap.created_at).toBeGreaterThan(now - 2 * 24 * 60 * 60 - 60);
    }
  });

  it('rejects a message with no recipients', async () => {
    await expect(
      createDirectMessage(alice.signer, alice.pubkey, [], 'hi')
    ).rejects.toThrow(/recipient/i);
  });
});

describe('unwrapDirectMessage', () => {
  /** Finds the wrap addressed to a given pubkey. */
  function wrapFor(wraps: NostrEvent[], pubkey: string) {
    return wraps.find(
      (wrap) => wrap.tags.find(([name]) => name === 'p')?.[1] === pubkey
    )!;
  }

  it('round-trips a message from sender to recipient', async () => {
    const wraps = await createDirectMessage(
      alice.signer,
      alice.pubkey,
      [bob.pubkey],
      'Hola, que tal?'
    );

    const message = await unwrapDirectMessage(
      bob.signer,
      wrapFor(wraps, bob.pubkey)
    );

    expect(message).not.toBeNull();
    expect(message!.content).toBe('Hola, que tal?');
    expect(message!.pubkey).toBe(alice.pubkey);
    expect(message!.recipients).toContain(bob.pubkey);
  });

  it('lets the sender read their own copy back', async () => {
    const wraps = await createDirectMessage(
      alice.signer,
      alice.pubkey,
      [bob.pubkey],
      'note to self later'
    );

    const message = await unwrapDirectMessage(
      alice.signer,
      wrapFor(wraps, alice.pubkey)
    );

    expect(message?.content).toBe('note to self later');
    expect(message?.pubkey).toBe(alice.pubkey);
  });

  it('returns null for a wrap addressed to someone else', async () => {
    const wraps = await createDirectMessage(
      alice.signer,
      alice.pubkey,
      [bob.pubkey],
      'private'
    );

    // Relays serve wraps indiscriminately, so this is the common case
    const message = await unwrapDirectMessage(
      eve.signer,
      wrapFor(wraps, bob.pubkey)
    );
    expect(message).toBeNull();
  });

  it('rejects a seal whose author does not match the rumor', async () => {
    // Eve seals a rumor claiming to be from Alice and wraps it to Bob
    const forgedRumor = {
      id: 'forged',
      pubkey: alice.pubkey,
      created_at: Math.floor(Date.now() / 1000),
      kind: CHAT_MESSAGE_KIND,
      tags: [['p', bob.pubkey]],
      content: 'transfer everything to eve',
    };

    const sealed = await eve.signer.nip44!.encrypt(
      bob.pubkey,
      JSON.stringify(forgedRumor)
    );
    const seal = await eve.signer.signEvent({
      kind: SEAL_KIND,
      content: sealed,
      tags: [],
      created_at: Math.floor(Date.now() / 1000),
    });

    const ephemeral = generateSecretKey();
    const wrap = finalizeEvent(
      {
        kind: GIFT_WRAP_KIND,
        content: nip44.encrypt(
          JSON.stringify(seal),
          nip44.getConversationKey(ephemeral, bob.pubkey)
        ),
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', bob.pubkey]],
      },
      ephemeral
    ) as NostrEvent;

    const message = await unwrapDirectMessage(bob.signer, wrap);
    expect(message).toBeNull();
  });

  it('returns null for malformed content instead of throwing', async () => {
    const ephemeral = generateSecretKey();
    const wrap = finalizeEvent(
      {
        kind: GIFT_WRAP_KIND,
        content: 'not encrypted at all',
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', bob.pubkey]],
      },
      ephemeral
    ) as NostrEvent;

    await expect(unwrapDirectMessage(bob.signer, wrap)).resolves.toBeNull();
  });
});

describe('conversationKey', () => {
  const base: ChatMessage = {
    id: 'x',
    pubkey: alice.pubkey,
    createdAt: 0,
    content: '',
    recipients: [bob.pubkey],
    wrapId: 'w',
  };

  it('is the same for both sides of a conversation', () => {
    const fromAlice = conversationKey(base, alice.pubkey);
    const fromBob = conversationKey(
      { ...base, pubkey: bob.pubkey, recipients: [alice.pubkey] },
      bob.pubkey
    );

    expect(fromAlice).toBe(bob.pubkey);
    expect(fromBob).toBe(alice.pubkey);
  });

  it('orders group participants so the key is stable', () => {
    const message = { ...base, recipients: [bob.pubkey, eve.pubkey] };
    const key = conversationKey(message, alice.pubkey);

    expect(key).toBe([bob.pubkey, eve.pubkey].sort().join(','));
  });

  it('treats a message to yourself as its own conversation', () => {
    const selfNote = {
      ...base,
      pubkey: alice.pubkey,
      recipients: [alice.pubkey],
    };
    expect(conversationKey(selfNote, alice.pubkey)).toBe(alice.pubkey);
  });
});
