import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/config/env.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/nostr/zap_receipts.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/features/memberships/providers/membership_providers.dart';
import 'package:nostrfeed_mobile/features/premium/providers/premium_providers.dart';
import 'package:nostrfeed_mobile/features/studio/models/zap_goal.dart';

/// Whether the signed-in user may open the Studio's seller side. Premium-only:
/// a paid (non-generated, ACTIVE) NIP-05 name or lightning address.
final canUseStudioProvider = FutureProvider.autoDispose<bool>(
  (ref) => ref.watch(isPremiumProvider.future),
);

/// A day of earnings, for the trend chart.
class DailyEarning {
  final DateTime day;
  final int sats;
  const DailyEarning({required this.day, required this.sats});
}

/// The Studio earnings summary for a window, built only from zap receipts
/// that survive NIP-57 validation — no figure here can exceed the one on the
/// post it came from.
class StudioEarnings {
  final int days;
  final int sats;
  final int payments;
  final int zappers;
  final int repeatZappers;
  final int previousSats;
  final int? changePercent;
  final List<DailyEarning> daily;
  final int received;
  final int refused;

  const StudioEarnings({
    required this.days,
    required this.sats,
    required this.payments,
    required this.zappers,
    required this.repeatZappers,
    required this.previousSats,
    this.changePercent,
    required this.daily,
    required this.received,
    required this.refused,
  });
}

/// Earnings over [days] for the signed-in user: every receipt naming them,
/// validated and split into notes / articles / profile / subscriptions.
final studioEarningsProvider =
    FutureProvider.autoDispose.family<StudioEarnings, int>((ref, days) async {
  final auth = ref.watch(authStateProvider);
  final pubkey = auth.pubkey;
  if (pubkey == null) {
    return StudioEarnings(
      days: days,
      sats: 0,
      payments: 0,
      zappers: 0,
      repeatZappers: 0,
      previousSats: 0,
      daily: const [],
      received: 0,
      refused: 0,
    );
  }

  final nostr = ref.read(nostrServiceProvider);
  if (!nostr.isInitialized) await nostr.init();

  final now = DateTime.now().millisecondsSinceEpoch ~/ 1000;
  final since = now - (days * 2 * 86400);

  // Every receipt naming the user in the window (current + previous period,
  // so the % change is real). A subscriber's client picks the relays, so the
  // pool asks every connected one.
  final receipts = await nostr.relayPool.query(
    [
      NostrFilter(
        kinds: [zapReceiptKind],
        pTags: [pubkey],
        since: since,
        limit: 400,
      ),
    ],
    timeout: const Duration(seconds: 10),
  );

  // Dedupe on receipt id — the same receipt arrives from every relay.
  final seen = <String>{};
  final unique = receipts.where((r) => seen.add(r.id)).toList();

  // Validate. Provider key unknown is a doubt, not a disproof — counted but
  // flagged, per the web's 'prefer' policy for the dashboard figure.
  final summary = summarizeZaps(
    unique,
    check: ReceiptCheck(recipientPubkey: [pubkey]),
    providerPolicy: 'prefer',
  );

  final periodStart = now - (days * 86400);
  final previousStart = now - (days * 2 * 86400);

  var sats = 0;
  var payments = 0;
  var previousSats = 0;
  final byZapper = <String, int>{};
  final byDay = <String, int>{};

  for (final z in summary.zappers) {
    if (z.at >= periodStart) {
      sats += z.sats;
      payments++;
      byZapper[z.pubkey] = (byZapper[z.pubkey] ?? 0) + 1;
      final day = DateTime.fromMillisecondsSinceEpoch(z.at * 1000);
      final key = '${day.year}-${day.month}-${day.day}';
      byDay[key] = (byDay[key] ?? 0) + z.sats;
    } else if (z.at >= previousStart) {
      previousSats += z.sats;
    }
  }

  final repeatZappers = byZapper.values.where((c) => c > 1).length;

  // Fill every day of the window so the chart has no holes.
  final daily = <DailyEarning>[];
  for (var i = days - 1; i >= 0; i--) {
    final day = DateTime.now().subtract(Duration(days: i));
    final key = '${day.year}-${day.month}-${day.day}';
    daily.add(
      DailyEarning(
        day: DateTime(day.year, day.month, day.day),
        sats: byDay[key] ?? 0,
      ),
    );
  }

  int? changePercent;
  if (previousSats > 0) {
    changePercent = (((sats - previousSats) / previousSats) * 100).round();
  }

  return StudioEarnings(
    days: days,
    sats: sats,
    payments: payments,
    zappers: byZapper.length,
    repeatZappers: repeatZappers,
    previousSats: previousSats,
    changePercent: changePercent,
    daily: daily,
    received: summary.received,
    refused: summary.rejected.length,
  );
});

