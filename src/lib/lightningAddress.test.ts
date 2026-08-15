import { describe, it, expect } from 'vitest';
import {
  ADDRESS_DOMAIN,
  ADDRESS_DOMAINS,
  DEFAULT_LINK_DOMAIN,
  FREE_ADDRESS_DOMAIN,
  FREE_ADDRESS_DOMAINS,
  buildPayLinkBody,
  formatAddress,
  isFreeAddressDomain,
  linkAddress,
  isOurAddress,
  parseLightningAddress,
  suggestUsername,
  validateUsername,
} from './lightningAddress';

describe('suggestUsername', () => {
  it('lowercases and strips spaces from a display name', () => {
    expect(suggestUsername('Satoshi Nakamoto')).toBe('satoshinakamoto');
  });

  it('keeps the punctuation a lightning address allows', () => {
    expect(suggestUsername('a.b-c_d')).toBe('a.b-c_d');
  });

  it('folds accents down instead of dropping the letter', () => {
    // Losing the character entirely would turn "José" into "jos"
    expect(suggestUsername('José')).toBe('jose');
    expect(suggestUsername('Æther')).toBe('aether');
  });

  it('spells out letters normalisation refuses to decompose', () => {
    // These are distinct letters, not accented ones, so NFKD leaves them whole
    // and the ASCII filter would otherwise delete them
    expect(suggestUsername('Ærik')).toBe('aerik');
    expect(suggestUsername('Søren')).toBe('soren');
    expect(suggestUsername('Straße')).toBe('strasse');
    expect(suggestUsername('Łukasz')).toBe('lukasz');
  });

  it('drops emoji and other characters an address cannot carry', () => {
    expect(suggestUsername('bitcoin🔥maxi')).toBe('bitcoinmaxi');
  });

  it('trims punctuation off the ends, which reads as a typo', () => {
    expect(suggestUsername('.alice.')).toBe('alice');
    expect(suggestUsername('--bob--')).toBe('bob');
  });

  it('caps the length', () => {
    expect(suggestUsername('a'.repeat(80))).toHaveLength(32);
  });

  it('returns empty rather than garbage for an unusable name', () => {
    expect(suggestUsername('🔥🔥🔥')).toBe('');
    expect(suggestUsername('   ')).toBe('');
  });
});

describe('validateUsername', () => {
  it('accepts an ordinary name', () => {
    expect(validateUsername('satoshi')).toBeNull();
    expect(validateUsername('a.b-c_d')).toBeNull();
  });

  it('rejects names that are too short or too long', () => {
    expect(validateUsername('a')).toBe('too-short');
    expect(validateUsername('')).toBe('too-short');
    expect(validateUsername('a'.repeat(33))).toBe('too-long');
  });

  it('rejects characters a lightning address cannot carry', () => {
    expect(validateUsername('Satoshi')).toBe('invalid-characters');
    expect(validateUsername('a b')).toBe('invalid-characters');
    expect(validateUsername('a@b')).toBe('invalid-characters');
  });

  it('rejects leading or trailing punctuation', () => {
    expect(validateUsername('.alice')).toBe('edge-punctuation');
    expect(validateUsername('alice.')).toBe('edge-punctuation');
    expect(validateUsername('_alice')).toBe('edge-punctuation');
  });

  it('accepts everything suggestUsername produces from a real name', () => {
    for (const name of ['Satoshi Nakamoto', 'José', 'bitcoin🔥maxi', 'a.b-c']) {
      const suggested = suggestUsername(name);
      expect(validateUsername(suggested), name).toBeNull();
    }
  });
});

describe('buildPayLinkBody', () => {
  const body = buildPayLinkBody({
    username: 'satoshi',
    walletId: 'wallet-1',
    displayName: 'Satoshi',
  });

  it('is not disposable, which the API otherwise defaults to', () => {
    // A disposable link stops working after one payment — useless as an address
    expect(body.disposable).toBe(false);
  });

  it('enables zaps', () => {
    expect(body.zaps).toBe(true);
  });

  it('allows a comment, which is where a zap message travels', () => {
    // The API defaults to 0, which would silently discard every zap note
    expect(body.comment_chars).toBeGreaterThan(0);
  });

  it('spans a usable amount range', () => {
    expect(body.min).toBe(1);
    expect(body.max).toBeGreaterThan(1_000_000);
  });

  it('carries the username and wallet through', () => {
    expect(body.username).toBe('satoshi');
    expect(body.wallet).toBe('wallet-1');
  });

  it('falls back to a generic description without a display name', () => {
    const anonymous = buildPayLinkBody({
      username: 'satoshi',
      walletId: 'wallet-1',
    });
    expect(anonymous.description).toBeTruthy();
  });
});

