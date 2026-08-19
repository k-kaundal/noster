/**
 * What a relay says it can do, and what this app does differently because of
 * it.
 *
 * A relay's NIP-11 document is the only place it advertises its features, and
 * the app has been reading exactly one number out of it (NIP-40, for expiring
 * events) while guessing about the rest. Guessing costs real things: a search
 * that asks for `search` on a relay with no full-text index quietly returns the
 * thirty most recent notes, and a follower count that could be one COUNT frame
 * is instead a megabyte of contact lists.
 *
 * Every answer here is three-valued. A relay that never returned a document —
 * common, since many serve it without the CORS headers a browser needs — is
 * *unknown*, not unsupported. Treating unknown as no would disable features
 * against relays that support them perfectly well, which is the failure mode
 * `useExpirySupport` was already careful to avoid.
 */

/** NIP-11 relay information document. Every field is optional by spec. */
export interface RelayInfo {
  name?: string;
  description?: string;
  banner?: string;
  icon?: string;
  pubkey?: string;
  contact?: string;
  software?: string;
  version?: string;
  supported_nips?: number[];
  terms_of_service?: string;
  privacy_policy?: string;
  limitation?: {
    max_message_length?: number;
    max_subscriptions?: number;
    max_limit?: number;
    max_subid_length?: number;
    max_event_tags?: number;
    max_content_length?: number;
    min_pow_difficulty?: number;
    auth_required?: boolean;
    payment_required?: boolean;
    restricted_writes?: boolean;
    created_at_lower_limit?: number;
    created_at_upper_limit?: number;
    default_limit?: number;
  };
  retention?: {
    kinds?: (number | number[])[];
    count?: number;
    time?: number | null;
  }[];
  relay_countries?: string[];
  language_tags?: string[];
  tags?: string[];
  posting_policy?: string;
  payments_url?: string;
  fees?: {
    admission?: { amount: number; unit: string }[];
    subscription?: { amount: number; unit: string; period: number }[];
    publication?: { kinds?: number[]; amount: number; unit: string }[];
  };
}

/** The NIPs this app changes its behaviour for. */
export const NIP = {
  /** Contact lists — how follower counts are found. */
  FOLLOWS: 2,
  DELETION: 9,
  /** Private direct messages, sealed and gift-wrapped. */
  PRIVATE_DM: 17,
  GROUPS: 29,
  /** Expiring events. */
  EXPIRATION: 40,
  AUTH: 42,
  /** COUNT — ask for a number instead of fetching everything. */
  COUNT: 45,
  /** Full-text `search` filters. */
  SEARCH: 50,
  ZAPS: 57,
  RELAY_LIST: 65,
  /** Protected events: only the author may publish them here. */
  PROTECTED: 70,
  /** Negentropy set reconciliation. */
  NEGENTROPY: 77,
} as const;

/**
 * Three-valued, because "the relay did not answer" is not "the relay said no".
 */
export type Support = 'yes' | 'no' | 'unknown';

/**
 * Whether a relay advertises a NIP.
 *
 * `unknown` when there is no document, or a document with no `supported_nips`
 * — the field is optional, and a relay that omits it has not denied anything.
 */
export function nipSupport(
  info: RelayInfo | null | undefined,
  nip: number
): Support {
  const nips = info?.supported_nips;
  if (!Array.isArray(nips) || !nips.length) return 'unknown';
  return nips.includes(nip) ? 'yes' : 'no';
}

/**
 * True only when the relay actually said yes.
 *
 * The right test for anything that *replaces* a working path — asking for a
 * COUNT instead of fetching, say. Guessing wrong there means an empty answer
 * where a slow one would have done.
 */
export function supports(
  info: RelayInfo | null | undefined,
  nip: number
): boolean {
  return nipSupport(info, nip) === 'yes';
}

/**
 * True only when the relay actually said no.
 *
 * The right test for anything that *compensates* — widening a search because
 * there is no index behind it. An unknown relay is left on the normal path.
 */
export function refuses(
  info: RelayInfo | null | undefined,
  nip: number
): boolean {
  return nipSupport(info, nip) === 'no';
}

/**
 * Set across several relays: yes if any relay can, no if all of them said no.
 *
 * Reads are fanned out, so one relay with a full-text index is enough to make
 * search work. One relay refusing proves nothing about the others.
 */
export function anySupports(
  infos: readonly (RelayInfo | null | undefined)[],
  nip: number
): Support {
  if (infos.some((info) => nipSupport(info, nip) === 'yes')) return 'yes';
  if (infos.length && infos.every((info) => nipSupport(info, nip) === 'no')) {
    return 'no';
  }
  return 'unknown';
}

export interface Capability {
  nip: number;
  label: string;
  /** What it means for someone using this app, not what the NIP says. */
  hint: string;
}

/**
 * The capabilities worth showing a person, in the order they matter.
 *
 * Deliberately short. The full `supported_nips` list is already on the relay
 * panel and reads as a row of numbers; this is the handful that change what
 * the app can actually do for you, said in words.
 */
export const CAPABILITIES: Capability[] = [
  {
    nip: NIP.SEARCH,
    label: 'Search',
    hint: 'Full-text search runs on the relay. Without it this app can only search what it has already loaded.',
  },
  {
    nip: NIP.COUNT,
    label: 'Counts',
    hint: 'The relay can answer "how many" directly, so follower counts are exact and cost one message instead of thousands of events.',
  },
  {
    nip: NIP.AUTH,
    label: 'Sign-in',
    hint: 'The relay can ask you to prove who you are, which is how private messages and members-only relays work.',
  },
  {
    nip: NIP.NEGENTROPY,
    label: 'Fast sync',
    hint: 'The relay can work out what you are missing without resending what you already have.',
  },
  {
    nip: NIP.PROTECTED,
    label: 'Protected posts',
    hint: 'The relay refuses events published by anyone but their author, so nobody can rebroadcast your posts here.',
  },
  {
    nip: NIP.PRIVATE_DM,
    label: 'Private messages',
    hint: 'The relay carries sealed, gift-wrapped direct messages.',
  },
  {
    nip: NIP.EXPIRATION,
    label: 'Expiring posts',
    hint: 'The relay deletes events once their expiry passes.',
  },
  {
    nip: NIP.GROUPS,
    label: 'Groups',
    hint: 'The relay hosts managed groups with their own membership and moderation.',
  },
];

/**
 * The capabilities a relay advertises, paired with the answer it gave.
 *
 * Returns nothing at all when the relay published no NIP list — a row of
 * "unknown" chips tells a reader less than no row does.
 */
export function relayCapabilities(
  info: RelayInfo | null | undefined
): { capability: Capability; support: Support }[] {
  if (!info?.supported_nips?.length) return [];

  return CAPABILITIES.map((capability) => ({
    capability,
    support: nipSupport(info, capability.nip),
  }));
}
