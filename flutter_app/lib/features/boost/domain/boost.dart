/// Paid promotion, as public evidence rather than as a private database row.
///
/// Port of the web's `src/lib/boost.ts` — keep the two in lockstep.
///
/// A boost **is a zap to the platform's lightning address**, whose zap
/// request `e`-tags the note being promoted. That gives the whole thing away
/// for free: the receipt is signed by the platform's lnurl provider (NIP-57,
/// unforgeable by the beneficiary), the invoice inside says what was actually
/// paid, the zap request inside is signed by the payer (who bought it is
/// public), and it is an ordinary event on ordinary relays — anyone can list
/// every boost the platform has ever run.
///
/// Honesty rule (docs/monetization.md): a boosted note is boosted **for
/// readers of NostrFeed**. Every other client sees an ordinary zap receipt —
/// marketing copy must never promise "reach on Nostr".
library;

import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/nostr/usecases/zap_receipts.dart';

/// What can be bought.
class BoostTier {
  /// Stable identifier, for pricing config and analytics.
  final String code;
  final String label;

  /// Price in sats (the same number the invoice will ask for).
  final int priceSats;

  /// How long the boost runs, from the RECEIPT's timestamp — the one
  /// timestamp the buyer cannot choose.
  final Duration duration;

  /// How far a boost lifts a note in ranking. Capped deliberately low:
  /// past ~3× a boosted note stops competing with organic content and
  /// starts replacing it, at which point the feed is an ad break.
  final double multiplier;

  const BoostTier({
    required this.code,
    required this.label,
    required this.priceSats,
    required this.duration,
    required this.multiplier,
  });
}

/// The tier menu, cheapest first — mirrors the web's `BOOST_TIERS`.
const boostTiers = <BoostTier>[
  BoostTier(
    code: 'starter',
    label: 'Starter',
    priceSats: 1000,
    duration: Duration(days: 1),
    multiplier: 1.5,
  ),
  BoostTier(
    code: 'growth',
    label: 'Growth',
    priceSats: 5000,
    duration: Duration(days: 1),
    multiplier: 2,
  ),
  BoostTier(
    code: 'pro',
    label: 'Pro',
    priceSats: 10000,
    duration: Duration(days: 2),
    multiplier: 3,
  ),
  BoostTier(
    code: 'campaign',
    label: 'Campaign',
    priceSats: 50000,
    duration: Duration(days: 7),
    multiplier: 3,
  ),
];

/// The cheapest thing on the menu — below this, nothing is bought.
const minBoostSats = 1000;

/// The strongest lift any amount can buy, however much is paid.
const maxMultiplier = 3.0;

/// What a given payment buys: the largest tier the amount covers, so
/// overpaying is never punished and underpaying by a sat does not silently
/// buy the tier above. Paying more than the top tier buys the top tier —
/// the cap is the point.
BoostTier? tierForAmount(int sats) {
  BoostTier? found;
  for (final tier in boostTiers) {
    if (sats >= tier.priceSats) found = tier;
  }
  return found;
}

/// One boost in force, read from a zap receipt.
class Boost {
  /// The receipt this was read from, so a boost can be pointed at.
  final String receiptId;

  /// The note being promoted.
  final String noteId;

  /// Who paid — public, and shown.
  final String payerPubkey;
  final int amountSats;
  final BoostTier tier;

  /// Seconds since epoch (like every Nostr timestamp) — from the receipt,
  /// which the platform signs and the buyer cannot backdate.
  final int startedAt;
  final int expiresAt;

  const Boost({
    required this.receiptId,
    required this.noteId,
    required this.payerPubkey,
    required this.amountSats,
    required this.tier,
    required this.startedAt,
    required this.expiresAt,
  });
}

/// The platform key the payment must have been addressed to, and the
/// `nostrPubkey` of the platform's lnurl provider — the check that makes a
/// boost unforgeable. Without the provider check, any zap receipt anywhere
/// becomes a boost and promotion is free for anybody who ever zapped anyone.
class BoostSource {
  final String platformPubkey;
  final String providerPubkey;

  const BoostSource({
    required this.platformPubkey,
    required this.providerPubkey,
  });
}

