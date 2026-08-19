import { describe, it, expect } from 'vitest';
import {
  NIP,
  anySupports,
  nipSupport,
  refuses,
  relayCapabilities,
  supports,
  type RelayInfo,
} from './nip11';

/** NostrFeed's own relay, as it actually answers. */
const NOSTRFEED: RelayInfo = {
  name: 'NostrFeed Relay',
  software: 'git+https://github.com/hoytech/strfry.git',
  version: '1.1.1-119-g9acdaeb',
  supported_nips: [1, 2, 4, 9, 11, 17, 28, 29, 40, 42, 44, 45, 51, 57, 59, 65, 70, 77],
};

describe('nipSupport', () => {
  it('says yes to a NIP the relay listed', () => {
    expect(nipSupport(NOSTRFEED, NIP.COUNT)).toBe('yes');
  });

  it('says no to a NIP missing from a list that exists', () => {
    // strfry has no full-text index, and this is how you find that out
    expect(nipSupport(NOSTRFEED, NIP.SEARCH)).toBe('no');
  });

  it('says unknown when the relay served no document', () => {
    /*
     * The distinction the whole file exists for. Most relays omit the CORS
     * headers a browser needs, so "no document" is the common case — and
     * reading it as "supports nothing" would disable working features against
     * most of the network.
     */
    expect(nipSupport(null, NIP.COUNT)).toBe('unknown');
    expect(nipSupport(undefined, NIP.COUNT)).toBe('unknown');
  });

  it('says unknown when the document omits the list', () => {
    expect(nipSupport({ name: 'quiet' }, NIP.COUNT)).toBe('unknown');
    expect(nipSupport({ supported_nips: [] }, NIP.COUNT)).toBe('unknown');
  });
});

describe('supports and refuses', () => {
  it('only supports when the answer was yes', () => {
    expect(supports(NOSTRFEED, NIP.COUNT)).toBe(true);
    expect(supports(NOSTRFEED, NIP.SEARCH)).toBe(false);
    expect(supports(null, NIP.COUNT)).toBe(false);
  });

  it('only refuses when the answer was no', () => {
    expect(refuses(NOSTRFEED, NIP.SEARCH)).toBe(true);
    expect(refuses(NOSTRFEED, NIP.COUNT)).toBe(false);

    // An unheard-from relay has not refused anything
    expect(refuses(null, NIP.SEARCH)).toBe(false);
  });
});

describe('anySupports', () => {
  const indexed: RelayInfo = { supported_nips: [1, 50] };

  it('is yes when one relay can, whatever the others say', () => {
    expect(anySupports([NOSTRFEED, indexed], NIP.SEARCH)).toBe('yes');
  });

  it('is no only when every relay said no', () => {
    expect(anySupports([NOSTRFEED, { supported_nips: [1] }], NIP.SEARCH)).toBe(
      'no'
    );
  });

  it('is unknown when one relay never answered', () => {
    /*
     * One silent relay is enough to withhold the verdict: it may well be the
     * one with the index, and widening every search on that guess would cost
     * bandwidth on every relay set containing an unreachable relay.
     */
    expect(anySupports([NOSTRFEED, null], NIP.SEARCH)).toBe('unknown');
  });

  it('is unknown for an empty set', () => {
    expect(anySupports([], NIP.SEARCH)).toBe('unknown');
  });
});

describe('relayCapabilities', () => {
  it('reports each capability against what the relay listed', () => {
    const found = relayCapabilities(NOSTRFEED);
    const byNip = new Map(found.map((row) => [row.capability.nip, row.support]));

    expect(byNip.get(NIP.COUNT)).toBe('yes');
    expect(byNip.get(NIP.NEGENTROPY)).toBe('yes');
    expect(byNip.get(NIP.PROTECTED)).toBe('yes');
    expect(byNip.get(NIP.AUTH)).toBe('yes');
    expect(byNip.get(NIP.SEARCH)).toBe('no');
  });

  it('says nothing at all when the relay published no list', () => {
    // A row of "unknown" chips tells a reader less than no row does
    expect(relayCapabilities({ name: 'quiet' })).toEqual([]);
    expect(relayCapabilities(null)).toEqual([]);
  });

  it('gives every capability a label and an explanation', () => {
    for (const { capability } of relayCapabilities(NOSTRFEED)) {
      expect(capability.label).toBeTruthy();
      expect(capability.hint.length).toBeGreaterThan(20);
    }
  });
});
