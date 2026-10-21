import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/nostr/zap_receipts.dart';

/// Recurring support, without anything that can recur. Port of the web's
/// `lib/subscription.ts`.
///
/// A subscription here is a *zap to a tier*, and the receipt is the
/// subscription: signed by the creator's lightning server, naming the tier,
/// for an amount anyone can read. Nothing extra is published (no "intent"
/// event, no cancellation) — paying is the only act that means anything, and
/// stopping paying is the only cancellation that works.
///
/// The unmerged draft's kind for a tier. See NIP.md — it is a DRAFT.
const tierKind = 37001;

enum Cadence { weekly, monthly, yearly }

int cadenceSeconds(Cadence cadence) => switch (cadence) {
  Cadence.weekly => 7 * 86400,
  Cadence.monthly => 30 * 86400,
  Cadence.yearly => 365 * 86400,
};

String describeCadence(Cadence cadence) => switch (cadence) {
  Cadence.weekly => 'week',
  Cadence.yearly => 'year',
  _ => 'month',
};

Cadence readCadence(String? value) => switch (value) {
  'weekly' => Cadence.weekly,
  'yearly' => Cadence.yearly,
  _ => Cadence.monthly,
};

/// A subscription tier a creator offers.
class Tier {
  /// The `d` tag, which with the creator addresses the tier.
  final String slug;
  final String title;
  final String description;
  final String? image;

  /// Satoshis per period. Whole sats — this becomes an invoice.
  final int amount;
  final Cadence cadence;
  final List<String> perks;
  final String creator;
  final int createdAt;
  final NostrEvent event;

  const Tier({
    required this.slug,
    required this.title,
    required this.description,
    this.image,
    required this.amount,
    required this.cadence,
    this.perks = const [],
    required this.creator,
    required this.createdAt,
    required this.event,
  });
}

String? _tagValue(NostrEvent event, String name) {
  for (final t in event.tags) {
    if (t.isNotEmpty && t[0] == name && t.length > 1) return t[1];
  }
  return null;
}

/// Reads a tier, or refuses. An amount is required and must be a positive
/// whole number of sats — a tier priced at nothing is a subscribe button
/// that cannot be pressed.
Tier? parseTier(NostrEvent event) {
  if (event.kind != tierKind) return null;

  final slug = _tagValue(event, 'd');
  if (slug == null || slug.isEmpty) return null;

  final amountTag = event.tags.firstWhere(
    (t) => t.isNotEmpty && t[0] == 'amount',
    orElse: () => const [],
  );
  final amount = amountTag.length > 1 ? num.tryParse(amountTag[1]) : null;
  if (amount == null || amount % 1 != 0 || amount <= 0) return null;

  return Tier(
    slug: slug,
    title: _tagValue(event, 'title') ?? 'Supporter',
    description: _tagValue(event, 'description') ?? event.content.trim(),
    image: _tagValue(event, 'image'),
    amount: amount.toInt(),
    cadence: readCadence(amountTag.length > 2 ? amountTag[2] : null),
    perks: event.tags
        .where((t) => t.isNotEmpty && t[0] == 'perks')
        .expand((t) => t.skip(1))
        .where((v) => v.isNotEmpty)
        .toList(),
    creator: event.pubkey,
    createdAt: event.createdAt,
    event: event,
  );
}

/// The `kind:pubkey:d` coordinate a subscription zap points at.
String tierAddress(Tier tier) => '$tierKind:${tier.creator}:${tier.slug}';

/// The tags for publishing (or replacing) a tier.
List<List<String>> buildTierTags({
  required String slug,
  required String title,
  required int amount,
  required Cadence cadence,
  String description = '',
  String? image,
  List<String> perks = const [],
}) {
  final tags = <List<String>>[
    ['d', slug],
    ['title', title],
    ['amount', '${amount.round()}', cadence.name],
  ];
  if (description.isNotEmpty) tags.add(['description', description]);
  if (image != null && image.isNotEmpty) tags.add(['image', image]);
  final cleanPerks = perks
      .map((p) => p.trim())
      .where((p) => p.isNotEmpty)
      .toList();
  if (cleanPerks.isNotEmpty) tags.add(['perks', ...cleanPerks]);
  // NIP-31: a client that does not know this kind shows the alt text.
  tags.add([
    'alt',
    'Subscription tier: $title — $amount sats per ${describeCadence(cadence)}',
  ]);
  return tags;
}

