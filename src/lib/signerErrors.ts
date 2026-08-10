import { isReadOnlyError, type SignerMethod } from './session';

/**
 * Turning a failed signature into something worth reading.
 *
 * Signing is the one step in this app that happens somewhere the app cannot
 * see: in an extension, on a phone across a relay, or nowhere at all in a
 * read-only session. When it fails, what comes back is whatever that other
 * place decided to say — `AbortError`, `undefined`, `{}`, "user rejected" —
 * and every one of those had been surfaced verbatim, which told people their
 * post failed without telling them the one thing they could do about it.
 *
 * The recovery differs per cause and is the part that matters, so the cause is
 * classified rather than the message reformatted.
 */
export type SignerFailure =
  | 'read-only'
  | 'declined'
  | 'unreachable'
  | 'missing-extension'
  | 'unknown';

export interface SignerProblem {
  kind: SignerFailure;
  title: string;
  description: string;
  /** Whether trying again without changing anything could plausibly work. */
  retryable: boolean;
}

/** What the signer said, in whatever shape it said it. */
function messageOf(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return `${error.name}: ${error.message}`;

  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }

  return '';
}

export function classifySignerError(error: unknown): SignerFailure {
  if (isReadOnlyError(error)) return 'read-only';

  const text = messageOf(error);

  // Wallets and signers phrase refusal a dozen ways; all of them mean the
  // person said no, which is not an error to apologise for
  if (/reject|denied|declined|cancel|refus/i.test(text)) return 'declined';

  if (/no (nostr )?extension|window\.nostr|not installed|nip-?07/i.test(text)) {
    return 'missing-extension';
  }

  /**
   * A remote signer that has gone away looks exactly like one that is slow.
   *
   * NIP-46 has no liveness signal — a request is published to a relay and an
   * answer may or may not come back — so a timeout is the only evidence there
   * is, and treating it as "reconnect" is right far more often than treating
   * it as "try again".
   */
  if (/abort|timeout|timed out|signal|disconnect|closed|network/i.test(text)) {
    return 'unreachable';
  }

  return 'unknown';
}

export function describeSignerError(
  error: unknown,
  context: { method?: SignerMethod } = {}
): SignerProblem {
  const kind = classifySignerError(error);

  switch (kind) {
    case 'read-only':
      return {
        kind,
        title: "You're browsing read-only",
        description:
          'This session has no key, so it can read but not sign. Log in with your key or extension to do that.',
        retryable: false,
      };

    case 'declined':
      return {
        kind,
        title: 'Signing was declined',
        description:
          'Your signer refused the request. Nothing was published.',
        retryable: true,
      };

    case 'missing-extension':
      return {
        kind,
        title: 'Your extension is not there',
        description:
          'The browser extension that holds your key did not answer. It may be disabled for this site, or removed.',
        retryable: true,
      };

    case 'unreachable':
      return {
        kind,
        title:
          context.method === 'bunker'
            ? 'Your remote signer did not answer'
            : 'Your signer did not answer',
        description:
          context.method === 'bunker'
            ? 'The bunker holding your key is offline or the connection has expired. Reconnect it and try again — nothing was lost.'
            : 'Signing timed out. Nothing was published, so trying again is safe.',
        retryable: true,
      };

    default:
      return {
        kind,
        title: 'Could not sign that',
        description:
          messageOf(error) || 'Your signer failed without saying why.',
        retryable: true,
      };
  }
}
