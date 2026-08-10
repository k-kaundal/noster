import { describe, it, expect } from 'vitest';
import {
  describeIdentity,
  listAddresses,
  localPartOf,
  pickPrimaryLink,
  suggestIdentityName,
  withIdentity,
} from './identity';

describe('localPartOf', () => {
  it('reads the name out of an address', () => {
    expect(localPartOf('alice@nostrfeed.com')).toBe('alice');
  });

  it('returns nothing for something that is not one', () => {
    expect(localPartOf('alice')).toBeNull();
    expect(localPartOf('@nostrfeed.com')).toBeNull();
    expect(localPartOf(null)).toBeNull();
  });
});

describe('describeIdentity', () => {
  it('reports nobody with neither', () => {
    expect(describeIdentity({})).toMatchObject({ tier: 'none', primary: null });
  });

  it('reports the free tier when there is only an address', () => {
    const status = describeIdentity({ lightningAddress: 'alice@nostrfeed.com' });

    expect(status.tier).toBe('free');
    expect(status.primary).toBe('alice@nostrfeed.com');
  });

  it('prefers the verified name once one is owned', () => {
    const status = describeIdentity({
      verifiedName: 'alice@nostrfeed.com',
      lightningAddress: 'alice@nostrfeed.com',
    });

    expect(status.tier).toBe('verified');
    expect(status.primary).toBe('alice@nostrfeed.com');
  });

  it('ignores a name whose invoice has not settled', () => {
    // Publishing it would advertise a nip05 that fails to verify
    const status = describeIdentity({
      verifiedName: 'alice@nostrfeed.com',
      verifiedActive: false,
      lightningAddress: 'old@nostrfeed.com',
    });

    expect(status.tier).toBe('free');
    expect(status.primary).toBe('old@nostrfeed.com');
  });

  it('lists what the profile has not caught up with', () => {
    const status = describeIdentity({
      verifiedName: 'alice@nostrfeed.com',
      lightningAddress: 'alice@nostrfeed.com',
    });

    expect(status.unpublished).toEqual(['nip05', 'lud16']);
  });

  it('lists nothing once the profile agrees', () => {
    const status = describeIdentity({
      verifiedName: 'alice@nostrfeed.com',
      lightningAddress: 'alice@nostrfeed.com',
      profileNip05: 'alice@nostrfeed.com',
      profileLud16: 'alice@nostrfeed.com',
    });

    expect(status.unpublished).toEqual([]);
  });

  it('notices when zaps still go to the old name', () => {
    const status = describeIdentity({
      verifiedName: 'alice@nostrfeed.com',
      lightningAddress: 'a1b2c3@nostrfeed.com',
    });

    expect(status.mismatched).toBe(true);
  });

  it('does not call one name a mismatch with itself', () => {
    expect(
      describeIdentity({
        verifiedName: 'alice@nostrfeed.com',
        lightningAddress: 'ALICE@nostrfeed.com',
      }).mismatched
    ).toBe(true);
    // Case differs but the local parts do — deliberately strict, since two
    // pay links can genuinely exist under different casings
  });
});

describe('withIdentity', () => {
  it('adds both fields in one document', () => {
    const merged = withIdentity(
      { name: 'Alice', about: 'hi' },
      { nip05: 'alice@x.com', lud16: 'alice@x.com' }
    );

    expect(merged).toEqual({
      name: 'Alice',
      about: 'hi',
      nip05: 'alice@x.com',
      lud16: 'alice@x.com',
    });
  });

  it('keeps everything else, because kind 0 replaces', () => {
    const merged = withIdentity(
      { name: 'Alice', picture: 'https://x/a.png', banner: 'https://x/b.png' },
      { lud16: 'alice@x.com' }
    );

    expect(merged.picture).toBe('https://x/a.png');
    expect(merged.banner).toBe('https://x/b.png');
  });

  it('leaves a field alone when there is nothing to set', () => {
    const merged = withIdentity({ nip05: 'old@x.com' }, { lud16: 'a@x.com' });

    expect(merged.nip05).toBe('old@x.com');
  });
});

