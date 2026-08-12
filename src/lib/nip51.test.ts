import { describe, it, expect } from 'vitest';
import type { NostrEvent, NostrSigner } from '@nostrify/nostrify';
import {
  addItem,
  buildListEvent,
  decryptListItems,
  encryptListItems,
  hasItem,
  isLegacyCiphertext,
  isPrivate,
  publicItems,
  removeItem,
  values,
  type ListItems,
} from './nip51';

const ME = 'a'.repeat(64);
const THEM = 'b'.repeat(64);

/**
 * A signer that "encrypts" by tagging the plaintext. Enough to prove the
 * round trip and the scheme selection without pulling in real crypto.
 */
function fakeSigner(options: { nip44?: boolean; nip04?: boolean } = {}): NostrSigner {
  const signer: NostrSigner = {
    getPublicKey: async () => ME,
    signEvent: async () => ({}) as NostrEvent,
  };

  if (options.nip44 !== false) {
    signer.nip44 = {
      encrypt: async (_pubkey, plaintext) => `v2:${btoa(plaintext)}`,
      decrypt: async (_pubkey, ciphertext) => {
        if (!ciphertext.startsWith('v2:')) throw new Error('not v2');
        return atob(ciphertext.slice(3));
      },
    };
  }

  if (options.nip04) {
    signer.nip04 = {
      encrypt: async (_pubkey, plaintext) => `${btoa(plaintext)}?iv=AAAA`,
      decrypt: async (_pubkey, ciphertext) => atob(ciphertext.split('?iv=')[0]),
    };
  }

  return signer;
}

function listEvent(content: string, pubkey = ME): NostrEvent {
  return {
    id: '0'.repeat(64),
    pubkey,
    created_at: 0,
    kind: 10000,
    tags: [],
    content,
    sig: '',
  };
}

describe('isLegacyCiphertext', () => {
  it('detects the NIP-04 shape', () => {
    expect(isLegacyCiphertext('abc==?iv=S3rFeFr1gsYqmQA7bNnNTQ==')).toBe(true);
  });

  it('tolerates surrounding whitespace', () => {
    expect(isLegacyCiphertext('  abc?iv=ZGVm  ')).toBe(true);
  });

  it('does not fire on a NIP-44 payload that happens to contain "iv"', () => {
    // A bare substring search would call all three of these NIP-04
    for (const payload of [
      'AgeivQrf2ndsmdbeGU05HT5GMnBSx3fx8QdDYg3NvCa7klfz',
      'AgXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXiv==',
      'Ag/ivIsHereButNotAParameter++++++++++++++++++++++=',
    ]) {
      expect(payload.includes('iv')).toBe(true);
      expect(isLegacyCiphertext(payload)).toBe(false);
    }
  });
});

describe('encryptListItems / decryptListItems', () => {
  it('round-trips private items', async () => {
    const items = [
      ['p', THEM],
      ['word', 'spoilers'],
    ];

    const signer = fakeSigner();
    const content = await encryptListItems(items, signer, ME);

    expect(await decryptListItems(listEvent(content), signer, ME)).toEqual(items);
  });

  it('writes nothing for an empty private half', async () => {
    expect(await encryptListItems([], fakeSigner(), ME)).toBe('');
  });

  it('refuses to encrypt without NIP-44 rather than falling back to NIP-04', async () => {
    const signer = fakeSigner({ nip44: false, nip04: true });

    await expect(encryptListItems([['p', THEM]], signer, ME)).rejects.toThrow(
      /cannot encrypt/i
    );
  });

  it('reads a legacy NIP-04 payload', async () => {
    const signer = fakeSigner({ nip04: true });
    const content = await signer.nip04!.encrypt(ME, JSON.stringify([['p', THEM]]));

    expect(await decryptListItems(listEvent(content), signer, ME)).toEqual([
      ['p', THEM],
    ]);
  });

  it('does not try to decrypt somebody else\'s list', async () => {
    const signer = fakeSigner();
    const content = await encryptListItems([['p', THEM]], signer, ME);

    expect(await decryptListItems(listEvent(content, THEM), signer, ME)).toEqual(
      []
    );
  });

  it('returns empty rather than throwing on junk', async () => {
    const signer = fakeSigner();

    for (const content of ['v2:bm90IGpzb24=', 'garbage', 'v2:' + btoa('{"a":1}')]) {
      expect(await decryptListItems(listEvent(content), signer, ME)).toEqual([]);
    }
  });

  it('discards entries that are not arrays of strings', async () => {
    const signer = fakeSigner();
    const content = await signer.nip44!.encrypt(
      ME,
      JSON.stringify([['p', THEM], 'loose', [1, 2], [], { p: THEM }, ['word', 'ok']])
    );

    expect(await decryptListItems(listEvent(content), signer, ME)).toEqual([
      ['p', THEM],
      ['word', 'ok'],
    ]);
  });

  it('returns empty with no signer', async () => {
    expect(await decryptListItems(listEvent('v2:abc'), undefined, ME)).toEqual([]);
  });
});

