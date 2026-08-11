import type { NostrEvent } from '@nostrify/nostrify';

/**
 * NIP-85: trusted assertions.
 *
 * A web-of-trust score is expensive to compute, so it is computed elsewhere
 * and published as a signed event. Which means every assertion is somebody
 * else's claim about a third party — and anybody can publish one about anyone.
 * A rank of 3 on a stranger's profile is a thing one pubkey said, not a fact
 * about that person.
 *
 * So the trust is not in the assertion, it is in the key that signed it, and
 * that key has to have been named by the reader in their own kind 10040. That
 * is enforced structurally here: nothing reads an assertion without being
 * handed the provider list first, and the query filters by author. A client
 * that fetched assertions by subject alone would show whichever score reached
 * it first, which is an open invitation to publish scores about people.
 */

/** Subject: a pubkey. `d` is the hex key. */
export const USER_ASSERTION = 30382;
/** Subject: a regular event. `d` is the event id. */
export const EVENT_ASSERTION = 30383;
/** Subject: an addressable event. `d` is the `kind:pubkey:identifier`. */
export const ADDRESS_ASSERTION = 30384;
/** Subject: a NIP-73 external identifier. `d` is the `i` tag value. */
export const EXTERNAL_ASSERTION = 30385;

/** The user's declared sources, one per result type. */
export const TRUST_PROVIDERS_KIND = 10040;

export type AssertionKind =
  | typeof USER_ASSERTION
  | typeof EVENT_ASSERTION
  | typeof ADDRESS_ASSERTION
  | typeof EXTERNAL_ASSERTION;

export const ASSERTION_KINDS: AssertionKind[] = [
  USER_ASSERTION,
  EVENT_ASSERTION,
  ADDRESS_ASSERTION,
  EXTERNAL_ASSERTION,
];

type MetricFormat = 'int' | 'rank' | 'timestamp' | 'sats' | 'hour' | 'string';

interface MetricSpec {
  tag: string;
  label: string;
  format: MetricFormat;
  /** True when the tag may appear several times, like `t`. */
  repeatable?: boolean;
}

/**
 * The declared result types, per subject kind.
 *
 * A closed list on purpose. Providers agree these names with clients, and a
 * tag this client does not know is not a metric it can label or scale — a `d`
 * or an `alt` rendered as a statistic would be worse than leaving it out.
 */
export const METRICS: Record<AssertionKind, MetricSpec[]> = {
  [USER_ASSERTION]: [
    { tag: 'rank', label: 'Rank', format: 'rank' },
    { tag: 'followers', label: 'Followers', format: 'int' },
    { tag: 'first_created_at', label: 'First post', format: 'timestamp' },
    { tag: 'post_cnt', label: 'Posts', format: 'int' },
    { tag: 'reply_cnt', label: 'Replies', format: 'int' },
    { tag: 'reactions_cnt', label: 'Reactions', format: 'int' },
    { tag: 'zap_amt_recd', label: 'Zaps received', format: 'sats' },
    { tag: 'zap_amt_sent', label: 'Zaps sent', format: 'sats' },
    { tag: 'zap_cnt_recd', label: 'Zaps received', format: 'int' },
    { tag: 'zap_cnt_sent', label: 'Zaps sent', format: 'int' },
    { tag: 'zap_avg_amt_day_recd', label: 'Avg received / day', format: 'sats' },
    { tag: 'zap_avg_amt_day_sent', label: 'Avg sent / day', format: 'sats' },
    { tag: 'reports_cnt_recd', label: 'Reports received', format: 'int' },
    { tag: 'reports_cnt_sent', label: 'Reports sent', format: 'int' },
    { tag: 't', label: 'Topics', format: 'string', repeatable: true },
    { tag: 'active_hours_start', label: 'Active from', format: 'hour' },
    { tag: 'active_hours_end', label: 'Active until', format: 'hour' },
  ],
  [EVENT_ASSERTION]: [
    { tag: 'rank', label: 'Rank', format: 'rank' },
    { tag: 'comment_cnt', label: 'Comments', format: 'int' },
    { tag: 'quote_cnt', label: 'Quotes', format: 'int' },
    { tag: 'repost_cnt', label: 'Reposts', format: 'int' },
    { tag: 'reaction_cnt', label: 'Reactions', format: 'int' },
    { tag: 'zap_cnt', label: 'Zaps', format: 'int' },
    { tag: 'zap_amount', label: 'Zapped', format: 'sats' },
  ],
  [ADDRESS_ASSERTION]: [
    { tag: 'rank', label: 'Rank', format: 'rank' },
    { tag: 'comment_cnt', label: 'Comments', format: 'int' },
    { tag: 'quote_cnt', label: 'Quotes', format: 'int' },
    { tag: 'repost_cnt', label: 'Reposts', format: 'int' },
    { tag: 'reaction_cnt', label: 'Reactions', format: 'int' },
    { tag: 'zap_cnt', label: 'Zaps', format: 'int' },
    { tag: 'zap_amount', label: 'Zapped', format: 'sats' },
  ],
  [EXTERNAL_ASSERTION]: [
    { tag: 'rank', label: 'Rank', format: 'rank' },
    { tag: 'comment_cnt', label: 'Comments', format: 'int' },
    { tag: 'reaction_cnt', label: 'Reactions', format: 'int' },
  ],
};

