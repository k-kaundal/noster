import type { NostrEvent } from '@nostrify/nostrify';
import { parseJsonContent } from '@/lib/eventKinds';

/**
 * Events published by machines rather than people.
 *
 * Services, gateways and daemons publish status as kind 1 — a device presence
 * beacon, a build result, a sensor reading — because kind 1 is what every
 * relay carries. The event is well-formed and belongs on the network; it just
 * is not a post, and a timeline that mixes it with posts serves neither.
 *
 * Two things follow from that, and both are handled here rather than by
 * special-casing any one publisher's schema:
 *
 * A beacon usually says how long it is true for. `ts` and `ttl` are the
 * common spelling, and a beacon past its `ttl` is worse than noise — it
 * asserts that a machine is up and running at 46% CPU when that stopped being
 * known minutes ago. This is NIP-40's idea declared inside the payload, so it
 * gets NIP-40's treatment: read it, and say when it has lapsed.
 *
 * And a machine beaconing every ten seconds fills a shared feed by itself.
 */

export interface MachinePayload {
  /** The payload's own name for itself: `type`, `kind` or `event`. */
  type?: string;
  /** The parsed body, for rendering. */
  data: Record<string, unknown>;
  /** When the payload says it was measured, in seconds. */
  measuredAt: number;
  /** Seconds it claims to stay true for, when it says. */
  ttlSeconds?: number;
  /** `measuredAt + ttl`, in seconds. Absent when no ttl was declared. */
  expiresAt?: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads a timestamp that may be in seconds or milliseconds.
 *
 * Both are in use and neither is labelled. Telling them apart by magnitude is
 * safe for any date this side of 2001: a seconds value large enough to be
 * mistaken for milliseconds would be the year 33658.
 */
function toSeconds(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return value > 100_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
}

/**
 * The machine payload on an event, or null if it carries none.
 *
 * A JSON body is the test. It is a broad one — someone can post JSON as a
 * remark about JSON — which is why what this drives is a filter the reader
 * controls and a label on the card, never anything destructive.
 */
export function readMachinePayload(event: NostrEvent): MachinePayload | null {
  const parsed = parseJsonContent(event.content);
  if (!isPlainObject(parsed)) return null;

  const type = [parsed.type, parsed.kind, parsed.event].find(
    (value): value is string => typeof value === 'string'
  );

  /**
   * The payload's own `ts` is preferred over `created_at`: they can differ,
   * and when they do the payload's is when the reading was taken while
   * `created_at` is merely when it got published.
   */
  const measuredAt = toSeconds(parsed.ts) ?? event.created_at;

  const ttlSeconds =
    typeof parsed.ttl === 'number' && Number.isFinite(parsed.ttl) && parsed.ttl > 0
      ? Math.floor(parsed.ttl)
      : undefined;

  return {
    type,
    data: parsed,
    measuredAt,
    ttlSeconds,
    expiresAt: ttlSeconds ? measuredAt + ttlSeconds : undefined,
  };
}

/** Whether an event is a machine payload at all. */
export function isMachineEvent(event: NostrEvent): boolean {
  return readMachinePayload(event) !== null;
}

/**
 * Whether a beacon has outlived what it claimed.
 *
 * Unknown when no ttl was declared — that is not the same as fresh, and
 * returning false for both would let the UI call a year-old reading current.
 */
export function beaconFreshness(
  payload: MachinePayload,
  now: number = Math.floor(Date.now() / 1000)
): 'fresh' | 'stale' | 'unknown' {
  if (payload.expiresAt === undefined) return 'unknown';
  return payload.expiresAt > now ? 'fresh' : 'stale';
}

/**
 * Drops machine payloads from a shared timeline.
 *
 * Only ever applied to aggregate feeds. A machine's own profile page keeps
 * showing them — someone who navigated to a gateway's profile is asking for
 * exactly this, and hiding it there would leave an account that looks empty
 * while publishing constantly.
 */
export function filterMachineEvents<T extends NostrEvent>(
  events: T[],
  show: boolean
): T[] {
  if (show) return events;
  return events.filter((event) => !isMachineEvent(event));
}

/** How long ago a beacon lapsed, or how long it has left. */
export function describeFreshness(
  payload: MachinePayload,
  now: number = Math.floor(Date.now() / 1000)
): string | null {
  if (payload.expiresAt === undefined) return null;

  const delta = payload.expiresAt - now;
  const magnitude = Math.abs(delta);

  const amount =
    magnitude < 60
      ? `${magnitude}s`
      : magnitude < 3600
        ? `${Math.floor(magnitude / 60)}m`
        : magnitude < 86400
          ? `${Math.floor(magnitude / 3600)}h`
          : `${Math.floor(magnitude / 86400)}d`;

  return delta > 0 ? `valid for ${amount}` : `expired ${amount} ago`;
}
