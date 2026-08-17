import type { NostrEvent } from '@nostrify/nostrify';
import { parseZapReceipt } from '@/lib/zap';

/**
 * What a creator earned, and where it came from.
 *
 * Everything here is derived from zap receipts the app already validates — so
 * a figure on this page cannot be higher than the figure on the post it came
 * from, and a forged receipt that fails `validateZapReceipt` never reaches
 * this file at all. That matters more here than anywhere else in the app:
 * these are the numbers somebody would put in a pitch.
 *
 * The mockups' Studio also shows memberships, paid unlocks and market sales.
 * Those are not here because there is nothing behind them yet, and a dashboard
 * that invents its own rows is worse than one with fewer.
 */

/** Where a payment came from, read off what the zap request pointed at. */
export type EarningSource = 'note' | 'article' | 'profile';

export interface Earning {
  receiptId: string;
  sats: number;
  senderPubkey: string;
  /** Seconds, from the receipt. */
  at: number;
  source: EarningSource;
  /** The note id or article coordinate, when it was paid for something. */
  target?: string;
}

/**
 * Reads the request inside a receipt to find out what was paid for.
 *
 * NIP-57: a zap on an addressable event carries `a`, a zap on a note carries
 * `e`, and a zap on the person carries neither. Reading only `e` — which is
 * the obvious thing to write — reports every article zap as a profile zap.
 */
export function earningFrom(receipt: NostrEvent): Earning | null {
  const parsed = parseZapReceipt(receipt);

  if (!parsed.amountSats || parsed.amountSats <= 0) return null;
  if (!parsed.senderPubkey) return null;

  const description = receipt.tags.find(([name]) => name === 'description')?.[1];

  let tags: string[][] = [];
  try {
    tags = description
      ? ((JSON.parse(description) as { tags?: string[][] }).tags ?? [])
      : [];
  } catch {
    tags = [];
  }

  const value = (name: string) =>
    tags.find(([tagName]) => tagName === name)?.[1];

  const address = value('a');
  const eventId = value('e');

  return {
    receiptId: receipt.id,
    sats: parsed.amountSats,
    senderPubkey: parsed.senderPubkey,
    at: receipt.created_at,
    source: address ? 'article' : eventId ? 'note' : 'profile',
    target: address ?? eventId,
  };
}

export interface SourceSplit {
  source: EarningSource;
  payments: number;
  sats: number;
  /** Percentage of the period's total, rounded. */
  share: number;
}

export interface TopTarget {
  target: string;
  source: EarningSource;
  payments: number;
  sats: number;
}

export interface StudioSummary {
  sats: number;
  payments: number;
  /** People who paid at least once in the period. */
  zappers: number;
  /** People who paid more than once. */
  repeatZappers: number;
  /** The same window immediately before this one, for comparison. */
  previousSats: number;
  /** Percentage change against that window, or null when it earned nothing. */
  change: number | null;
  bySource: SourceSplit[];
  topTargets: TopTarget[];
}

export const EMPTY_SUMMARY: StudioSummary = {
  sats: 0,
  payments: 0,
  zappers: 0,
  repeatZappers: 0,
  previousSats: 0,
  change: null,
  bySource: [],
  topTargets: [],
};

/** How many rows the "top earning" table holds. */
const TOP_LIMIT = 8;

/**
 * The period's figures, and the one before it for comparison.
 *
 * `change` is null rather than zero when the previous window earned nothing.
 * A first month is not "up 0%" and it is not "up ∞%" either — it is a month
 * with nothing to compare against, and saying so is the honest answer.
 */
export function summarizeStudio(
  earnings: readonly Earning[],
  windowDays: number,
  now = Date.now()
): StudioSummary {
  const nowSeconds = Math.floor(now / 1000);
  const window = windowDays * 86400;
  const since = nowSeconds - window;

  const current = earnings.filter((entry) => entry.at >= since);
  const previous = earnings.filter(
    (entry) => entry.at >= since - window && entry.at < since
  );

  if (!current.length && !previous.length) return EMPTY_SUMMARY;

  const sats = current.reduce((total, entry) => total + entry.sats, 0);
  const previousSats = previous.reduce((total, entry) => total + entry.sats, 0);

  const perZapper = new Map<string, number>();
  for (const entry of current) {
    perZapper.set(
      entry.senderPubkey,
      (perZapper.get(entry.senderPubkey) ?? 0) + 1
    );
  }

  const sources = new Map<EarningSource, { payments: number; sats: number }>();
  for (const entry of current) {
    const held = sources.get(entry.source) ?? { payments: 0, sats: 0 };
    held.payments += 1;
    held.sats += entry.sats;
    sources.set(entry.source, held);
  }

  const targets = new Map<string, TopTarget>();
  for (const entry of current) {
    if (!entry.target) continue;

    const held = targets.get(entry.target) ?? {
      target: entry.target,
      source: entry.source,
      payments: 0,
      sats: 0,
    };
    held.payments += 1;
    held.sats += entry.sats;
    targets.set(entry.target, held);
  }

  return {
    sats,
    payments: current.length,
    zappers: perZapper.size,
    repeatZappers: [...perZapper.values()].filter((count) => count > 1).length,
    previousSats,
    change: previousSats > 0
      ? Math.round(((sats - previousSats) / previousSats) * 100)
      : null,
    bySource: [...sources.entries()]
      .map(([source, held]) => ({
        source,
        payments: held.payments,
        sats: held.sats,
        share: sats > 0 ? Math.round((held.sats / sats) * 100) : 0,
      }))
      .sort((a, b) => b.sats - a.sats),
    topTargets: [...targets.values()]
      .sort((a, b) => b.sats - a.sats)
      .slice(0, TOP_LIMIT),
  };
}

/** What to call a source in a table. */
export function describeSource(source: EarningSource): string {
  if (source === 'note') return 'Zaps on notes';
  if (source === 'article') return 'Zaps on articles';
  return 'Zaps on your profile';
}
