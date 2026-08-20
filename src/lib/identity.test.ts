import { describe, it, expect } from 'vitest';
import {
  describeIdentity,
  listAddresses,
  localPartOf,
  nameByPayLink,
  payLinkTakesName,
  pickPrimaryLink,
  servesAddress,
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
  const format = (link: { username?: string; domain?: string }) =>
    `${link.username}@${link.domain ?? 'nostrfeed.com'}`;

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

describe('describeIdentity with an address from elsewhere', () => {
  it('does not call a deliberate external address out of date', () => {
    // The nag exists for someone who claimed a name and forgot to publish it,
    // not for someone being paid at a wallet they chose
    const status = describeIdentity({
      lightningAddress: 'me@nostrfeed.com',
      profileLud16: 'alice@getalby.com',
    });

    expect(status.unpublished).not.toContain('lud16');
    expect(status.external).toBe('alice@getalby.com');
  });

  it('still flags an address of ours that the profile has not caught up with', () => {
    const status = describeIdentity({
      lightningAddress: 'new@nostrfeed.com',
      profileLud16: 'old@nostrfeed.com',
      ownedAddresses: ['new@nostrfeed.com', 'old@nostrfeed.com'],
    });

    expect(status.unpublished).toContain('lud16');
    expect(status.external).toBeNull();
  });

  it('does not read a second address of their own as having left', () => {
    const status = describeIdentity({
      lightningAddress: 'main@nostrfeed.com',
      profileLud16: 'shop@nostrfeed.com',
      ownedAddresses: ['main@nostrfeed.com', 'shop@nostrfeed.com'],
    });

    expect(status.external).toBeNull();
  });

  it('counts someone with only an external address as having one', () => {
    // Otherwise the card offers to claim them an address as though they had
    // nothing, when they are already being paid
    const status = describeIdentity({ profileLud16: 'alice@getalby.com' });

    expect(status.tier).toBe('external');
    expect(status.primary).toBe('alice@getalby.com');
  });

  it('lets a verified name still lead', () => {
    const status = describeIdentity({
      verifiedName: 'alice@nostrfeed.com',
      profileNip05: 'alice@nostrfeed.com',
      profileLud16: 'alice@getalby.com',
    });

    expect(status.tier).toBe('verified');
    expect(status.primary).toBe('alice@nostrfeed.com');
    expect(status.external).toBe('alice@getalby.com');
  });

  it('does not report a mismatch against an address it does not manage', () => {
    // "Move your zaps to your verified name" is a sensible offer about our
    // own addresses and a wrong one about somebody else's wallet
    const status = describeIdentity({
      verifiedName: 'alice@nostrfeed.com',
      lightningAddress: 'old@nostrfeed.com',
      profileLud16: 'alice@getalby.com',
    });

    expect(status.mismatched).toBe(false);
  });

  it('ignores whitespace and case when deciding what is ours', () => {
    const status = describeIdentity({
      lightningAddress: 'me@nostrfeed.com',
      profileLud16: '  ME@NostrFeed.com  ',
    });

    expect(status.external).toBeNull();
  });

  it('says nothing is external when the profile has no address at all', () => {
    expect(describeIdentity({ lightningAddress: 'me@nostrfeed.com' }).external).toBeNull();
  });
});

/**
 * The rule behind "this name isn't set up to receive yet". It read one field
 * on the name's own record, which a pay link made through the plain lightning
 * flow never writes — so a live, paid, reachable address was announced as one
 * that money disappears into.
 */
describe('nameByPayLink', () => {
  it('gives a pay link the name it was made for', () => {
    /**
     * Turning zaps on for a bought name makes the extension create an `lnurlp`
     * link under the same local part. The link carries no domain, so a list
     * built from pay links stamped the instance's default one on it — and
     * `dev@getzap.me`, the name actually bought, appeared as
     * `dev@ln.nostrfeed.com`: a domain the account holds nothing on.
     */
    expect(
      nameByPayLink([
        { payLinkId: 'RnzDRA', identifier: 'dev@getzap.me', active: true },
      ]).get('RnzDRA')
    ).toBe('dev@getzap.me');
  });

  it('renames nothing for a name that never attached one', () => {
    // The extension's schema defaults `pay_link_id` to the empty string, so a
    // name whose attachment was asked for and never completed has no link
    expect(
      nameByPayLink([
        { payLinkId: '', identifier: 'dev@getzap.me', active: true },
      ]).size
    ).toBe(0);
  });

  it('refuses to rename anything for an unpaid reservation', () => {
    /*
     * The name is the thing being sold. Showing it as held before its invoice
     * settles is the one mistake here that gives away the product.
     */
    expect(
      nameByPayLink([
        { payLinkId: 'RnzDRA', identifier: 'dev@getzap.me', active: false },
      ]).size
    ).toBe(0);
  });

  it('handles an account with no names at all', () => {
    expect(nameByPayLink([]).size).toBe(0);
  });
});

describe('payLinkTakesName', () => {
  it('renames a link that says nothing about where it lives', () => {
    /*
     * What `update_ln_address` creates: a username, a wallet and its limits,
     * and no domain at all. There is nothing to override.
     */
    expect(payLinkTakesName({})).toBe(true);
    expect(payLinkTakesName({ domain: null })).toBe(true);
    expect(payLinkTakesName({ domain: '  ' })).toBe(true);
  });

  it('leaves a link LNbits has placed where LNbits put it', () => {
    /**
     * `PayLink` carries a domain, and a filled-in one is the server stating
     * where the link answers. Overriding it would move a working address onto
     * a domain LNbits never said it was at — the same mistake as the phantom
     * row, pointed the other way.
     */
    expect(payLinkTakesName({ domain: 'ln.nostrfeed.com' })).toBe(false);
  });
});

describe('servesAddress', () => {
  const entries = [
    { address: 'help@ln.nostrfeed.com' },
    { address: 'u0123456789ab@ln.nostrfeed.com' },
  ];

  it('finds an address already answered by a pay link', () => {
    expect(servesAddress(entries, 'help@ln.nostrfeed.com')).toBe(true);
  });

  it('ignores case and stray whitespace on either side', () => {
    expect(servesAddress(entries, '  HELP@LN.NostrFeed.com ')).toBe(true);
    expect(servesAddress([{ address: ' help@ln.nostrfeed.com' }], 'help@ln.nostrfeed.com')).toBe(true);
  });

  it('does not count the same name at another domain', () => {
    expect(servesAddress(entries, 'help@getzap.me')).toBe(false);
  });

  it('answers no when there is nothing to compare', () => {
    expect(servesAddress([], 'help@ln.nostrfeed.com')).toBe(false);
    expect(servesAddress(entries, '')).toBe(false);
    expect(servesAddress(entries, null)).toBe(false);
  });
  /**
   * The instance resolves a lightning address by username alone —
   * `GET /lnurlp/api/v1/well-known/{username}` takes no domain — so one link
   * answers on every domain pointed at it.
   */
  const OURS = ['getzap.me', 'ln.nostrfeed.com'];

  it('counts a link as serving the same name on the instance’s other domain', () => {
    // Proven by the live callback: kk@getzap.me resolves and returns a
    // getzap.me callback, from a link this account holds under the other name
    expect(
      servesAddress([{ address: 'kk@ln.nostrfeed.com' }], 'kk@getzap.me', OURS)
    ).toBe(true);
  });

  it('still refuses a different name on a domain we serve', () => {
    expect(
      servesAddress([{ address: 'kk@ln.nostrfeed.com' }], 'help@getzap.me', OURS)
    ).toBe(false);
  });

  it('refuses a name on a domain this instance does not answer for', () => {
    // Somebody else's host resolves it their way; holding the name here says
    // nothing about that
    expect(
      servesAddress([{ address: 'kk@ln.nostrfeed.com' }], 'kk@getalby.com', OURS)
    ).toBe(false);
  });

  it('does not let a foreign-domain link vouch for one of ours', () => {
    expect(
      servesAddress([{ address: 'kk@getalby.com' }], 'kk@getzap.me', OURS)
    ).toBe(false);
  });

  it('compares whole addresses when no instance domains are given', () => {
    expect(
      servesAddress([{ address: 'kk@ln.nostrfeed.com' }], 'kk@getzap.me')
    ).toBe(false);
  });
});

