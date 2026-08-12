/**
 * One name, two things it can be.
 *
 * `alice@nostrfeed.com` is written the same way whether it is a free pay link
 * or a verified name bought by the year, and the wallet page showed them as two
 * unrelated cards — a lightning address, and separately a name to reserve. That
 * is not how anyone thinks about it. What people want is *their name*, and for
 * money and identity to both arrive at it.
 *
 * So the two are modelled here as tiers of one thing:
 *
 * - **free** — a lightning address only. Receives zaps, never expires, and
 *   puts no checkmark anywhere. Suggested from their profile name, or from
 *   their key when they have no profile yet.
 * - **verified** — a NIP-05 name they paid for. It becomes the identity, and
 *   the lightning address is re-issued at the same name so one string does
 *   both jobs.
 *
 * Nothing here talks to a server. It decides what state someone is in and what
 * is left to do about it, which is the part worth testing.
 */

import { tierOf } from '@/lib/tiers';

export type IdentityTier = 'none' | 'external' | 'free' | 'verified';

/** Which profile field is behind, if either. */
export type ProfileField = 'nip05' | 'lud16';

export interface IdentitySnapshot {
  /** The NIP-05 identifier they own, e.g. `alice@nostrfeed.com`. */
  verifiedName?: string | null;
  /** Whether that name is live — a bought name is inactive until it is paid. */
  verifiedActive?: boolean;
  /** The LUD-16 address zaps land at. */
  lightningAddress?: string | null;
  /** What the published profile currently says. */
  profileNip05?: string;
  profileLud16?: string;
  /**
   * Every address this app issued for them.
   *
   * Needed to tell a stale zap address from a deliberate one: a profile
   * pointing somewhere we do not recognise is a person using a wallet from
   * elsewhere, not a person who forgot to press publish.
   */
  ownedAddresses?: string[];
}

export interface IdentityStatus {
  tier: IdentityTier;
  /** The single line to show as "this is you". */
  primary: string | null;
  /** Fields that exist here but the profile does not yet advertise. */
  unpublished: ProfileField[];
  /**
   * Whether the verified name and the lightning address are different names.
   *
   * Legal, and occasionally deliberate, but usually it means someone claimed a
   * free address first and bought a nicer name later — in which case zaps are
   * still going to the old one.
   */
  mismatched: boolean;
  /**
   * An address on the profile that this app did not issue.
   *
   * Someone can perfectly well be paid at an address they bought somewhere
   * else, and the app used to treat that as a mistake — nagging them on every
   * visit to overwrite a working address with ours.
   */
  external: string | null;
}

/** The part before the `@`. */
export function localPartOf(address: string | null | undefined): string | null {
  if (!address) return null;

  const at = address.indexOf('@');
  return at > 0 ? address.slice(0, at) : null;
}

/** Where someone stands, and what is left to do. */
export function describeIdentity(snapshot: IdentitySnapshot): IdentityStatus {
  // A name whose invoice has not settled is not an identity yet; treating it
  // as one would publish a nip05 that fails to verify
  const verified =
    snapshot.verifiedName && snapshot.verifiedActive !== false
      ? snapshot.verifiedName
      : null;

  const address = snapshot.lightningAddress ?? null;

  /**
   * An address on the profile that is none of ours.
   *
   * Compared against every address they hold here rather than just the
   * primary one, so pointing zaps at their own second address does not read
   * as having left.
   */
  const owned = new Set(
    [...(snapshot.ownedAddresses ?? []), ...(address ? [address] : [])].map(
      (entry) => entry.toLowerCase()
    )
  );

  const profileLud16 = snapshot.profileLud16?.trim() || '';

  /**
   * An address on the profile that is none of ours.
   *
   * Recognised by domain as well as by the list of what this app issued,
   * because the list costs network and the domain does not.
   */
  const external =
    profileLud16 &&
    !owned.has(profileLud16.toLowerCase()) &&
    !tierOf(profileLud16)
      ? profileLud16
      : null;

  const unpublished: ProfileField[] = [];
  if (verified && snapshot.profileNip05 !== verified) unpublished.push('nip05');

  /**
   * Not flagged when the profile deliberately points elsewhere. "Your zap
   * address is out of date" is true of someone who claimed a new name and
   * forgot to publish it, and false — and quite annoying — for someone being
   * paid at a wallet they chose.
   */
  if (address && !external && snapshot.profileLud16 !== address) {
    unpublished.push('lud16');
  }

  const tier: IdentityTier = verified
    ? 'verified'
    : address
      ? 'free'
      : external
        ? 'external'
        : 'none';

  return {
    tier,
    primary: verified ?? address ?? external,
    unpublished,
    external,
    mismatched:
      !!verified &&
      !!address &&
      !external &&
      localPartOf(verified) !== localPartOf(address),
  };
}