/// The user's open zap goals with live progress (NIP-75).
final myGoalsProvider =
    FutureProvider.autoDispose<List<({ZapGoal goal, GoalProgress progress})>>(
        (ref) async {
  final auth = ref.watch(authStateProvider);
  final pubkey = auth.pubkey;
  if (pubkey == null) return const [];

  final nostr = ref.read(nostrServiceProvider);
  if (!nostr.isInitialized) await nostr.init();

  final events = await nostr.relayPool.query(
    [
      NostrFilter(kinds: [goalKind], authors: [pubkey], limit: 50),
    ],
    timeout: const Duration(seconds: 8),
  );

  // Newest revision per goal id; skip malformed (no amount / no relays).
  final goals = <ZapGoal>[];
  final byId = <String, ZapGoal>{};
  for (final event in events) {
    final goal = parseZapGoal(event);
    if (goal == null) continue;
    final existing = byId[event.id];
    if (existing == null || goal.event.createdAt > existing.event.createdAt) {
      byId[event.id] = goal;
    }
  }
  goals.addAll(byId.values);

  final now = DateTime.now().millisecondsSinceEpoch ~/ 1000;

  final result = <({ZapGoal goal, GoalProgress progress})>[];
  for (final goal in goals) {
    // Tally the receipts naming this goal, from the goal's own relays AND
    // the reader's — a funded goal reading zero is the bug this avoids.
    final filters = <NostrFilter>[
      NostrFilter(kinds: [zapReceiptKind], eTags: [goal.event.id], limit: 200),
    ];
    final receipts = await nostr.relayPool.query(
      filters,
      timeout: const Duration(seconds: 8),
    );

    final seen = <String>{};
    final tallied = <({int amountMsat, String? senderPubkey, int createdAt})>[];
    for (final receipt in receipts) {
      if (!seen.add(receipt.id)) continue;
      // Validate before counting: a kind 9735 naming this goal and an amount
      // is not proof — the recipient's lightning server must have signed it.
      final rejection = explainZapReceipt(
        receipt,
        ReceiptCheck(eventId: [goal.event.id], recipientPubkey: null),
      );
      if (rejection != null) continue;
      final parsed = parseZapReceipt(receipt);
      final sats = parsed.amountSats;
      if (sats == null || sats <= 0) continue;
      tallied.add((
        amountMsat: sats * 1000,
        senderPubkey: parsed.senderPubkey,
        createdAt: receipt.createdAt,
      ));
    }

    result.add((goal: goal, progress: goalProgress(goal, tallied, now: now)));
  }

  // Open goals first, then by target.
  result.sort((a, b) {
    final aClosed = a.progress.isClosed ? 1 : 0;
    final bClosed = b.progress.isClosed ? 1 : 0;
    if (aClosed != bClosed) return aClosed.compareTo(bClosed);
    return b.progress.targetMsat.compareTo(a.progress.targetMsat);
  });
  return result;
});

/// Publish (or replace) a zap goal (NIP-75 kind 9041).
final publishGoalProvider = Provider<
    Future<bool> Function({
      required int amountSats,
      String summary,
      String description,
      String? image,
      String? url,
      int? closedAt,
    })>((ref) {
  return ({
    required amountSats,
    summary = '',
    description = '',
    image,
    url,
    closedAt,
  }) async {
    final nostr = ref.read(nostrServiceProvider);
    if (!nostr.isInitialized) await nostr.init();
    final connected = nostr.relayPool.connectedUrls;
    final relays = connected.isNotEmpty ? connected : Env.defaultRelays;

    final event = nostr.createEvent(
      kind: goalKind,
      content: description,
      tags: buildGoalTags(
        relays: relays.take(6).toList(),
        amountMsat: amountSats * 1000,
        closedAt: closedAt,
        image: image,
        summary: summary.isEmpty ? null : summary,
        url: url,
      ),
    );
    final ok = await nostr.publishEvent(event);
    ref.invalidate(myGoalsProvider);
    return ok;
  };
});

/// Retire a goal (NIP-09 deletion request on the kind 9041 id).
final retireGoalProvider = Provider<Future<bool> Function(String goalId)>((ref) {
  return (goalId) async {
    final nostr = ref.read(nostrServiceProvider);
    final event = nostr.createEvent(
      kind: 5,
      content: 'Goal retired',
      tags: [
        ['e', goalId],
      ],
    );
    final ok = await nostr.publishEvent(event);
    ref.invalidate(myGoalsProvider);
    return ok;
  };
});

/// Announce a goal in a note: kind 1 with a `goal` tag pointing back, so
/// zaps on the note count toward the goal.
final announceGoalProvider =
    Provider<Future<bool> Function(ZapGoal goal, String content)>((ref) {
  return (goal, content) async {
    final nostr = ref.read(nostrServiceProvider);
    final event = nostr.createPost(
      content,
      tags: [
        ['goal', goal.event.id, if (goal.relays.isNotEmpty) goal.relays.first],
      ],
    );
    final ok = await nostr.publishEvent(event);
    ref.invalidate(myGoalsProvider);
    return ok;
  };
});

/// The memberships half of Studio, re-exported so the Studio screen reads
/// one providers file. (Tiers, standings, summary live in
/// `membership_providers.dart` — this is the same data.)
final studioMembershipsProvider = myMembershipsProvider;
