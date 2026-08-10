import { nip19 } from 'nostr-tools';
import type { NostrEvent, NostrSigner } from '@nostrify/nostrify';

/**
 * Who is signed in, at the level the rest of the app cares about.
 *
 * Nostrify's `NUser` is one shape this can take, but not the only one: a
 * read-only session has a pubkey and no ability to sign, and there is nothing
 * in the login store that can represent that. Typing the app against what it
 * actually uses — a key and a signer — means such a session can exist without
 * pretending to be a login it is not.
 */
export type SignerMethod = 'nsec' | 'extension' | 'bunker' | 'read-only';

/**
 * Narrows a login store's `type` to a method we know how to talk about.
 *
 * The login store's union is the library's to grow, and a type we have never
 * heard of should produce no claim about where the key lives rather than a
 * confident wrong one.
 */
export function signerMethod(type: string): SignerMethod | undefined {
  return type === 'nsec' || type === 'extension' || type === 'bunker'
    ? type
    : undefined;
}

export interface SessionUser {
  pubkey: string;
  signer: NostrSigner;
  /**
   * Where the key lives.
   *
   * Worth carrying because the failure modes are not the same: an extension
   * can be disabled, a bunker can go offline, an nsec in the browser can do
   * neither. What to tell someone when signing fails depends on this.
   */
  method: SignerMethod;
  /** Set when this session cannot sign, so nothing offers to. */
  readOnly?: boolean;
}

/**
 * Thrown when something tries to sign in a read-only session.
 *
 * A distinct type rather than a message, because the recovery is specific —
 * log in with the key — and a caller matching on wording would break the first
 * time the wording improved.
 */
export class ReadOnlyError extends Error {
  constructor() {
    super('This is a read-only session. Log in with your key to do that.');
    this.name = 'ReadOnlyError';
  }
}

export function isReadOnlyError(error: unknown): error is ReadOnlyError {
  return error instanceof ReadOnlyError;
}

/**
 * A signer that knows who you are and refuses to act as you.
 *
 * The alternative — no signer at all — would mean every call site checking for
 * one, and the ones that forgot would throw `undefined is not an object`
 * somewhere unrelated. Failing loudly at the moment of signing, with a reason,
 * is the failure that can be explained to the person in front of it.
 */
export class ReadOnlySigner implements NostrSigner {
  constructor(private readonly pubkey: string) {}

  getPublicKey(): Promise<string> {
    return Promise.resolve(this.pubkey);
  }

  signEvent(): Promise<NostrEvent> {
    return Promise.reject(new ReadOnlyError());
  }
}

/**
 * The public key behind whatever someone pasted to browse as.
 *
 * `npub` is what people copy from a profile, `nprofile` is what they copy from
 * some clients' share buttons, and raw hex is what appears in relay logs and
 * developer tools. All three name the same thing, so all three are accepted.
 *
 * An `nsec` is refused rather than accepted, even though it would technically
 * identify the same person: someone pasting a secret key into a box labelled
 * "browse as" has misunderstood the box, and quietly taking it would teach
 * them that pasting secrets into unlabelled fields works out.
 */
export function decodeViewerKey(input: string): string {
  const value = input.trim().replace(/^nostr:/, '');

  if (!value) throw new Error('Paste an npub to browse as.');

  if (/^[0-9a-f]{64}$/i.test(value)) return value.toLowerCase();

  let decoded: nip19.DecodeResult;
  try {
    decoded = nip19.decode(value);
  } catch {
    throw new Error("That doesn't look like an npub.");
  }

  switch (decoded.type) {
    case 'npub':
      return decoded.data;
    case 'nprofile':
      return decoded.data.pubkey;
    case 'nsec':
      throw new Error(
        'That is a secret key. Use the Key tab to log in with it properly.'
      );
    default:
      throw new Error('That is a Nostr link, but not to a person.');
  }
}
