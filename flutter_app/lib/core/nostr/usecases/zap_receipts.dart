import 'dart:convert';

import 'package:bip340/bip340.dart' as bip340;

import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/nostr/kinds.dart';

/// NIP-57 zap receipt.
const zapReceiptKind = NostrKinds.zapReceipt;

/// NIP-57 zap *request* (the signed ask embedded in the receipt's
/// `description` tag).
const zapRequestKind = NostrKinds.zapRequest;

/// Who actually sent the zap + how much + on what.
///
/// Port of the web's `lib/zap.ts`. The receipt's own `pubkey` is the
/// recipient's LNURL server (it signs on the sender's behalf), so attribution
/// comes from the embedded zap *request*, never the receipt author.
class ParsedZap {
  final String? senderPubkey;
  final int? amountSats;
  final String comment;
  final String? targetEventId;
  final String? recipientPubkey;

  /// The invoice that was settled, verbatim — ties a receipt to a row in a
  /// wallet's own ledger (stops one payment being announced twice).
  final String? bolt11;

  const ParsedZap({
    this.senderPubkey,
    this.amountSats,
    this.comment = '',
    this.targetEventId,
    this.recipientPubkey,
    this.bolt11,
  });
}

String? _tagValue(NostrEvent event, String name) {
  for (final t in event.tags) {
    if (t.isNotEmpty && t[0] == name && t.length > 1) return t[1];
  }
  return null;
}

/// Reads the kind-9734 zap request embedded in a receipt's `description` tag.
NostrEvent? _parseZapRequest(NostrEvent event) {
  final description = _tagValue(event, 'description');
  if (description == null || description.isEmpty) return null;
  try {
    final map = jsonDecode(description);
    if (map is! Map<String, dynamic>) return null;
    if (map['pubkey'] is! String || map['tags'] is! List) return null;
    return NostrEvent.fromJson(map);
  } catch (_) {
    return null;
  }
}

/// Satoshis from a bolt11 invoice, or null when unreadable.
///
/// bolt11 encodes the amount in the human-readable part before the `1`
/// separator: `lnbc<digits><unit>1…`, unit m/u/n/p scaling BTC. Amountless
/// invoices (valid, "any amount") read as null — an unknown, not a mismatch.
int? satsFromBolt11(String invoice) {
  final match = RegExp(
    r'^ln(?:bc|tb|tbs|bcrt)((?:\d+[munp]?)?)1',
    caseSensitive: false,
  ).firstMatch(invoice.trim());
  if (match == null) return null;
  final amount = match.group(1) ?? '';
  if (amount.isEmpty) return null;

  const mult = {'m': 0.001, 'u': 0.000001, 'n': 0.000000001, 'p': 0.000000000001};
  final unitMatch =
      RegExp(r'[munp]$', caseSensitive: false).firstMatch(amount);
  final unit = unitMatch?.group(0)?.toLowerCase();
  final digits = num.tryParse(
      unit != null ? amount.substring(0, amount.length - 1) : amount);
  if (digits == null || digits <= 0) return null;

  final btc = unit != null ? digits * mult[unit]! : digits;
  final sats = btc * 100000000;
  return sats < 1 ? sats.ceil() : sats.round();
}

/// Pulls the human-facing details out of a zap receipt.
///
/// Amount comes from the invoice first — that is the number actually paid;
/// the request's `amount` tag is only what was asked for and the two can
/// disagree.
ParsedZap parseZapReceipt(NostrEvent event) {
  final request = _parseZapRequest(event);

  String? requestTag(String name) {
    if (request == null) return null;
    return _tagValue(request, name);
  }

  int? amountSats;
  final bolt11 = _tagValue(event, 'bolt11');
  if (bolt11 != null) amountSats = satsFromBolt11(bolt11);
  amountSats ??= () {
    final millisats = num.tryParse(
        requestTag('amount') ?? _tagValue(event, 'amount') ?? '');
    return (millisats != null && millisats > 0)
        ? (millisats / 1000).round()
        : null;
  }();

  return ParsedZap(
    // The uppercase P tag is the fast path; the embedded request is definitive.
    senderPubkey: request?.pubkey ?? _tagValue(event, 'P'),
    amountSats: amountSats,
    comment: request?.content.trim() ?? '',
    targetEventId: requestTag('e') ?? _tagValue(event, 'e'),
    recipientPubkey: requestTag('p') ?? _tagValue(event, 'p'),
    bolt11: bolt11,
  );
}

