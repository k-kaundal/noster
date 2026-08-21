import {
  ADDRESS_DOMAINS,
  isFreeAddressDomain,
  normalizeDomain,
} from '@/lib/lightningAddress';
import { NIP5_DOMAINS } from '@/lib/nip5';
import { isGeneratedName } from '@/lib/freeAddress';

/**
 * Every domain an address of ours can be at.
 *
 * Two lists, because they are two products the operator configures separately:
 * lightning addresses come off `lnurlp` pay links, verified names off the
 * `nostrnip5` extension, and nothing says one deployment must sell both under
 * the same hostname. A verified name can have a lightning address attached to
 * it, which puts a real address of ours on a domain the first list has never
 * heard of — and an address that ranks as nobody's disappears from the page
 * that is supposed to list what somebody owns.
 */
const OUR_DOMAINS: string[] = [
  ...new Set([
    ...ADDRESS_DOMAINS,
    ...NIP5_DOMAINS.map((entry) => entry.domain),
  ]),
];

/**
 * The two things a name can be here, and what separates them.
 *
 * Both tiers receive zaps. That is deliberate and it is the part worth being
 * loud about: most Nostr clients give a new account no way to be paid at all,
 * so somebody arrives, posts, and finds the zap button on their own profile
 * does nothing. Here the free tier is a working lightning address from the
 * first minute — it just does not say who you are.
 *
 * What money buys is the name:
 *
 * - **assigned** — derived from the key. Permanent, free, receives zaps, and
 *   looks like what it is: a string nobody chose.
 * - **unverified** — a name somebody picked, at a domain that sells names,
 *   which they have not bought *here*. It takes money and carries no ✓.
 * - **named** — a name at a domain that also gives names away, bought by the
 *   year through the NIP-05 extension, which is what puts a ✓ against posts.
 * - **premium** — the same purchase at a domain that sells every name it has.
 *   Nobody arrives there by accident, which is the whole distinction: the free
 *   domain hands out assigned names to anyone who presses the button, and a
 *   sell-only domain has no free rung to arrive on. Everything a name carries
 *   at that domain — the address, the inbox, the on-chain deposit, the wallet
 *   connection — was chosen and paid for.
 * There was a fourth, `portable`, at an outside wallet service's domain. That
 * service is gone, and with it the only issuer of that tier — a rung nothing
 * can reach is worse than no rung, because it leaves an upsell on screen
 * pointing at something nobody can buy.
 *
 * The middle rung exists because a pay link and a bought name are the same
 * string. Attaching a lightning address to `dev@one.example` makes the
 * extension issue a pay link named `dev`, which LNbits answers for on its own
 * host — so `dev@two.example` appears, chosen-looking, payable, and bought by
 * nobody. Calling that free was wrong twice over: it is a name somebody picked,
 * and it is for sale at that domain like any other.
 *
 * Kept apart from `identity.ts`, which answers "what is left to do"; this
 * answers "what does somebody have, and which of it is best".
 */
export type NameTier = 'assigned' | 'unverified' | 'named' | 'premium';

/** Ascending. The last one somebody holds is the one to lead with. */
export const TIER_ORDER: NameTier[] = [
  'assigned',
  'unverified',
  'named',
  'premium',
];

/**
 * Whether a domain of ours sells every name it has.
 *
 * Derived rather than configured, because the app already draws this line:
 * `FREE_ADDRESS_DOMAINS` is the set a free assigned address may be issued
 * under, and a domain of ours outside it has no free rung at all. Adding a
 * `VITE_PREMIUM_DOMAINS` beside it would be a second place the same truth
 * lives, and the two would drift the first time somebody changed one.
 *
 * A deployment serving one domain, which gives names away, therefore has no
 * premium tier and never shows one — which is correct, not a gap.
 */
export function isPremiumDomain(domain: string): boolean {
  const normalized = normalizeDomain(domain);
  return OUR_DOMAINS.includes(normalized) && !isFreeAddressDomain(normalized);
}

export function tierRank(tier: NameTier): number {
  return TIER_ORDER.indexOf(tier);
}

export interface TierCopy {
  /** Two or three words, for a badge. */
  label: string;
  /** One line, for underneath. */
  blurb: string;
  /**
   * Which mark to draw. Names a shape rather than a component so this file
   * stays testable and free of React.
   */
  mark: 'dot' | 'check' | 'gem' | 'shield';
}

