/// What someone pasted into a send box — port of the web app's
/// `src/lib/paymentInput.ts`. One box for every form of destination, because
/// the string says which it is.
library;

enum PaymentTargetKind { invoice, address, lnurl, empty, unknown }

class PaymentTarget {
  final PaymentTargetKind kind;

  /// The normalised payload (lowercased, `lightning:`/`bitcoin:` URI stripped).
  final String value;
  const PaymentTarget(this.kind, [this.value = '']);
}

/// bolt11 prefixes: mainnet, testnet, signet and regtest.
final _invoicePrefix = RegExp(r'^ln(bc|tb|tbs|bcrt)\d', caseSensitive: false);

/// Works out what a pasted string is meant to pay.
///
/// People paste all four forms into the same box — an invoice from a wallet,
/// an address from a profile, an LNURL from a QR, sometimes wrapped in a
/// `lightning:` URI. Asking them to say which is which is a question the
/// string already answers.
PaymentTarget parsePaymentTarget(String input) {
  // Scanners and wallet links hand over a URI rather than the bare payload.
  var trimmed = input
      .trim()
      .replaceFirst(RegExp(r'^lightning:', caseSensitive: false), '')
      .replaceFirst(
          RegExp(r'^bitcoin:[^?]*\?lightning=', caseSensitive: false), '')
      .trim();

  if (trimmed.isEmpty) return const PaymentTarget(PaymentTargetKind.empty);

  if (_invoicePrefix.hasMatch(trimmed)) {
    return PaymentTarget(PaymentTargetKind.invoice, trimmed.toLowerCase());
  }

  if (RegExp(r'^lnurl1[a-z0-9]+$', caseSensitive: false).hasMatch(trimmed)) {
    return PaymentTarget(PaymentTargetKind.lnurl, trimmed.toLowerCase());
  }

  // A lightning address is an email-shaped name, not any string with an @.
  if (RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(trimmed)) {
    return PaymentTarget(PaymentTargetKind.address, trimmed.toLowerCase());
  }

  return const PaymentTarget(PaymentTargetKind.unknown);
}

const _multipliers = {'m': 0.001, 'u': 0.000001, 'n': 0.000000001, 'p': 0.000000000001};

/// The amount a bolt11 invoice asks for, in sats, or null when it names none.
///
/// Read from the human-readable part, which encodes the amount before the
/// separator — enough to show what is about to be spent without a full
/// bolt11 decoder. An amountless invoice is valid and means "any amount",
/// which is why null is a real answer rather than a failure.
int? readInvoiceSats(String invoice) {
  final match = RegExp(
    r'^ln(?:bc|tb|tbs|bcrt)((?:\d+[munp]?)?)1',
    caseSensitive: false,
  ).firstMatch(invoice.trim());
  if (match == null) return null;

  final amount = match.group(1) ?? '';
  if (amount.isEmpty) return null;

  final unitMatch = RegExp(r'[munp]$', caseSensitive: false).firstMatch(amount);
  final unit = unitMatch?.group(0)?.toLowerCase();
  final digits = num.tryParse(unit != null ? amount.substring(0, amount.length - 1) : amount);
  if (digits == null || digits <= 0) return null;

  // The amount is in bitcoin, scaled by the unit suffix.
  final btc = unit != null ? digits * _multipliers[unit]! : digits;
  final sats = btc * 100000000;

  // Sub-satoshi invoices exist; rounding up avoids showing a payment as free.
  return sats < 1 ? sats.ceil() : sats.round();
}
