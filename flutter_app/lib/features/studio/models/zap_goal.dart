import 'package:nostrfeed_mobile/core/models/nostr_models.dart';

/// NIP-75: fundraising goals, funded by zapping the goal itself. Port of the
/// web's `lib/nip75.ts`.
///
/// The unusual part is `relays`. A goal names the relays its zap receipts
/// will be published to and tallied from, and a zap that does not name them
/// produces a receipt the goal never sees. That is why the spec makes it a
/// MUST rather than a hint.
const goalKind = 9041;

class ZapGoal {
  /// Human-readable description, from `.content`.
  final String description;

  /// Target, in millisats — the unit the tag is in.
  final int amountMsat;

  /// Where receipts are published and tallied from. Required by the spec.
  final List<String> relays;

  /// Receipts published after this do not count.
  final int? closedAt;
  final String? image;
  final String? summary;

  /// A URL the goal is about.
  final String? url;

  /// An addressable event the goal is about.
  final String? addressPointer;

  /// Everyone the money is meant for, from NIP-57 `zap` tags. The author is
  /// not implied — a goal can raise for somebody else entirely.
  final List<({String pubkey, String? relay, double? weight})> beneficiaries;

  final NostrEvent event;

  const ZapGoal({
    required this.description,
    required this.amountMsat,
    required this.relays,
    this.closedAt,
    this.image,
    this.summary,
    this.url,
    this.addressPointer,
    this.beneficiaries = const [],
    required this.event,
  });
}

List<List<String>> _tagValues(NostrEvent event, String name) =>
    event.tags.where((t) => t.isNotEmpty && t[0] == name).toList();

String? _firstValue(NostrEvent event, String name) {
  final tags = _tagValues(event, name);
  if (tags.isEmpty) return null;
  final v = tags.first.length > 1 ? tags.first[1].trim() : '';
  return v.isEmpty ? null : v;
}

/// The relays named by a goal (`["relays", "wss://a", "wss://b"]` — one tag
/// holding many values). Only websocket URLs survive: an https entry here
/// would be passed to a zap request and rejected by the LNURL server.
List<String> goalRelays(NostrEvent event) {
  final urls = _tagValues(event, 'relays')
      .expand((tag) => tag.skip(1))
      .map((u) => u.trim())
      .where((u) => u.startsWith('wss://') || u.startsWith('ws://'))
      .toSet()
      .toList();
  return urls;
}

ZapGoal? parseZapGoal(NostrEvent event) {
  if (event.kind != goalKind) return null;

  final amountMsat = num.tryParse(_firstValue(event, 'amount') ?? '');
  // Both are REQUIRED: no amount means no progress to show, no relays means
  // every zap lands somewhere the tally will not look.
  if (amountMsat == null || amountMsat <= 0) return null;

  final relays = goalRelays(event);
  if (relays.isEmpty) return null;

  final closedAt = num.tryParse(_firstValue(event, 'closed_at') ?? '');

  final beneficiaries = _tagValues(event, 'zap')
      .map((tag) => (
            pubkey: tag.length > 1 ? tag[1].trim() : '',
            relay: tag.length > 2 && tag[2].trim().isNotEmpty ? tag[2].trim() : null,
            weight: tag.length > 3 ? num.tryParse(tag[3])?.toDouble() : null,
          ))
      .where((b) => RegExp(r'^[0-9a-f]{64}$', caseSensitive: false).hasMatch(b.pubkey))
      .toList();

  return ZapGoal(
    description: event.content.trim(),
    amountMsat: amountMsat.toInt(),
    relays: relays,
    closedAt:
        closedAt != null && closedAt > 0 ? closedAt.toInt() : null,
    image: _firstValue(event, 'image'),
    summary: _firstValue(event, 'summary'),
    url: _firstValue(event, 'r'),
    addressPointer: _firstValue(event, 'a'),
    beneficiaries: beneficiaries,
    event: event,
  );
}

/// The tags for a kind 9041. Throws when no usable relay is left rather than
/// emitting a bare `["relays"]` — that published cleanly but could never be
/// read or funded.
List<List<String>> buildGoalTags({
  required List<String> relays,
  required int amountMsat,
  int? closedAt,
  String? image,
  String? summary,
  String? url,
  String? addressPointer,
}) {
  final cleanRelays = relays
      .map((u) => u.trim())
      .where((u) => u.startsWith('wss://') || u.startsWith('ws://'))
      .toSet()
      .toList();
  if (cleanRelays.isEmpty) {
    throw ArgumentError(
        'A goal needs at least one websocket relay to count its zaps at.');
  }

  final tags = <List<String>>[
    ['relays', ...cleanRelays],
    ['amount', '${amountMsat.round()}'],
  ];
  if (closedAt != null) tags.add(['closed_at', '${closedAt.floor()}']);
  if (image != null) tags.add(['image', image]);
  if (summary != null) tags.add(['summary', summary]);
  if (url != null) tags.add(['r', url]);
  if (addressPointer != null) tags.add(['a', addressPointer]);
  return tags;
}