export function describeTier(
  tier: NameTier,
  /**
   * Where the name is, so the middle rung can say where to buy it.
   *
   * "Not verified" on its own is a verdict with no next step, and the next
   * step is the whole reason to say it — the same name is on sale at the
   * domain it is already sitting at.
   */
  options: { domain?: string } = {}
): TierCopy {
  switch (tier) {
    case 'premium':
      return {
        label: 'Premium',
        blurb: options.domain
          ? `A bought name at ${options.domain}, where none are given away.`
          : 'A bought name at a domain where none are given away.',
        mark: 'gem',
      };
    case 'named':
      return {
        label: 'Verified',
        blurb: 'Your own name, and a ✓ on everything you post.',
        mark: 'check',
      };
    case 'unverified':
      return {
        label: 'Not verified',
        blurb: options.domain
          ? `Receives zaps. Buy it at ${options.domain} to add the ✓.`
          : 'Receives zaps. Buy this name to add the ✓.',
        mark: 'dot',
      };
    default:
      return {
        label: 'Free',
        blurb: 'Receives zaps from every client. Assigned, not chosen.',
        mark: 'dot',
      };
  }
}

/**
 * Which tier an address belongs to.
 *
 * Decided by domain first and shape second, because the domain is the thing
 * that cannot be faked by a name: an address at one of our domains is assigned
 * or bought depending only on whether a person picked the local part, and one
 * from anywhere else is not ours to rank.
 *
 * Domains are not interchangeable, and this used to say they were. The claim
 * was that ranking one above another tells somebody the address they chose is
 * the lesser one — true between two domains that both give names away, and
 * false between one that does and one that does not. A name at a sell-only
 * domain was bought; a name at the free domain may have been handed over. That
 * is a real difference in what somebody did, so it gets a real difference in
 * what they wear.
 */
export function tierOf(
  address: string,
  domains: { named?: string | string[] } = {},
  /**
   * The verified names actually held, written out in full.
   *
   * Given, it decides the top tier outright, and the shape of the local part
   * stops being consulted. That correction matters because a chosen-looking
   * name is not evidence of anything: attaching a lightning address to
   * `dev@getzap.me` makes the extension issue a pay link named `dev`, LNbits
   * answers for it on its own host, and the list gained a `dev@ln.example`
   * wearing a ✓ that nobody bought and no client would honour — while the
   * name that really was bought sat on the other domain.
   *
   * Omitted where there is nothing to check against: ranking a stranger's
   * `lud16` has only the string, and the shape is the best reading available.
   */
  verified?: readonly string[] | null
): NameTier | null {
  const at = address.lastIndexOf('@');
  if (at <= 0) return null;

  const local = address.slice(0, at).toLowerCase();
  const domain = normalizeDomain(address.slice(at + 1));

  const configured = domains.named ?? OUR_DOMAINS;
  const named = (Array.isArray(configured) ? configured : [configured]).map(
    normalizeDomain
  );

  if (!named.includes(domain)) {
    // An address from somewhere else entirely. Real, and not one of our tiers.
    return null;
  }

  /** Bought names split by whether the domain has a free rung at all. */
  const bought: NameTier = isPremiumDomain(domain) ? 'premium' : 'named';

  if (verified) {
    const held = `${local}@${domain}`;
    if (verified.some((entry) => normalizeIdentifier(entry) === held)) {
      return bought;
    }

    /*
     * Not bought here, so not verified — but a name somebody picked is not the
     * free one either. It is the same name the domain has on sale, sitting one
     * purchase away from the ✓.
     */
    return isGeneratedName(local) ? 'assigned' : 'unverified';
  }

  return isGeneratedName(local) ? 'assigned' : bought;
}

/** Lowercased with the domain normalised, so two spellings compare equal. */
function normalizeIdentifier(identifier: string): string {
  const at = identifier.lastIndexOf('@');
  if (at <= 0) return identifier.trim().toLowerCase();

  return `${identifier.slice(0, at).trim().toLowerCase()}@${normalizeDomain(
    identifier.slice(at + 1)
  )}`;
}

export interface TieredAddress {
  address: string;
  tier: NameTier;
  /** The half after the `@`, so a row can say where to go to buy the ✓. */
  domain: string;
}