describe('parseLightningAddress', () => {
  it('reads a plain address', () => {
    const { address } = parseLightningAddress('alice@getalby.com');

    expect(address?.name).toBe('alice');
    expect(address?.domain).toBe('getalby.com');
    expect(address?.address).toBe('alice@getalby.com');
  });

  it('builds the URL a wallet will actually fetch', () => {
    expect(parseLightningAddress('alice@getalby.com').address?.lnurlpUrl).toBe(
      'https://getalby.com/.well-known/lnurlp/alice'
    );
  });

  it('normalises what people actually paste', () => {
    // QR codes carry a `lightning:` prefix, profile pages a ⚡, and phone
    // keyboards capitalise the first letter - all name a working address
    for (const input of [
      'lightning:alice@getalby.com',
      '⚡ alice@getalby.com',
      '  Alice@GetAlby.com  ',
      'LIGHTNING:ALICE@GETALBY.COM',
    ]) {
      expect(parseLightningAddress(input).address?.address).toBe(
        'alice@getalby.com'
      );
    }
  });

  it('accepts the punctuation LUD-16 allows in a name', () => {
    expect(parseLightningAddress('a.b-c_d@example.com').address?.name).toBe(
      'a.b-c_d'
    );
  });

  it('accepts a subdomain', () => {
    expect(parseLightningAddress('alice@pay.example.co.uk').address?.domain).toBe(
      'pay.example.co.uk'
    );
  });

  it('refuses an LNURL string, which is not what lud16 holds', () => {
    // A profile carrying one here is unzappable by every client reading the
    // field, and it looks close enough to right to go unnoticed
    expect(parseLightningAddress('lnurl1dp68gurn8ghj7').problem).toBe(
      'not-an-address'
    );
  });

  it('names what is wrong rather than just failing', () => {
    expect(parseLightningAddress('').problem).toBe('empty');
    expect(parseLightningAddress('alice').problem).toBe('not-an-address');
    expect(parseLightningAddress('al ice@x.com').problem).toBe('invalid-name');
    expect(parseLightningAddress('@x.com').problem).toBe('invalid-name');
    expect(parseLightningAddress('alice@localhost').problem).toBe('invalid-domain');
    expect(parseLightningAddress('alice@x.com/pay').problem).toBe('invalid-domain');
    expect(parseLightningAddress('alice@x.com:3000').problem).toBe('invalid-domain');
  });
});

describe('isOurAddress', () => {
  it('recognises an address this app issued', () => {
    expect(isOurAddress(`bob@${ADDRESS_DOMAIN}`)).toBe(true);
    expect(isOurAddress(`BOB@${ADDRESS_DOMAIN.toUpperCase()}`)).toBe(true);
  });

  it('does not claim an address from elsewhere', () => {
    expect(isOurAddress('bob@getalby.com')).toBe(false);
  });
});

/**
 * These assert the shape of the free/paid split rather than the names in it:
 * which domains a deployment sells is configuration, read at import time, and
 * a test that hard-codes one only proves what this checkout's `.env` says.
 * What has to hold everywhere is that the free tier can never hand out a
 * domain we do not serve, and never leaves nothing to hand out at all.
 */
describe('free address domains', () => {
  it('only ever offers domains this app actually serves', () => {
    for (const entry of FREE_ADDRESS_DOMAINS) {
      expect(ADDRESS_DOMAINS).toContain(entry);
    }
  });

  it('always has one to give away', () => {
    expect(FREE_ADDRESS_DOMAINS.length).toBeGreaterThan(0);
    expect(FREE_ADDRESS_DOMAIN).toBe(FREE_ADDRESS_DOMAINS[0]);
  });

  it('recognises a free domain however it is written', () => {
    expect(isFreeAddressDomain(FREE_ADDRESS_DOMAIN)).toBe(true);
    expect(isFreeAddressDomain(FREE_ADDRESS_DOMAIN.toUpperCase())).toBe(true);
    expect(isFreeAddressDomain(`@${FREE_ADDRESS_DOMAIN}`)).toBe(true);
  });

  it('does not treat a stranger as free', () => {
    expect(isFreeAddressDomain('getalby.com')).toBe(false);
  });
});

describe('DEFAULT_LINK_DOMAIN', () => {
  it('is a domain we serve', () => {
    expect(ADDRESS_DOMAINS).toContain(DEFAULT_LINK_DOMAIN);
  });

  it('labels a link that carries no domain of its own', () => {
    expect(formatAddress('bob')).toBe(`bob@${DEFAULT_LINK_DOMAIN}`);
    expect(linkAddress({ username: 'bob' })).toBe(`bob@${DEFAULT_LINK_DOMAIN}`);
  });

  it('never overrides a domain the link does carry', () => {
    expect(linkAddress({ username: 'bob', domain: 'zap.example' })).toBe(
      'bob@zap.example'
    );
  });
});