/// The goal an event points at, via its `goal` tag
/// (`["goal", "<event id>", "<relay hint>"]`). The hint is often the only
/// thing saying where to find the goal.
({String id, String? relay})? linkedGoal(NostrEvent event) {
  for (final tag in event.tags) {
    if (tag.isNotEmpty && tag[0] == 'goal' && tag.length > 1 && tag[1].isNotEmpty) {
      return (
        id: tag[1].trim(),
        relay: tag.length > 2 && tag[2].trim().isNotEmpty ? tag[2].trim() : null,
      );
    }
  }
  return null;
}

/// How far outside the window a receipt may fall and still count. A goal's
/// `created_at` and a receipt's are set by different machines (the browser
/// and the LNURL server), and nothing keeps them in step — a server a minute
/// behind stamps a receipt *earlier* than the goal it pays into. 5 minutes
/// covers ordinary clock drift without crediting a note's old history.
const clockSkewTolerance = 300;

/// Whether a receipt counts toward a goal — both ends of the window, not just
/// the deadline. A note usually exists before the goal does, so without a
/// lower bound the first thing a new goal does is credit itself with every
/// zap that note had ever collected.
bool countsTowardGoal({
  int? closedAt,
  int? startedAt,
  required int receiptCreatedAt,
}) {
  if (startedAt != null &&
      receiptCreatedAt < startedAt - clockSkewTolerance) {
    return false;
  }
  return closedAt == null ||
      receiptCreatedAt <= closedAt + clockSkewTolerance;
}

class GoalProgress {
  final int raisedMsat;
  final int targetMsat;

  /// 0–1, capped. A goal can be over-funded; a bar cannot be over-full.
  final double fraction;
  final int percent;
  final bool isReached;

  /// True once `closed_at` has passed.
  final bool isClosed;
  final int contributorCount;

  /// Valid zaps that fell outside the goal's window, so were not added —
  /// said out loud, because a bar that did not move deserves to know a
  /// payment was set aside rather than never seen.
  final int excludedCount;
  final int excludedMsat;

  const GoalProgress({
    required this.raisedMsat,
    required this.targetMsat,
    required this.fraction,
    required this.percent,
    required this.isReached,
    required this.isClosed,
    required this.contributorCount,
    required this.excludedCount,
    required this.excludedMsat,
  });
}

GoalProgress goalProgress(
  ZapGoal goal,
  List<({int amountMsat, String? senderPubkey, int createdAt})> receipts, {
  int? now,
}) {
  final at = now ?? DateTime.now().millisecondsSinceEpoch ~/ 1000;

  final counted = <({int amountMsat, String? senderPubkey, int createdAt})>[];
  final excluded = <({int amountMsat, String? senderPubkey, int createdAt})>[];

  for (final r in receipts) {
    final inWindow = countsTowardGoal(
      closedAt: goal.closedAt,
      startedAt: goal.event.createdAt,
      receiptCreatedAt: r.createdAt,
    );
    (inWindow ? counted : excluded).add(r);
  }

  final raisedMsat = counted.fold(0, (sum, r) => sum + r.amountMsat);
  final contributors = counted
      .map((r) => r.senderPubkey)
      .where((p) => p != null && p.isNotEmpty)
      .toSet();
  final fraction =
      goal.amountMsat > 0 ? (raisedMsat / goal.amountMsat).clamp(0.0, 1.0) : 0.0;

  return GoalProgress(
    raisedMsat: raisedMsat,
    targetMsat: goal.amountMsat,
    fraction: fraction.toDouble(),
    // Floored — a goal one sat short does not round up to "100%" while the
    // bar is visibly not full.
    percent: (fraction * 100).floor(),
    isReached: raisedMsat >= goal.amountMsat,
    isClosed: goal.closedAt != null && goal.closedAt! < at,
    contributorCount: contributors.length,
    excludedCount: excluded.length,
    excludedMsat: excluded.fold(0, (sum, r) => sum + r.amountMsat),
  );
}