/**
 * Everything somebody holds, best first.
 *
 * The order is the point. Someone who has bought their way up should see what
 * they paid for at the top of the page rather than hunting for it under the
 * free one they were given on the way in — and someone still on the free tier
 * should see a working address rather than an advert where their address ought
 * to be.
 */
export function rankAddresses(
  addresses: string[],
  domains?: { named?: string | string[] },
  verified?: readonly string[] | null
): TieredAddress[] {
  const seen = new Set<string>();
  const ranked: TieredAddress[] = [];

  for (const address of addresses) {
    const clean = address.trim().toLowerCase();
    if (!clean || seen.has(clean)) continue;

    const tier = tierOf(clean, domains, verified);
    if (!tier) continue;

    seen.add(clean);
    ranked.push({
      address: clean,
      tier,
      domain: normalizeDomain(clean.slice(clean.lastIndexOf('@') + 1)),
    });
  }

  return ranked.sort((a, b) => tierRank(b.tier) - tierRank(a.tier));
}

/**
 * The one to lead with, and to use unless told otherwise.
 *
 * A choice, not a rule: `chosen` wins whenever it is still held, so somebody
 * who deliberately points zaps at their free address keeps that decision
 * across visits instead of having the ranking quietly overrule them.
 */
export function leadAddress(
  addresses: string[],
  chosen?: string | null,
  domains?: { named?: string | string[] },
  verified?: readonly string[] | null
): TieredAddress | null {
  const ranked = rankAddresses(addresses, domains, verified);
  if (!ranked.length) return null;

  const picked = chosen?.trim().toLowerCase();
  return ranked.find((entry) => entry.address === picked) ?? ranked[0];
}

/**
 * Whether there is anything above what they hold to sell them.
 *
 * Not the next rung up the order, because one of the rungs is not for sale:
 * "not verified" is a state a name is in, not something to be upgraded to, and
 * offering it would advertise the thing somebody already has. Everything below
 * the top therefore points at the top.
 */
export function nextTier(current: NameTier | null): NameTier | null {
  if (current === null) return 'assigned';
  if (current === 'premium') return null;

  /*
   * Everything below the top points at the top, and which rung is the top
   * depends on the deployment. Offering `premium` where no sell-only domain is
   * configured would advertise a name nobody can buy — the mistake the retired
   * `portable` rung made, which is why it is gone.
   */
  const best = hasPremiumDomain() ? 'premium' : 'named';
  return current === best ? null : best;
}

/** Whether this deployment sells names at a domain with no free rung. */
export function hasPremiumDomain(): boolean {
  return OUR_DOMAINS.some(isPremiumDomain);
}

/**
 * Two claims about one person, kept apart.
 *
 * A name and relay admission are bought separately, from different things, and
 * neither implies the other: somebody on the assigned free address can pay the
 * relay toll, and somebody holding a premium name can have skipped it. Folding
 * them into a single rank would answer a question nobody asked and lose the
 * one they did.
 *
 * So this is a pair rather than a tier, and the marks that draw it are two
 * marks. That is the rule the profile header already follows for the NIP-05 ✓
 * and the address tier — one mark doing two jobs tells a reader neither.
 */
export interface UserStanding {
  /** What name they hold, or null when it is nobody's we issue. */
  tier: NameTier | null;
  /**
   * Whether the paid relay accepts their writes.
   *
   * Undefined where it was not asked, which is most of the app — checking
   * costs a request per person and is worth it on a profile, never in a feed.
   * Undefined is not `false`: an unasked question has no answer.
   */
  admitted?: boolean;
}

/**
 * How much somebody has bought, for ordering only.
 *
 * Never for display. A single number cannot say *which* of the two things
 * somebody has, and a badge built from this would show the same mark for a
 * premium name and for a free address with relay admission — which are not the
 * same person and should not look alike.
 */
export function standingRank(standing: UserStanding): number {
  const name = standing.tier ? tierRank(standing.tier) + 1 : 0;
  return name * 2 + (standing.admitted ? 1 : 0);
}

/** What the relay half is called, where there is room to say it. */
export const RELAY_MEMBER: TierCopy = {
  label: 'Paid relay',
  blurb: 'Paid the one-time admission, so this relay takes their writes.',
  mark: 'shield',
};
