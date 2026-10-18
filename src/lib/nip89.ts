import type { NostrEvent } from '@nostrify/nostrify';

/**
 * NIP-89 app handlers.
 *
 * A handler is an addressable event that says "this app can open this kind of
 * thing" — a video client announcing it handles kind 34235, a wiki client
 * announcing it handles kind 30818. The event itself carries no code; it is a
 * signpost. What it points at is a URL template where `<bech32>` is replaced
 * with the NIP-19 identifier of whatever the person wants to open.
 *
 * The recommendation events (kind 31989) are the other half: a person saying
 * "I use this app for this kind." A directory built from recommendations is
 * one built from what people actually run, rather than what developers
 * announced.
 */

/** NIP-89 recommended app handler. */
export const APP_HANDLER_INFO_KIND = 31990;

/** NIP-89 recommendation: a person saying they use this app. */
export const APP_HANDLER_RECOMMENDATION_KIND = 31989;

export interface AppHandler {
  event: NostrEvent;
  /** `31990:<pubkey>:<d>`. */
  address: string;
  identifier: string;
  author: string;
  name: string;
  about?: string;
  picture?: string;
  /** The kinds this app says it can open. */
  kinds: number[];
  /** URL template with `<bech32>` as the placeholder. */
  urlTemplate?: string;
}

export interface AppRecommendation {
  event: NostrEvent;
  author: string;
  /** The handler being recommended, as `kind:pubkey:d`. */
  handlerAddress: string;
  /** The kind it is recommended for. */
  kind: number;
}

const tagValue = (event: NostrEvent, name: string): string | undefined =>
  event.tags.find(([tagName]) => tagName === name)?.[1] || undefined;

function readKinds(event: NostrEvent): number[] {
  return event.tags
    .filter(([name, value]) => name === 'k' && !!value)
    .map(([, value]) => Number(value))
    .filter((kind) => Number.isInteger(kind) && kind >= 0);
}

/** Reads a kind 31990, or null when it is not one worth listing. */
export function parseAppHandler(event: NostrEvent): AppHandler | null {
  if (event.kind !== APP_HANDLER_INFO_KIND) return null;

  const identifier = tagValue(event, 'd');
  const name = tagValue(event, 'name');
  if (!identifier || !name) return null;

  const kinds = readKinds(event);
  if (!kinds.length) return null;

  return {
    event,
    address: `${APP_HANDLER_INFO_KIND}:${event.pubkey}:${identifier}`,
    identifier,
    author: event.pubkey,
    name,
    about: tagValue(event, 'about'),
    picture: tagValue(event, 'picture'),
    kinds,
    urlTemplate: tagValue(event, 'u'),
  };
}

/** Reads a kind 31989, or null when it is not one worth counting. */
export function parseAppRecommendation(
  event: NostrEvent
): AppRecommendation | null {
  if (event.kind !== APP_HANDLER_RECOMMENDATION_KIND) return null;

  const handlerAddress = tagValue(event, 'a');
  const kind = Number(tagValue(event, 'd'));

  if (!handlerAddress || !Number.isInteger(kind) || kind < 0) return null;

  return {
    event,
    author: event.pubkey,
    handlerAddress,
    kind,
  };
}

/** The newest revision of each handler. */
export function newestAppHandlers(events: readonly NostrEvent[]): AppHandler[] {
  const byAddress = new Map<string, AppHandler>();

  for (const event of events) {
    const handler = parseAppHandler(event);
    if (!handler) continue;

    const held = byAddress.get(handler.address);
    if (!held || handler.event.created_at > held.event.created_at) {
      byAddress.set(handler.address, handler);
    }
  }

  return [...byAddress.values()];
}

/** The newest recommendation per author and handler. */
export function newestRecommendations(
  events: readonly NostrEvent[]
): AppRecommendation[] {
  const byKey = new Map<string, AppRecommendation>();

  for (const event of events) {
    const rec = parseAppRecommendation(event);
    if (!rec) continue;

    const key = `${rec.author}:${rec.handlerAddress}:${rec.kind}`;
    const held = byKey.get(key);
    if (!held || rec.event.created_at > held.event.created_at) {
      byKey.set(key, rec);
    }
  }

  return [...byKey.values()];
}

/** Build the URL to open a NIP-19 identifier in a handler. */
export function openInHandler(handler: AppHandler, nip19Id: string): string {
  if (!handler.urlTemplate) return '';
  return handler.urlTemplate.replace('<bech32>', nip19Id);
}