enum SubscriptionState {
  /// Paid, and inside the period that payment bought.
  active,

  /// Paid before, but the period has run out.
  lapsed,

  /// Never paid for this tier.
  none,
}

class SubscriptionStatus {
  final SubscriptionState state;

  /// The payment the state was decided from.
  final Zapper? lastPayment;

  /// When the current period ends, or when the last one did.
  final int? expiresAt;

  /// Whole days left, or null when there is no period running.
  final int? daysLeft;

  /// Everything they have paid on this tier, newest first.
  final List<Zapper> history;

  /// Total ever paid on it.
  final int totalSats;

  /// What is still owed, when money arrived but not enough of it — zero in
  /// every other state. Exists because an underpayment used to be
  /// indistinguishable from never having paid.
  final int shortfallSats;

  const SubscriptionStatus({
    required this.state,
    this.lastPayment,
    this.expiresAt,
    this.daysLeft,
    this.history = const [],
    this.totalSats = 0,
    this.shortfallSats = 0,
  });

  static const none = SubscriptionStatus(state: SubscriptionState.none);
}

/// Somebody's standing on a tier, from payments already validated and already
/// theirs.
///
/// Payments below the tier price are ignored for the purpose of the period —
/// somebody who sends 500 sats towards a 5,000 sat tier has tipped,
/// generously, and has not bought a month. They still appear in the history,
/// because their money was real.
SubscriptionStatus standingFrom(List<Zapper> payments, Tier tier, {int? now}) {
  final at = now ?? DateTime.now().millisecondsSinceEpoch ~/ 1000;
  final mine = [...payments]..sort((a, b) => b.at.compareTo(a.at));

  if (mine.isEmpty) return SubscriptionStatus.none;

  final totalSats = mine.fold(0, (sum, z) => sum + z.sats);

  // The most recent payment that actually covered the price. An older full
  // payment still holds a period open even if a small tip came after it.
  final qualifying = mine.where((z) => z.sats >= tier.amount).firstOrNull;

  if (qualifying == null) {
    // The largest single payment, not the sum — three tips do not add up to a
    // subscription, because each is measured against the tier on its own.
    final largest = mine.map((z) => z.sats).reduce((a, b) => a > b ? a : b);
    return SubscriptionStatus(
      state: SubscriptionState.none,
      lastPayment: mine[0],
      history: mine,
      totalSats: totalSats,
      shortfallSats: (tier.amount - largest).clamp(0, 1 << 31),
    );
  }

  final expiresAt = qualifying.at + cadenceSeconds(tier.cadence);
  final active = expiresAt > at;

  return SubscriptionStatus(
    state: active ? SubscriptionState.active : SubscriptionState.lapsed,
    lastPayment: qualifying,
    expiresAt: expiresAt,
    daysLeft: active ? ((expiresAt - at) / 86400).ceil() : 0,
    history: mine,
    totalSats: totalSats,
  );
}

/// Whether a period is close enough to its end to be worth mentioning.
const renewalWindowDays = 5;

bool needsRenewal(SubscriptionStatus status) {
  if (status.state == SubscriptionState.lapsed) return true;
  return status.state == SubscriptionState.active &&
      status.daysLeft != null &&
      status.daysLeft! <= renewalWindowDays;
}

/// A month, for normalising prices not quoted by the month.
const _monthSeconds = 30 * 86400;

/// One period's price expressed per month (a weekly tier at 1,000 sats and a
/// yearly one at 1,000 are not the same business).
int monthlySats(Tier tier) =>
    ((tier.amount * _monthSeconds) / cadenceSeconds(tier.cadence)).round();

/// One person's standing on one tier.
class Member {
  final String pubkey;
  final SubscriptionStatus status;
  const Member({required this.pubkey, required this.status});
}

/// Everyone on a tier, and what the tier is worth, from one pass over the
/// receipts.
class TierStanding {
  final Tier tier;

  /// Everyone who has ever paid, most given first.
  final List<Member> members;

  /// Inside a paid period right now.
  final List<Member> active;

  /// Active, and close enough to the end to be worth a nudge.
  final List<Member> renewingSoon;