export interface MetricValue {
  tag: string;
  label: string;
  format: MetricFormat;
  /** Numeric metrics. Absent for `string` ones. */
  value?: number;
  /** `string` metrics, such as common topics. */
  values?: string[];
}

export interface Assertion {
  kind: AssertionKind;
  /** The `d` tag: whom or what this is about. */
  subject: string;
  /** Who signed it. The only reason to believe any of it. */
  provider: string;
  metrics: MetricValue[];
  createdAt: number;
  event: NostrEvent;
}

/**
 * Reads one metric, rejecting values outside the format's range.
 *
 * A rank is "int, norm 0-100" and an hour is 0-24. A provider sending 900
 * would otherwise be drawn as a bar nine times too long, and a negative count
 * would render as a minus sign next to somebody's follower total. Out of range
 * is dropped rather than clamped: clamping invents a number the provider never
 * published, and the point of the whole NIP is attribution.
 */
function readNumber(raw: string, format: MetricFormat): number | null {
  const value = Number.parseFloat(raw.trim());
  if (!Number.isFinite(value)) return null;

  switch (format) {
    case 'rank':
      return value >= 0 && value <= 100 ? value : null;
    case 'hour':
      return value >= 0 && value <= 24 ? value : null;
    case 'timestamp':
      return value > 0 ? Math.floor(value) : null;
    case 'int':
    case 'sats':
      return value >= 0 ? Math.floor(value) : null;
    default:
      return null;
  }
}

export function parseAssertion(event: NostrEvent): Assertion | null {
  if (!ASSERTION_KINDS.includes(event.kind as AssertionKind)) return null;

  const subject = event.tags.find(([name]) => name === 'd')?.[1]?.trim();
  if (!subject) return null;

  const kind = event.kind as AssertionKind;
  const metrics: MetricValue[] = [];

  for (const spec of METRICS[kind]) {
    const found = event.tags.filter(
      ([name, value]) => name === spec.tag && !!value?.trim()
    );

    if (!found.length) continue;

    if (spec.format === 'string') {
      metrics.push({
        tag: spec.tag,
        label: spec.label,
        format: spec.format,
        values: [...new Set(found.map(([, value]) => value.trim()))],
      });
      continue;
    }

    const value = readNumber(found[0][1], spec.format);
    if (value === null) continue;

    metrics.push({
      tag: spec.tag,
      label: spec.label,
      format: spec.format,
      value,
    });
  }

  if (!metrics.length) return null;

  return {
    kind,
    subject,
    provider: event.pubkey,
    metrics,
    createdAt: event.created_at,
    event,
  };
}

/** A metric written out for a reader. */
export function formatMetric(metric: MetricValue): string {
  if (metric.format === 'string') return (metric.values ?? []).join(', ');
  if (metric.value === undefined) return '';

  switch (metric.format) {
    case 'rank':
      return `${Math.round(metric.value)}/100`;
    case 'timestamp':
      return new Date(metric.value * 1000).toLocaleDateString();
    case 'hour':
      return `${String(Math.round(metric.value)).padStart(2, '0')}:00 UTC`;
    case 'sats':
      return `${metric.value.toLocaleString()} sats`;
    default:
      return metric.value.toLocaleString();
  }
}

export interface TrustProvider {
  /** `30382:rank` — which result type this key is trusted for. */
  selector: string;
  kind: AssertionKind;
  tag: string;
  /** The service key. Assertions are only read from this pubkey. */
  pubkey: string;
  relay?: string;
  /** True when it came from the encrypted half of the kind 10040. */
  isPrivate: boolean;
}

const SELECTOR = /^(\d+):([a-z0-9_]+)$/i;

