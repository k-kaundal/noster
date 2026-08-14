/**
 * LNURL-pay resolution against public endpoints.
 *
 * The LNbits `/api/v1/payments/lnurl` endpoint resolves and pays in one call,
 * but it needs a wallet admin key, so it only works for people using the
 * NostrFeed wallet. Doing the two LNURL steps directly needs no key at all,
 * which is what lets someone pay with Alby, a NWC wallet, or by scanning a QR
 * from a phone.
 */

/** First step: the pay request describing what the link accepts. */
export interface LnurlPayMetadata {
  callback: string;
  minSendableMsat: number;
  maxSendableMsat: number;
  /** How long a comment the link accepts. Zero means none. */
  commentAllowed: number;
  /** Whether the server *says* it produces NIP-57 zap receipts. */
  allowsNostr: boolean;
  /** The key it signs them with. Without it, nobody can validate one. */
  nostrPubkey?: string;
  /**
   * Whether a zap sent here will actually appear on Nostr.
   *
   * Both halves, as NIP-57 step 1 requires: "If `allowsNostr` exists and it is
   * `true`, **and** if `nostrPubkey` exists and is a valid BIP 340 public key
   * in hex". We were reading only the first, and the two come apart in a very
   * ordinary way — an LNbits pay link with its `zaps` switch on advertises
   * `allowsNostr` immediately, while the receipts are published by a separate
   * extension that has to be installed, enabled and connected to relays. Until
   * it is, the flag is a promise the server never keeps: the invoice is paid,
   * no kind 9735 is ever written, and every count stays at zero — on posts, on
   * articles, on goals — with nothing anywhere saying why.
   *
   * Believing the flag alone meant sending a zap request to a server that
   * could not sign the receipt, and reporting it as a zap that would show up.
   */
  zapCapable: boolean;
  description: string;
}

/** A BIP-340 key, which is what `nostrPubkey` has to be to be usable. */
function isValidNostrPubkey(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
}

/** Pulls the human-readable description out of the LNURL metadata blob. */
export function readMetadataDescription(metadata: unknown): string {
  if (typeof metadata !== 'string') return '';

  try {
    const entries = JSON.parse(metadata) as unknown;
    if (!Array.isArray(entries)) return '';

    // The blob is an array of [mimeType, content] pairs; plain text first
    for (const type of ['text/plain', 'text/long-desc']) {
      const found = entries.find(
        (entry) => Array.isArray(entry) && entry[0] === type
      );
      if (Array.isArray(found) && typeof found[1] === 'string') return found[1];
    }
  } catch {
    // A malformed blob is not worth failing a payment over
  }

  return '';
}

/** Parses an LNURL-pay response into the fields a payer actually needs. */
export function parsePayMetadata(body: unknown): LnurlPayMetadata | null {
  if (!body || typeof body !== 'object') return null;

  const record = body as Record<string, unknown>;
  if (typeof record.callback !== 'string' || !record.callback) return null;

  const min = Number(record.minSendable);
  const max = Number(record.maxSendable);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;

  return {
    callback: record.callback,
    minSendableMsat: min,
    maxSendableMsat: max,
    commentAllowed: Number(record.commentAllowed ?? 0) || 0,
    allowsNostr: record.allowsNostr === true,
    nostrPubkey: isValidNostrPubkey(record.nostrPubkey)
      ? record.nostrPubkey.toLowerCase()
      : undefined,
    zapCapable:
      record.allowsNostr === true && isValidNostrPubkey(record.nostrPubkey),
    description: readMetadataDescription(record.metadata),
  };
}

/**
 * Builds the callback URL for the second LNURL step.
 *
 * The callback may already carry query parameters, so the amount has to be
 * appended rather than assumed to be first — getting this wrong produces a URL
 * with two `?` that the server rejects.
 */
export function buildCallbackUrl(
  callback: string,
  amountMsat: number,
  comment?: string
): string {
  const url = new URL(callback);
  url.searchParams.set('amount', String(Math.round(amountMsat)));
  if (comment) url.searchParams.set('comment', comment);
  return url.toString();
}

/** The error an LNURL endpoint returns, when it returns one. */
export function readLnurlError(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;

  const record = body as Record<string, unknown>;
  if (record.status === 'ERROR') {
    return typeof record.reason === 'string' && record.reason
      ? record.reason
      : 'The payment request was rejected.';
  }
  return null;
}

/** Checks an amount against what the link will accept, in sats. */
export function validateAmount(
  amountSats: number,
  metadata: LnurlPayMetadata
): string | null {
  const msat = amountSats * 1000;

  if (!Number.isFinite(amountSats) || amountSats <= 0) {
    return 'Enter an amount.';
  }
  if (msat < metadata.minSendableMsat) {
    return `Minimum is ${Math.ceil(metadata.minSendableMsat / 1000)} sats.`;
  }
  if (msat > metadata.maxSendableMsat) {
    return `Maximum is ${Math.floor(metadata.maxSendableMsat / 1000)} sats.`;
  }
  return null;
}

/** Fetches the pay request for a link. Public — no key involved. */
export async function fetchPayMetadata(
  lnurlpUrl: string,
  signal?: AbortSignal
): Promise<LnurlPayMetadata> {
  const response = await fetch(lnurlpUrl, { signal });
  const body = await response.json();

  const error = readLnurlError(body);
  if (error) throw new Error(error);

  const parsed = parsePayMetadata(body);
  if (!parsed) throw new Error("That payment link didn't return a valid offer.");

  return parsed;
}

/** Second step: turns an amount into an invoice anyone can pay. */
export async function fetchInvoice(
  metadata: LnurlPayMetadata,
  amountMsat: number,
  comment?: string,
  signal?: AbortSignal
): Promise<string> {
  // Sending a comment a link doesn't accept is rejected outright
  const allowed =
    comment && comment.length <= metadata.commentAllowed ? comment : undefined;

  const response = await fetch(
    buildCallbackUrl(metadata.callback, amountMsat, allowed),
    { signal }
  );
  const body = await response.json();

  const error = readLnurlError(body);
  if (error) throw new Error(error);

  const invoice = (body as Record<string, unknown>)?.pr;
  if (typeof invoice !== 'string' || !invoice) {
    throw new Error("The payment link didn't return an invoice.");
  }

  return invoice;
}