  /// Paid once and let the period run out.
  final List<Member> lapsed;

  /// Sats ever received on the tier, whoever sent them.
  final int lifetimeSats;

  /// What the periods running right now are worth per month (a run rate, not
  /// a forecast — nothing renews on its own).
  final int runRateSats;

  /// Money on the tier that names nobody (anonymous zaps) — real revenue
  /// attached to a throwaway key, counted so the lifetime total agrees with
  /// the wallet.
  final int unattributedSats;

  const TierStanding({
    required this.tier,
    required this.members,
    required this.active,
    required this.renewingSoon,
    required this.lapsed,
    required this.lifetimeSats,
    required this.runRateSats,
    required this.unattributedSats,
  });
}

/// Everyone on a tier, and what the tier is worth, from one pass over the
/// receipts.
TierStanding tierStanding(Tier tier, List<Zapper> zappers, {int? now}) {
  final at = now ?? DateTime.now().millisecondsSinceEpoch ~/ 1000;

  final byPayer = <String, List<Zapper>>{};
  for (final z in zappers) {
    (byPayer[z.pubkey] ??= []).add(z);
  }

  final members =
      byPayer.entries
          .map(
            (e) => Member(
              pubkey: e.key,
              status: standingFrom(e.value, tier, now: at),
            ),
          )
          .toList()
        ..sort((a, b) => b.status.totalSats.compareTo(a.status.totalSats));

  final active = members
      .where((m) => m.status.state == SubscriptionState.active)
      .toList();
  final lapsed = members
      .where((m) => m.status.state == SubscriptionState.lapsed)
      .toList();

  final namedSats = members.fold(0, (sum, m) => sum + m.status.totalSats);
  final lifetimeSats = zappers.fold(0, (sum, z) => sum + z.sats);

  return TierStanding(
    tier: tier,
    members: members,
    active: active,
    renewingSoon: active.where((m) => needsRenewal(m.status)).toList(),
    lapsed: lapsed,
    lifetimeSats: lifetimeSats,
    runRateSats: active.length * monthlySats(tier),
    unattributedSats: (lifetimeSats - namedSats).clamp(0, 1 << 31),
  );
}

/// The creator's whole catalogue summary.
class MembershipSummary {
  /// People, not subscriptions — someone on two tiers is one supporter.
  final int activeMembers;
  final int lapsedMembers;
  final int runRateSats;
  final int lifetimeSats;
  final int renewingSoon;

  const MembershipSummary({
    required this.activeMembers,
    required this.lapsedMembers,
    required this.runRateSats,
    required this.lifetimeSats,
    required this.renewingSoon,
  });
}

MembershipSummary summarizeMemberships(List<TierStanding> standings) {
  final activePeople = <String>{};
  final lapsedPeople = <String>{};
  final soonPeople = <String>{};

  for (final s in standings) {
    for (final m in s.active) {
      activePeople.add(m.pubkey);
    }
    for (final m in s.lapsed) {
      lapsedPeople.add(m.pubkey);
    }
    for (final m in s.renewingSoon) {
      soonPeople.add(m.pubkey);
    }
  }

  // Someone active on one tier and lapsed on another is a current supporter —
  // removing them from lapsed keeps an upgrade from reading as churn.
  lapsedPeople.removeAll(activePeople);

  return MembershipSummary(
    activeMembers: activePeople.length,
    lapsedMembers: lapsedPeople.length,
    renewingSoon: soonPeople.length,
    runRateSats: standings.fold(0, (sum, s) => sum + s.runRateSats),
    lifetimeSats: standings.fold(0, (sum, s) => sum + s.lifetimeSats),
  );
}

/// Every tier a creator offers, cheapest first. Replaceable by address — a
/// tier edited twice appears twice and only the newest revision counts.
List<Tier> rankTiers(List<NostrEvent> events) {
  final newest = <String, Tier>{};
  for (final event in events) {
    final tier = parseTier(event);
    if (tier == null) continue;
    final existing = newest[tier.slug];
    if (existing == null || tier.createdAt > existing.createdAt) {
      newest[tier.slug] = tier;
    }
  }
  return newest.values.toList()..sort((a, b) => a.amount.compareTo(b.amount));
}
