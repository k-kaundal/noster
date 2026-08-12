import { nip19 } from 'nostr-tools';

/**
 * Reading a NIP-46 `bunker://` URI before trying to connect with it.
 *
 * The protocol itself lives in the signer library; this is the check in front
 * of it, and it earns its place because of how the failure looks without one.
 * A malformed URI is indistinguishable from a signer that is switched off: the
 * client publishes a connect request to nowhere, waits for a reply that cannot
 * come, and eventually says "that bunker did not answer" — blaming the signer
 * for a typo, thirty seconds after the paste, with nothing to act on.
 *
 * Every problem below is knowable the instant the text lands in the box.
 */

export interface BunkerUri {
  /**
   * The signer's own key, which is **not** necessarily the user's.
   *
   * NIP-46 is explicit that clients must keep these apart: the remote signer
   * may hold many identities, and the pubkey in this URI addresses the signer,
   * not the account. The user's key is whatever `get_public_key` answers after
   * connecting, and nothing here should be shown as "your account".
   */
  remoteSignerPubkey: string;
  /** Where to talk. At least one, or the request goes nowhere. */
  relays: string[];
  /**
   * Single-use, per the spec: "Optional secret can be used for single
   * successfully established connection only".
   */
  secret?: string;
}

export type BunkerProblem =
  | 'empty'
  | 'not-bunker'
  | 'is-nostrconnect'
  | 'bad-pubkey'
  | 'npub-pubkey'
  | 'no-relay'
  | 'bad-relay';

export interface BunkerParse {
  uri?: BunkerUri;
  problem?: BunkerProblem;
}

/** What to tell somebody, for each way the URI can be wrong. */
export function describeProblem(problem: BunkerProblem): string {
  switch (problem) {
    case 'empty':
      return 'Paste the bunker URI from your signer app.';
    case 'is-nostrconnect':
      /**
       * The other direction of the same protocol. Worth naming precisely,
       * because somebody holding one of these has done something reasonable
       * and is not going to guess that the arrow points the other way.
       */
      return 'That is a nostrconnect:// string, which the signer scans from the app rather than the other way round. Your signer app can give you a bunker:// URI instead.';
    case 'not-bunker':
      return 'A bunker URI starts with bunker://';
    case 'npub-pubkey':
      return 'That URI names an npub. A bunker URI carries the raw hex key — your signer app should produce one that does.';
    case 'bad-pubkey':
      return "The key in that URI isn't a valid 64-character public key. Copy it again from your signer.";
    case 'no-relay':
      return 'That URI names no relay, so there is nowhere to reach the signer. Copy the whole thing, including everything after the ?';
    case 'bad-relay':
      return 'The relay in that URI is not a websocket address. It should start with wss://';
  }
}

const HEX_64 = /^[0-9a-f]{64}$/i;

/**
 * Parses a bunker URI, or says exactly what is wrong with it.
 *
 * The authority is read by hand rather than through `new URL()`. A
 * `bunker://` URL is not a hierarchical scheme any browser knows, and
 * `URL.hostname` lowercases and mangles what it finds there — which for a hex
 * key is survivable and for the error messages above is not, since a mangled
 * value cannot be told apart from a wrong one.
 */
export function parseBunkerUri(input: string): BunkerParse {
  const value = input.trim();

  if (!value) return { problem: 'empty' };
  if (value.startsWith('nostrconnect://')) return { problem: 'is-nostrconnect' };
  if (!value.startsWith('bunker://')) return { problem: 'not-bunker' };

  const rest = value.slice('bunker://'.length);
  const queryAt = rest.indexOf('?');

  const authority = (queryAt === -1 ? rest : rest.slice(0, queryAt)).trim();
  const query = queryAt === -1 ? '' : rest.slice(queryAt + 1);

  if (!HEX_64.test(authority)) {
    /**
     * Told apart because the fix is different. An npub is the right key in
     * the wrong encoding — the person has the correct thing in front of them
     * — whereas anything else means they copied the wrong string.
     */
    if (/^npub1/i.test(authority)) {
      try {
        nip19.decode(authority);
        return { problem: 'npub-pubkey' };
      } catch {
        return { problem: 'bad-pubkey' };
      }
    }

    return { problem: 'bad-pubkey' };
  }

  const params = new URLSearchParams(query);
  const relays = params.getAll('relay').map((relay) => relay.trim()).filter(Boolean);

  if (!relays.length) return { problem: 'no-relay' };

  if (relays.some((relay) => !/^wss?:\/\//i.test(relay))) {
    return { problem: 'bad-relay' };
  }

  return {
    uri: {
      remoteSignerPubkey: authority.toLowerCase(),
      relays,
      secret: params.get('secret')?.trim() || undefined,
    },
  };
}

/** Whether a pasted string is a usable bunker URI. */
export function isBunkerUri(input: string): boolean {
  return !!parseBunkerUri(input).uri;
}

/**
 * What to say when a connection attempt times out.
 *
 * The URI parsed, so this is not a typo — which leaves a short list of real
 * causes, and the single-use secret is the one people hit and never guess.
 * A URI that worked once and is being pasted a second time is spent: the spec
 * has the signer ignore repeat attempts with an old secret, and from the
 * client's side that is indistinguishable from silence.
 */
export function describeTimeout(uri: BunkerUri): string {
  const relays = uri.relays.map((relay) => relay.replace(/^wss?:\/\//, '')).join(', ');

  if (uri.secret) {
    return `No answer over ${relays}. If this URI has been used before, its secret is spent — signers accept it once. Generate a fresh one in your signer app.`;
  }

  return `No answer over ${relays}. Check the signer app is open and connected to that relay.`;
}