/// Reads a zap receipt as a boost, or refuses to.
///
/// Every refusal here is somebody getting promotion they did not pay for,
/// so the checks are deliberately unforgiving. `validateZapReceipt` does the
/// NIP-57 half — provider signature, a payer-signed request, an invoice
/// whose amount matches what the request claimed — and this adds what makes
/// it a boost rather than an ordinary zap.
Boost? readBoost(NostrEvent receipt, BoostSource source) {
  if (receipt.kind != zapReceiptKind) return null;

  // Read from the zap request inside the receipt rather than from the
  // receipt's own tags — the request is signed by the payer, so it is the
  // half that says what was bought.
  final parsed = parseZapReceipt(receipt);

  final noteId = parsed.targetEventId;
  if (noteId == null) return null;

  // Paid to us, signed by our lightning server, and about this note.
  final valid = validateZapReceipt(
    receipt,
    ReceiptCheck(
      recipientPubkey: [source.platformPubkey],
      providerPubkey: [source.providerPubkey],
      eventId: [noteId],
    ),
  );
  if (!valid) return null;

  final payerPubkey = parsed.senderPubkey;
  if (payerPubkey == null) return null;

  // The invoice is what was payable; the request's `amount` tag is only
  // what was asked for. Pricing a boost from the request would let somebody
  // claim a campaign tier on a starter invoice — `parseZapReceipt` reads
  // the invoice first for exactly this reason.
  final amountSats = parsed.amountSats;
  if (amountSats == null) return null;

  final tier = tierForAmount(amountSats);
  if (tier == null) return null;

  // Timed from the receipt — the platform's own signature, and the one
  // timestamp in this that the buyer cannot choose.
  final startedAt = receipt.createdAt;

  return Boost(
    receiptId: receipt.id,
    noteId: noteId,
    payerPubkey: payerPubkey,
    amountSats: amountSats,
    tier: tier,
    startedAt: startedAt,
    expiresAt: startedAt + tier.duration.inSeconds,
  );
}

/// Whether a boost is still running.
bool isActiveBoost(Boost boost, [int? now]) {
  final n = now ?? DateTime.now().millisecondsSinceEpoch ~/ 1000;
  return boost.startedAt <= n && boost.expiresAt > n;
}

/// The boosts in force, one per note, strongest first.
///
/// A note can be boosted more than once — by its author and a reader, or
/// twice by the same person. They do not add up: the strongest one applies
/// and the rest are still visible in the ledger as what they are. Stacking
/// multipliers would let somebody buy their way past the cap by buying
/// twice, which is the cap not existing.
List<Boost> activeBoosts(Iterable<Boost> boosts, [int? now]) {
  final n = now ?? DateTime.now().millisecondsSinceEpoch ~/ 1000;
  final strongest = <String, Boost>{};

  for (final boost in boosts) {
    if (!isActiveBoost(boost, n)) continue;

    final current = strongest[boost.noteId];
    final better = current == null ||
        boost.tier.multiplier > current.tier.multiplier ||
        (boost.tier.multiplier == current.tier.multiplier &&
            boost.expiresAt > current.expiresAt);

    if (better) strongest[boost.noteId] = boost;
  }

  final list = strongest.values.toList()
    ..sort((a, b) {
      final byMultiplier = b.tier.multiplier.compareTo(a.tier.multiplier);
      return byMultiplier != 0 ? byMultiplier : b.startedAt - a.startedAt;
    });
  return list;
}

/// Most of a feed that may be promoted, however much is paid for.
const maxPromotedShare = 0.1;

/// Organic notes between one promoted note and the next.
const promotedSpacing = 8;

/// The result of placing promoted notes into a timeline.
class PlacedFeed {
  final List<NostrEvent> items;

  /// Which of them are promoted, so the UI can label them.
  final Set<String> promoted;

  const PlacedFeed(this.items, this.promoted);
}

/// Puts promoted notes into a timeline, sparingly.
///
/// Two limits, and both are hard: no more than one note in nine is
/// promoted, and no more than a tenth of the feed however many were
/// bought — so a day when everybody boosts at once produces the same feed
/// as a quiet one, with the notes that missed out simply not shown rather
/// than queued into a wall of adverts.
///
/// Promoted notes are moved rather than duplicated: a boosted note already
/// in the timeline is lifted to its slot, not shown twice.
PlacedFeed placeBoosted(
  List<NostrEvent> organic,
  List<NostrEvent> boosted, {
  double maxShare = maxPromotedShare,
  int spacing = promotedSpacing,
}) {
  final promotedIds = boosted.map((e) => e.id).toSet();

  // A boosted note already in the timeline is lifted, not repeated.
  final rest = organic.where((e) => !promotedIds.contains(e.id)).toList();

  // The share is of the feed that RESULTS, not of the one that went in —
  // counting against the organic list alone lets each promoted note enlarge
  // the denominator meant to limit it.
  var allowed = boosted.length;
  final byShare = (rest.length * maxShare / (1 - maxShare)).floor();
  final bySpacing = (rest.length / spacing).ceil();
  if (byShare < allowed) allowed = byShare;
  if (bySpacing < allowed) allowed = bySpacing;

  if (allowed <= 0) {
    return PlacedFeed(rest, const {});
  }

  final taking = boosted.take(allowed).toList();
  final shown = taking.map((e) => e.id).toSet();

  final items = <NostrEvent>[];
  var next = 0;
  for (var index = 0; index < rest.length; index++) {
    items.add(rest[index]);
    if ((index + 1) % spacing == 0 && next < taking.length) {
      items.add(taking[next]);
      next += 1;
    }
  }

  // Anything that did not reach a slot is dropped rather than appended:
  // the bottom of a feed is not a placement.
  return PlacedFeed(items, shown);
}