/**
 * The kind 0 content to publish, merged onto whatever is already there.
 *
 * Kind 0 replaces rather than merges, so this takes the existing metadata and
 * returns a whole document. Both fields go in one event: publishing them
 * separately means two signatures, two relay round trips, and a window where
 * the profile claims a name it cannot be paid at.
 */
export function withIdentity(
  metadata: Record<string, unknown>,
  identity: { nip05?: string | null; lud16?: string | null }
): Record<string, unknown> {
  const next = { ...metadata };

  if (identity.nip05) next.nip05 = identity.nip05;
  if (identity.lud16) next.lud16 = identity.lud16;

  return next;
}

/**
 * A username to offer someone who has not picked one.
 *
 * Their profile name if they have one, since that is what people already know
 * them by. Otherwise a name derived from their key — which `genUserName`
 * produces and which is stable, unlike anything random, so the suggestion does
 * not change between two looks at the same page.
 */
export function suggestIdentityName(
  profileName: string | undefined,
  fallbackName: string
): string {
  return profileName?.trim() || fallbackName.trim();
}

/**
 * The pay link that is the person's address.
 *
 * A wallet accumulates pay links — one per name ever claimed — and picking the
 * first with a username means an old name outranks the one they just bought.
 * The verified name wins when there is a link for it.
 */
export function pickPrimaryLink<T extends { username?: string }>(
  links: T[],
  preferredUsername?: string | null
): T | null {
  if (!links.length) return null;

  if (preferredUsername) {
    const preferred = links.find(
      (link) =>
        link.username?.toLowerCase() === preferredUsername.toLowerCase()
    );
    if (preferred) return preferred;
  }

  return links.find((link) => !!link.username) ?? null;
}

/** One lightning address on a wallet, and what it is currently doing. */
export interface AddressEntry<T> {
  link: T;
  username: string;
  address: string;
  /**
   * The domain half, kept apart from the address so a list can group or label
   * by it. With one domain configured this is the same for every entry and
   * costs nothing; with several it is the difference between two addresses.
   */
  domain: string;
  /** Whether the published profile sends zaps here. */
  onProfile: boolean;
  /** Whether this is the address matching a verified NIP-05 name. */
  preferred: boolean;
}

/**
 * Every address a wallet can receive at, in the order worth reading them.
 *
 * A wallet accumulates a pay link per name ever claimed, and the app used to
 * reduce that list to one and drop the rest on the floor. They all still work
 * — money sent to any of them arrives — so hiding them meant an address
 * someone had handed out was invisible here and impossible to retire.
 *
 * Ordered by what the reader is looking for: the name they bought, then the
 * one their profile actually advertises, then the rest alphabetically so the
 * list does not reshuffle between two looks at the same page.
 */
export function listAddresses<T extends { username?: string }>(
  links: T[],
  options: {
    /**
     * Takes the whole link rather than the name, because a link carries the
     * domain it answers under and two links with the same name under different
     * domains are two different addresses.
     */
    format: (link: T) => string;
    profileLud16?: string;
    preferredUsername?: string | null;
  }
): AddressEntry<T>[] {
  const preferred = options.preferredUsername?.toLowerCase();

  const entries = links
    .filter((link): link is T & { username: string } => !!link.username)
    .map((link) => {
      const address = options.format(link);
      const at = address.lastIndexOf('@');

      return {
        link,
        username: link.username,
        address,
        domain: at > 0 ? address.slice(at + 1) : '',
        onProfile: !!options.profileLud16 && options.profileLud16 === address,
        preferred: !!preferred && link.username.toLowerCase() === preferred,
      };
    });

  const rank = (entry: AddressEntry<T>) =>
    entry.preferred ? 0 : entry.onProfile ? 1 : 2;

  /**
   * Name first, then domain. Sorting by the full address would scatter
   * `alice@one.example` and `alice@two.example` apart, when the thing somebody
   * is looking for is the name.
   */
  return entries.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.username.localeCompare(b.username) ||
      a.domain.localeCompare(b.domain)
  );
}
