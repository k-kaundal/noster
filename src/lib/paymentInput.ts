/** What someone pasted into a send box. */
export type PaymentTarget =
  | { kind: 'invoice'; value: string }
  | { kind: 'address'; value: string }
  | { kind: 'lnurl'; value: string }
  | { kind: 'empty' }
  | { kind: 'unknown' };

/** bolt11 prefixes: mainnet, testnet, signet and regtest. */
const INVOICE_PREFIX = /^ln(bc|tb|tbs|bcrt)\d/i;

/**
 * Works out what a pasted string is meant to pay.
 *
 * People paste all four forms into the same box — an invoice from a wallet, an
 * address from a profile, an LNURL from a QR, sometimes wrapped in a
 * `lightning:` URI. Asking them to say which is which is a question the string
 * already answers.
 */
export function parsePaymentTarget(input: string): PaymentTarget {
  // Scanners and wallet links hand over a URI rather than the bare payload
  const trimmed = input
    .trim()
    .replace(/^lightning:/i, '')
    .replace(/^bitcoin:[^?]*\?lightning=/i, '')
    .trim();

  if (!trimmed) return { kind: 'empty' };

  if (INVOICE_PREFIX.test(trimmed)) {
    return { kind: 'invoice', value: trimmed.toLowerCase() };
  }

  if (/^lnurl1[a-z0-9]+$/i.test(trimmed)) {
    return { kind: 'lnurl', value: trimmed.toLowerCase() };
  }

  // A lightning address is an email-shaped name, not any string with an @
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { kind: 'address', value: trimmed.toLowerCase() };
  }

  return { kind: 'unknown' };
}

/**
 * The amount a bolt11 invoice asks for, in sats, or null when it names none.
 *
 * Read from the human-readable part, which encodes the amount before the
 * separator — enough to show what is about to be spent without pulling in a
 * full bolt11 decoder. An amountless invoice is valid and means "any amount",
 * which is why null is a real answer rather than a failure.
 */
export function readInvoiceSats(invoice: string): number | null {
  const match = /^ln(?:bc|tb|tbs|bcrt)((?:\d+[munp]?)?)1/i.exec(invoice.trim());
  if (!match) return null;

  const amount = match[1];
  if (!amount) return null;

  const unit = /[munp]$/i.exec(amount)?.[0]?.toLowerCase();
  const digits = Number(unit ? amount.slice(0, -1) : amount);
  if (!Number.isFinite(digits) || digits <= 0) return null;

  // The amount is in bitcoin, scaled by the unit suffix
  const btc = unit ? digits * MULTIPLIERS[unit] : digits;
  const sats = btc * 100_000_000;

  // Sub-satoshi invoices exist; rounding up avoids showing a payment as free
  return sats < 1 ? Math.ceil(sats) : Math.round(sats);
}

const MULTIPLIERS: Record<string, number> = {
  m: 0.001,
  u: 0.000001,
  n: 0.000000001,
  p: 0.000000000001,
};