function parseProviderTag(
  tag: string[],
  isPrivate: boolean
): TrustProvider | null {
  const [selector, pubkey, relay] = tag;

  const match = SELECTOR.exec(selector?.trim() ?? '');
  if (!match) return null;

  const kind = Number.parseInt(match[1], 10) as AssertionKind;
  if (!ASSERTION_KINDS.includes(kind)) return null;

  const key = pubkey?.trim().toLowerCase();
  if (!key || !/^[0-9a-f]{64}$/.test(key)) return null;

  return {
    selector: `${kind}:${match[2].toLowerCase()}`,
    kind,
    tag: match[2].toLowerCase(),
    pubkey: key,
    relay: relay?.trim() || undefined,
    isPrivate,
  };
}

/**
 * The public half of a kind 10040.
 *
 * The private half lives NIP-44 encrypted in `.content` and needs a signer, so
 * it is decrypted separately — see `parsePrivateProviders`. Both halves mean
 * the same thing; only who else can see them differs.
 */
export function parsePublicProviders(event: NostrEvent): TrustProvider[] {
  if (event.kind !== TRUST_PROVIDERS_KIND) return [];

  return event.tags
    .map((tag) => parseProviderTag(tag, false))
    .filter((entry): entry is TrustProvider => !!entry);
}

/** The decrypted half, given the plaintext of `.content`. */
export function parsePrivateProviders(plaintext: string): TrustProvider[] {
  try {
    const parsed = JSON.parse(plaintext) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((entry): entry is string[] => Array.isArray(entry))
      .map((tag) => parseProviderTag(tag, true))
      .filter((entry): entry is TrustProvider => !!entry);
  } catch {
    return [];
  }
}

export function buildProviderTags(providers: TrustProvider[]): string[][] {
  return providers.map((provider) =>
    provider.relay
      ? [provider.selector, provider.pubkey, provider.relay]
      : [provider.selector, provider.pubkey]
  );
}

/**
 * The providers trusted for one result type.
 *
 * Several are allowed — the spec's own example declares two keys for
 * `30382:rank` — and their order is the order they were declared in, which is
 * the only preference the format expresses.
 */
export function providersFor(
  providers: TrustProvider[],
  kind: AssertionKind,
  tag: string
): TrustProvider[] {
  const selector = `${kind}:${tag.toLowerCase()}`;
  return providers.filter((provider) => provider.selector === selector);
}

/** Every distinct service key trusted for any result of this kind. */
export function keysForKind(
  providers: TrustProvider[],
  kind: AssertionKind
): string[] {
  return [
    ...new Set(
      providers
        .filter((provider) => provider.kind === kind)
        .map((provider) => provider.pubkey)
    ),
  ];
}

/** Relay hints for those keys, so assertions are asked of where they live. */
export function relaysForKind(
  providers: TrustProvider[],
  kind: AssertionKind
): string[] {
  return [
    ...new Set(
      providers
        .filter((provider) => provider.kind === kind && provider.relay)
        .map((provider) => provider.relay!)
        .filter((url) => url.startsWith('wss://') || url.startsWith('ws://'))
    ),
  ];
}

/**
 * Picks the assertion to show for one result type.
 *
 * Restricted to the keys declared for exactly this result type, not merely to
 * keys trusted for something. Providers "MUST use different service keys for
 * distinct algorithms", so a key trusted for a follower count has said nothing
 * about how it computes rank — reading a rank off it would attribute a number
 * to a provider the reader never chose for that purpose.
 */
export function pickAssertion(
  assertions: Assertion[],
  providers: TrustProvider[],
  kind: AssertionKind,
  tag: string
): { assertion: Assertion; metric: MetricValue } | null {
  const trusted = providersFor(providers, kind, tag);

  for (const provider of trusted) {
    const candidates = assertions
      .filter(
        (assertion) =>
          assertion.kind === kind && assertion.provider === provider.pubkey
      )
      // Newest first: providers republish as the numbers change
      .sort((a, b) => b.createdAt - a.createdAt);

    for (const assertion of candidates) {
      const metric = assertion.metrics.find((entry) => entry.tag === tag);
      if (metric) return { assertion, metric };
    }
  }

  return null;
}

/** The `d` value for a subject of each kind. */
export function subjectFor(input: {
  pubkey?: string;
  eventId?: string;
  address?: string;
  identifier?: string;
}): { kind: AssertionKind; subject: string } | null {
  if (input.pubkey) return { kind: USER_ASSERTION, subject: input.pubkey };
  if (input.address) return { kind: ADDRESS_ASSERTION, subject: input.address };
  if (input.eventId) return { kind: EVENT_ASSERTION, subject: input.eventId };
  if (input.identifier) {
    return { kind: EXTERNAL_ASSERTION, subject: input.identifier };
  }

  return null;
}