describe('publicItems', () => {
  it('leaves out the tags that describe the list', () => {
    const event: NostrEvent = {
      ...listEvent(''),
      kind: 30000,
      tags: [
        ['d', 'friends'],
        ['title', 'Friends'],
        ['image', 'https://example.com/a.png'],
        ['description', 'people'],
        ['p', THEM],
      ],
    };

    expect(publicItems(event)).toEqual([['p', THEM]]);
  });
});

describe('addItem', () => {
  const empty: ListItems = { public: [], private: [] };

  it('appends rather than prepends', () => {
    let items = addItem(empty, ['p', 'a'.repeat(64)]);
    items = addItem(items, ['p', 'c'.repeat(64)]);

    expect(items.public.map(([, value]) => value)).toEqual([
      'a'.repeat(64),
      'c'.repeat(64),
    ]);
  });

  it('moves an entry between halves instead of duplicating it', () => {
    const publicFirst = addItem(empty, ['p', THEM]);
    const nowPrivate = addItem(publicFirst, ['p', THEM], { private: true });

    expect(nowPrivate.public).toEqual([]);
    expect(nowPrivate.private).toEqual([['p', THEM]]);
    expect(isPrivate(nowPrivate, 'p', THEM)).toBe(true);
  });

  it('moves back out of the private half', () => {
    const privateFirst = addItem(empty, ['p', THEM], { private: true });
    const nowPublic = addItem(privateFirst, ['p', THEM]);

    expect(nowPublic.private).toEqual([]);
    expect(nowPublic.public).toEqual([['p', THEM]]);
  });
});

describe('removeItem', () => {
  it('takes an entry out of both halves', () => {
    const items: ListItems = {
      public: [['p', THEM]],
      private: [['p', THEM]],
    };

    const after = removeItem(items, 'p', THEM);
    expect(hasItem(after, 'p', THEM)).toBe(false);
  });
});

describe('values', () => {
  it('lists public entries before private ones', () => {
    const items: ListItems = {
      public: [['p', 'a'.repeat(64)]],
      private: [['p', 'b'.repeat(64)]],
    };

    expect(values(items, 'p')).toEqual(['a'.repeat(64), 'b'.repeat(64)]);
  });
});

describe('buildListEvent', () => {
  it('puts metadata tags first and private items in the content', async () => {
    const items: ListItems = {
      public: [['p', THEM]],
      private: [['p', 'c'.repeat(64)]],
    };

    const signer = fakeSigner();
    const built = await buildListEvent(items, {
      metadata: [['d', 'friends'], ['title', 'Friends']],
      signer,
      pubkey: ME,
    });

    expect(built.tags).toEqual([
      ['d', 'friends'],
      ['title', 'Friends'],
      ['p', THEM],
    ]);
    expect(await decryptListItems(listEvent(built.content), signer, ME)).toEqual([
      ['p', 'c'.repeat(64)],
    ]);
  });

  it('writes empty content when nothing is private', async () => {
    const built = await buildListEvent(
      { public: [['p', THEM]], private: [] },
      { pubkey: ME }
    );

    expect(built.content).toBe('');
  });
});
