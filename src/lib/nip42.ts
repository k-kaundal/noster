import type { NostrEvent, NostrSigner } from '@nostrify/nostrify';

/**
 * NIP-42, authenticating to a relay.
 *
 * The relay sends a challenge; the client signs a kind 22242 event naming the
 * relay and the challenge, and the relay treats the connection as belonging to
 * that pubkey. Nostrify drives the protocol — `AUTH` frames, the `OK`
 * response, retrying the request afterwards — so all that is needed here is
 * the event, correctly built and correctly gated.
 *
 * The gating is the part that matters. A signed AUTH event tells a relay who
 * you are, and it will do this on any connection where a relay asks. A relay
 * that nobody chose — an indexer added for a profile lookup, a relay named in
 * somebody else's event hint — asking "who are you?" and being answered is a
 * pubkey disclosed to a stranger for a query that did not need it. So the
 * answer is given only to relays the reader put in their own list.
 */

export const AUTH_KIND = 22242;

/** How stale a challenge may be before it is not worth answering. */
const MAX_AGE_SECONDS = 600;

export interface AuthEventInput {
  relayUrl: string;
  challenge: string;
  createdAt?: number;
}

/**
 * The unsigned kind 22242 event.
 *
 * Relays check `created_at` against their own clock within about ten minutes,
 * the challenge against what they sent, and the relay tag against themselves.
 * All three are the caller's responsibility to get right, and getting the
 * relay tag wrong is the quiet one: the event signs and sends, and the relay
 * rejects it as being addressed to somebody else.
 */
export function buildAuthEvent(input: AuthEventInput) {
  return {
    kind: AUTH_KIND,
    content: '',
    created_at: input.createdAt ?? Math.floor(Date.now() / 1000),
    tags: [
      ['relay', input.relayUrl],
      ['challenge', input.challenge],
    ],
  };
}

/**
 * Whether an AUTH event would still be accepted.
 *
 * Used to decide whether to sign at all. A signer behind a hardware device or
 * a bunker can take a while to answer, and a challenge answered too late is a
 * prompt shown to somebody for nothing.
 */
export function isAuthFresh(
  createdAt: number,
  now: number = Math.floor(Date.now() / 1000)
): boolean {
  return Math.abs(now - createdAt) <= MAX_AGE_SECONDS;
}

/**
 * Compares a relay URL to one in the reader's list.
 *
 * Normalised because the same relay is written several ways — a trailing
 * slash, a capitalised host, `wss://` against a bare hostname — and an
 * authorised relay that fails to match is a relay the reader chose being
 * treated as a stranger.
 */
export function sameRelay(a: string, b: string): boolean {
  return normaliseRelay(a) === normaliseRelay(b);
}

export function normaliseRelay(url: string): string {
  const trimmed = url.trim().toLowerCase();
  if (!trimmed) return '';

  try {
    const parsed = new URL(trimmed.includes('://') ? trimmed : `wss://${trimmed}`);
    const path = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.host}${path}`;
  } catch {
    return trimmed.replace(/^wss?:\/\//, '').replace(/\/+$/, '');
  }
}

export interface AuthPolicy {
  /** Relays the reader configured. Nothing else is answered. */
  allowed: string[];
  signer: NostrSigner | null;
}

/**
 * Builds the `auth` callback Nostrify calls when a relay challenges.
 *
 * Returns a function that throws rather than one that returns null, because
 * that is the shape the library expects — a rejected promise means "not
 * authenticating", and the request fails with whatever the relay says about
 * being unauthenticated, which is the honest outcome.
 */
export function createAuthHandler(
  relayUrl: string,
  policy: () => AuthPolicy
): (challenge: string) => Promise<NostrEvent> {
  return async (challenge: string) => {
    const { allowed, signer } = policy();

    if (!signer) {
      throw new Error('Not signed in, so this relay cannot be authenticated to.');
    }

    if (!allowed.some((url) => sameRelay(url, relayUrl))) {
      throw new Error(
        `${relayUrl} asked who you are, but it is not one of your relays — not answering.`
      );
    }

    const draft = buildAuthEvent({ relayUrl, challenge });
    const signed = await signer.signEvent(draft);

    if (!isAuthFresh(signed.created_at)) {
      throw new Error('Took too long to sign; the relay would reject this.');
    }

    return signed;
  };
}

/** The machine-readable prefixes a relay uses to say authentication is the problem. */
export function isAuthRequired(message: string | undefined): boolean {
  return !!message?.startsWith('auth-required:');
}

export function isRestricted(message: string | undefined): boolean {
  return !!message?.startsWith('restricted:');
}

/**
 * The human half of a relay's refusal.
 *
 * Relays put a real explanation after the prefix — "we only accept events from
 * registered users" — and it is more use to a reader than anything this client
 * could invent, so it is shown rather than replaced.
 */
export function explainRefusal(message: string): string {
  const [, rest] = message.split(/^(?:auth-required|restricted):\s*/);
  return (rest ?? message).trim();
}