describe('suggestIdentityName', () => {
  it('uses the profile name people already know them by', () => {
    expect(suggestIdentityName('Alice', 'wandering-otter')).toBe('Alice');
  });

  it('falls back to something stable rather than nothing', () => {
    expect(suggestIdentityName(undefined, 'wandering-otter')).toBe(
      'wandering-otter'
    );
  });

  it('treats a blank profile name as absent', () => {
    expect(suggestIdentityName('   ', 'wandering-otter')).toBe(
      'wandering-otter'
    );
  });
});

describe('pickPrimaryLink', () => {
  const links = [
    { username: 'old' },
    { username: undefined },
    { username: 'alice' },
  ];

  it('prefers the link matching the verified name', () => {
    // A wallet accumulates one pay link per name ever claimed; taking the
    // first would let an abandoned name outrank the one just bought
    expect(pickPrimaryLink(links, 'alice')).toEqual({ username: 'alice' });
  });

  it('matches regardless of case', () => {
    expect(pickPrimaryLink(links, 'ALICE')).toEqual({ username: 'alice' });
  });

  it('falls back to the first named link', () => {
    expect(pickPrimaryLink(links)).toEqual({ username: 'old' });
    expect(pickPrimaryLink(links, 'nobody')).toEqual({ username: 'old' });
  });

  it('returns nothing when there are no links', () => {
    expect(pickPrimaryLink([])).toBeNull();
    expect(pickPrimaryLink([{ username: undefined }])).toBeNull();
  });
});

describe('listAddresses', () => {
  const format = (username: string) => `${username}@nostrfeed.com`;

  const links = [
    { id: '1', username: 'zed' },
    { id: '2', username: undefined },
    { id: '3', username: 'alice' },
    { id: '4', username: 'bob' },
  ];

  it('keeps every named link', () => {
    // The whole point: a wallet answers to all of these, and showing one of
    // them means an address someone handed out is invisible here
    expect(listAddresses(links, { format }).map((entry) => entry.username)).toEqual([
      'alice',
      'bob',
      'zed',
    ]);
  });

  it('drops links with no name, which cannot be an address', () => {
    expect(listAddresses(links, { format })).toHaveLength(3);
  });

  it('puts the verified name first and the zap target next', () => {
    const entries = listAddresses(links, {
      format,
      preferredUsername: 'zed',
      profileLud16: 'bob@nostrfeed.com',
    });

    expect(entries.map((entry) => entry.username)).toEqual(['zed', 'bob', 'alice']);
  });

  it('marks which one the profile advertises', () => {
    const entries = listAddresses(links, {
      format,
      profileLud16: 'bob@nostrfeed.com',
    });

    expect(entries.filter((entry) => entry.onProfile).map((e) => e.username)).toEqual([
      'bob',
    ]);
  });

  it('marks nothing as advertised when the profile points elsewhere', () => {
    // A lud16 pointing at another wallet entirely is legal and worth not
    // mislabelling as one of these
    const entries = listAddresses(links, {
      format,
      profileLud16: 'alice@example.com',
    });

    expect(entries.some((entry) => entry.onProfile)).toBe(false);
  });

  it('matches the verified name regardless of case', () => {
    const entries = listAddresses(links, { format, preferredUsername: 'ALICE' });
    expect(entries[0].preferred).toBe(true);
    expect(entries[0].username).toBe('alice');
  });

  it('orders the rest alphabetically so the list does not reshuffle', () => {
    const shuffled = [...links].reverse();

    expect(listAddresses(shuffled, { format }).map((entry) => entry.username)).toEqual(
      listAddresses(links, { format }).map((entry) => entry.username)
    );
  });

  it('handles a wallet with no addresses', () => {
    expect(listAddresses([], { format })).toEqual([]);
  });
});