/// Why a receipt was not counted (named, never silent — a zap that does not
/// appear is a payment somebody made and cannot find).
enum ReceiptRejection {
  notAReceipt,
  wrongProvider,
  missingBolt11,
  missingDescription,
  unreadableRequest,
  badRequestSignature,
  amountMismatch,
  wrongRecipient,
  wrongTarget,
}

/// The checks a receipt must pass, per the caller.
class ReceiptCheck {
  /// Who the payment must name (any of these). A NIP-75 goal may redirect
  /// money to beneficiaries, so several are allowed.
  final List<String>? recipientPubkey;

  /// The event it claims to be about (any of these). A goal announced by a
  /// note is funded by zaps naming either.
  final List<String>? eventId;

  /// The coordinate, when zapping an addressable event (any of these).
  final List<String>? address;

  /// Only zaps on the person themselves (a profile zap carries `p` and no
  /// `e`/`a` — recognised by what it lacks).
  final bool profileOnly;

  /// The `nostrPubkey` from the recipient's lnurl provider — the ONLY check
  /// that actually prevents forgery (a receipt is signed by the recipient's
  /// lightning server; any other key is making it up). Optional because it
  /// costs a request; applied whenever known.
  final List<String>? providerPubkey;

  const ReceiptCheck({
    this.recipientPubkey,
    this.eventId,
    this.address,
    this.profileOnly = false,
    this.providerPubkey,
  });
}

/// Whether a zap receipt should be believed.
bool validateZapReceipt(NostrEvent event, [ReceiptCheck check = const ReceiptCheck()]) =>
    explainZapReceipt(event, check) == null;

/// The failing check, or null when a receipt should be counted.
///
/// Port of the web's `explainZapReceipt`. Without these checks a kind 9735
/// naming any note and any amount is counted — so a stranger can make a post
/// appear to have earned millions of sats.
ReceiptRejection? explainZapReceipt(
  NostrEvent event, [
  ReceiptCheck check = const ReceiptCheck(),
]) {
  if (event.kind != zapReceiptKind) return ReceiptRejection.notAReceipt;

  // The one check that actually prevents forgery: the receipt's pubkey MUST
  // be the recipient's lnurl provider's nostrPubkey.
  final providers = check.providerPubkey;
  if (providers != null && providers.isNotEmpty) {
    if (!providers.contains(event.pubkey)) {
      return ReceiptRejection.wrongProvider;
    }
  }

  final bolt11 = _tagValue(event, 'bolt11');
  final description = _tagValue(event, 'description');
  if (bolt11 == null || bolt11.isEmpty) {
    return ReceiptRejection.missingBolt11;
  }
  if (description == null || description.isEmpty) {
    return ReceiptRejection.missingDescription;
  }

  final request = _parseZapRequest(event);
  if (request == null || request.kind != zapRequestKind) {
    return ReceiptRejection.unreadableRequest;
  }

  // The request inside the description is signed by the sender — that
  // signature is what attributes the zap to them. bip340.verify throws on
  // malformed input; treat that as a bad signature, not a crash.
  bool requestSigned;
  try {
    final id = NostrEvent.computeId(
      request.pubkey,
      request.createdAt,
      request.kind,
      request.tags,
      request.content,
    );
    requestSigned = bip340.verify(request.pubkey, id, request.sig);
  } catch (_) {
    requestSigned = false;
  }
  if (!requestSigned) return ReceiptRejection.badRequestSignature;

  String? requestTag(String name) => _tagValue(request, name);

  // The invoice amount MUST equal the request's amount tag (if present) —
  // otherwise a receipt can advertise a large amount while its invoice was
  // for a handful of sats.
  final claimed = num.tryParse(requestTag('amount') ?? '');
  if (claimed != null && claimed > 0) {
    final invoiceSats = satsFromBolt11(bolt11);
    // Only when the invoice actually states an amount. Plenty of real zaps
    // are paid against an amountless invoice — unreadable is unknown, not a
    // mismatch.
    if (invoiceSats != null && (claimed / 1000).round() != invoiceSats) {
      return ReceiptRejection.amountMismatch;
    }
  }

  bool requestHas(String name, List<String> wanted) {
    return request.tags.any(
      (t) => t.isNotEmpty && t[0] == name && t.length > 1 && wanted.contains(t[1]),
    );
  }

  final recipients = check.recipientPubkey;
  if (recipients != null &&
      recipients.isNotEmpty &&
      !requestHas('p', recipients)) {
    return ReceiptRejection.wrongRecipient;
  }

  if (check.profileOnly) {
    // Anything pointing at a note or an article is a zap on that, not on them.
    if (request.tags.any((t) => t.isNotEmpty && (t[0] == 'e' || t[0] == 'a'))) {
      return ReceiptRejection.wrongTarget;
    }
  } else if (check.address != null && check.address!.isNotEmpty) {
    if (!requestHas('a', check.address!)) return ReceiptRejection.wrongTarget;
  } else if (check.eventId != null && check.eventId!.isNotEmpty) {
    if (!requestHas('e', check.eventId!)) return ReceiptRejection.wrongTarget;
  }

  return null;
}

