import { describe, it, expect } from 'vitest';
import {
  formatHandle,
  nip05Url,
  parseHandle,
  profilePath,
  readNip05Pubkey,
  readNip05Relays,
} from './nip05Lookup';

const PUBKEY = 'a'.repeat(64);
const NPUB = 'npub1example';

describe('parseHandle', () => {
  it('reads a bare name', () => {
    expect(parseHandle('@alice')).toEqual({ name: 'alice' });
  });

  it('reads a full address', () => {
    expect(parseHandle('@alice@getzap.me')).toEqual({
      name: 'alice',
      domain: 'getzap.me',
    });
  });

  it('lowercases both halves', () => {
    expect(parseHandle('@Alice@GetZap.ME')).toEqual({
      name: 'alice',
      domain: 'getzap.me',
    });
  });

  it('accepts the characters NIP-05 allows', () => {
    expect(parseHandle('@a-b_c.d')).toEqual({ name: 'a-b_c.d' });
  });

  it('leaves NIP-19 identifiers alone', () => {
    // They have to fall through to the code that understands them
    expect(parseHandle('npub1abc')).toBeNull();
    expect(parseHandle('note1abc')).toBeNull();
    expect(parseHandle('naddr1abc')).toBeNull();
  });

  it('refuses anything that could redirect the lookup', () => {
    /*
     * The name becomes a query string on somebody else's server, so a segment
     * that can carry a slash or a `?` is a segment that can point the request
     * somewhere else entirely.
     */
    expect(parseHandle('@alice/../bob')).toBeNull();
    expect(parseHandle('@alice?x=1')).toBeNull();
    expect(parseHandle('@alice&x=1')).toBeNull();
    expect(parseHandle('@alice#x')).toBeNull();
    expect(parseHandle('@ali ce')).toBeNull();
  });

  it('refuses an address with too many parts', () => {
    expect(parseHandle('@a@b@c.com')).toBeNull();
  });

  it('refuses a domain that is not one', () => {
    expect(parseHandle('@alice@localhost')).toBeNull();
    expect(parseHandle('@alice@')).toBeNull();
  });

  it('refuses an empty or missing handle', () => {
    expect(parseHandle('@')).toBeNull();
    expect(parseHandle('')).toBeNull();
    expect(parseHandle(undefined)).toBeNull();
  });
});

describe('formatHandle', () => {
  it('writes a bare name', () => {
    expect(formatHandle({ name: 'alice' })).toBe('@alice');
  });

  it('writes a full address', () => {
    expect(formatHandle({ name: 'alice', domain: 'getzap.me' })).toBe(
      '@alice@getzap.me'
    );
  });
});

describe('nip05Url', () => {
  it('builds the well-known lookup', () => {
    expect(nip05Url('alice', 'getzap.me')).toBe(
      'https://getzap.me/.well-known/nostr.json?name=alice'
    );
  });

  it('escapes the name it is given', () => {
    expect(nip05Url('a b', 'getzap.me')).toContain('name=a%20b');
  });
});

describe('readNip05Pubkey', () => {
  it('finds the key for a name', () => {
    expect(readNip05Pubkey({ names: { alice: PUBKEY } }, 'alice')).toBe(PUBKEY);
  });

  it('matches a name however the file cased it', () => {
    // The spec says lowercase; plenty of real files key them as typed
    expect(readNip05Pubkey({ names: { Alice: PUBKEY } }, 'alice')).toBe(PUBKEY);
  });

  it('lowercases the key it returns', () => {
    expect(
      readNip05Pubkey({ names: { alice: PUBKEY.toUpperCase() } }, 'alice')
    ).toBe(PUBKEY);
  });

  it('refuses a value that is not a public key', () => {
    expect(readNip05Pubkey({ names: { alice: 'nope' } }, 'alice')).toBeNull();
    expect(readNip05Pubkey({ names: { alice: 123 } }, 'alice')).toBeNull();
    expect(readNip05Pubkey({ names: { alice: null } }, 'alice')).toBeNull();
  });

  it('finds nothing for a name the file does not carry', () => {
    expect(readNip05Pubkey({ names: { bob: PUBKEY } }, 'alice')).toBeNull();
  });

  it('copes with a document that is not a nostr.json at all', () => {
    // A parking page, an error body, a proxy that answers with anything
    expect(readNip05Pubkey(null, 'alice')).toBeNull();
    expect(readNip05Pubkey('<html>', 'alice')).toBeNull();
    expect(readNip05Pubkey({}, 'alice')).toBeNull();
    expect(readNip05Pubkey({ names: 'nope' }, 'alice')).toBeNull();
  });
});

describe('readNip05Relays', () => {
  it('takes the hints for a key', () => {
    const body = { relays: { [PUBKEY]: ['wss://a.example'] } };
    expect(readNip05Relays(body, PUBKEY)).toEqual(['wss://a.example']);
  });

  it('drops anything that is not a relay url', () => {
    const body = {
      relays: { [PUBKEY]: ['wss://a.example', 'https://b.example', 42] },
    };

    expect(readNip05Relays(body, PUBKEY)).toEqual(['wss://a.example']);
  });

  it('has nothing when the document names none', () => {
    expect(readNip05Relays({}, PUBKEY)).toEqual([]);
    expect(readNip05Relays({ relays: {} }, PUBKEY)).toEqual([]);
    expect(readNip05Relays(null, PUBKEY)).toEqual([]);
  });
});

describe('profilePath', () => {
  const ours = ['getzap.me', 'ln.nostrfeed.com'];

  it('shortens a name on one of our domains', () => {
    expect(profilePath('alice@getzap.me', NPUB, ours)).toBe('/@alice');
  });

  it('keeps the domain for a name hosted elsewhere', () => {
    expect(profilePath('alice@elsewhere.com', NPUB, ours)).toBe(
      '/@alice@elsewhere.com'
    );
  });

  it('falls back to the key when there is no name', () => {
    expect(profilePath(undefined, NPUB, ours)).toBe(`/${NPUB}`);
    expect(profilePath('', NPUB, ours)).toBe(`/${NPUB}`);
  });

  it('falls back to the key for the root name', () => {
    /*
     * NIP-05 gives `_` the meaning "the domain itself", so it is displayed as
     * the bare domain and is not a name anybody can type back.
     */
    expect(profilePath('_@getzap.me', NPUB, ours)).toBe(`/${NPUB}`);
  });

  it('falls back to the key for a nip05 that is not an address', () => {
    expect(profilePath('not-an-address', NPUB, ours)).toBe(`/${NPUB}`);
  });

  it('produces a path that parses back to the same handle', () => {
    // The round trip is the whole contract: a link this writes must resolve
    const path = profilePath('alice@elsewhere.com', NPUB, ours);

    expect(parseHandle(path.slice(1))).toEqual({
      name: 'alice',
      domain: 'elsewhere.com',
    });
  });
});