/// One validated zap: who sent it, how much, the message, when.
class Zapper {
  final String receiptId;
  final String pubkey;
  final int sats;
  final String comment;
  final int at;
  const Zapper({
    required this.receiptId,
    required this.pubkey,
    required this.sats,
    this.comment = '',
    required this.at,
  });
}

/// What survived checking on a set of receipts.
class ZapSummaryResult {
  final int totalSats;

  /// Distinct receipts, not distinct people (two zaps from one person are two).
  final int count;

  /// Largest first.
  final List<Zapper> zappers;

  /// Counted, but signed by an unexpected provider key (usually a key
  /// rotation or a provider learned from a different pay link — flagged, not
  /// dropped, unless the caller said `require`).
  final int unverified;

  /// Receipts that arrived and were not counted, with the check each failed.
  final List<({String id, ReceiptRejection reason})> rejected;

  /// Distinct receipts that reached us at all, before any judgement (the
  /// denominator — separates "refused" from "never got it").
  final int received;

  const ZapSummaryResult({
    required this.totalSats,
    required this.count,
    required this.zappers,
    required this.unverified,
    required this.rejected,
    required this.received,
  });

  static const empty = ZapSummaryResult(
    totalSats: 0,
    count: 0,
    zappers: [],
    unverified: 0,
    rejected: [],
    received: 0,
  );
}

/// Adds up the receipts that survive checking, deduplicated on the receipt id
/// (the same receipt arrives from every relay that holds it; counting per
/// copy multiplies the total by however many relays somebody reads from).
ZapSummaryResult summarizeZaps(
  List<NostrEvent> receipts, {
  ReceiptCheck check = const ReceiptCheck(),

  /// `prefer` (default): a provider mismatch is counted but flagged.
  /// `require`: a provider mismatch is refused — for rankings/figures a
  /// forged receipt would actually buy something.
  String providerPolicy = 'prefer',
}) {
  final seen = <String>{};
  final zappers = <Zapper>[];
  final rejected = <({String id, ReceiptRejection reason})>[];
  var totalSats = 0;
  var unverified = 0;

  for (final receipt in receipts) {
    if (!seen.add(receipt.id)) continue;

    final rejection = explainZapReceipt(receipt, check);
    if (rejection != null) {
      // A provider mismatch is a doubt, not a disproof — the provider key is
      // remembered from earlier payments and is missing/stale for much of the
      // network, so on its own it must not delete a payment from the screen.
      if (rejection == ReceiptRejection.wrongProvider &&
          providerPolicy != 'require') {
        unverified += 1;
      } else {
        rejected.add((id: receipt.id, reason: rejection));
        continue;
      }
    }

    final parsed = parseZapReceipt(receipt);
    final sats = parsed.amountSats;
    final sender = parsed.senderPubkey;
    if (sats == null || sats <= 0 || sender == null) continue;

    totalSats += sats;
    zappers.add(Zapper(
      receiptId: receipt.id,
      pubkey: sender,
      sats: sats,
      comment: parsed.comment,
      at: receipt.createdAt,
    ));
  }

  zappers.sort((a, b) {
    final bySats = b.sats.compareTo(a.sats);
    return bySats != 0 ? bySats : b.at.compareTo(a.at);
  });

  return ZapSummaryResult(
    totalSats: totalSats,
    count: zappers.length,
    zappers: zappers,
    unverified: unverified,
    rejected: rejected,
    received: seen.length,
  );
}
