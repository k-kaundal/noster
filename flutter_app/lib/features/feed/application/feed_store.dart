import 'dart:convert';

import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// A bounded, persistent cache of feed events — the piece that makes the
/// feed feel like Facebook/Instagram instead of a relay demo:
///
/// - **Cold start shows content instantly.** The last feed is on disk, so
///   the first frame is posts, not skeletons. The relay refresh happens
///   behind them and merges in.
/// - **No flicker on refresh.** Refresh merges into the existing list and
///   only prepends genuinely new events — the scroll position and every
///   card underneath stays put.
/// - **Offline reads.** With no connection at all, the cached feed is still
///   the whole experience — stale, but usable, and marked as such.
///
/// Storage is JSON in SharedPreferences, bounded to the newest
/// [maxEvents] per feed key. A real event store (SQLite/Isar) is the next
/// step if profiling ever justifies it; at 300 events ≈ 1 MB of JSON, the
/// difference is not measurable.
class FeedStore {
  static const int maxEvents = 300;

  static const _globalKey = 'feed_cache:global_v1';
  static const _followingKey = 'feed_cache:following_v1';

  final String _key;
  const FeedStore._(this._key);

  static const global = FeedStore._(_globalKey);
  static const following = FeedStore._(_followingKey);

  /// The cached events, newest first, or empty. Malformed entries are
  /// dropped rather than failing the whole read.
  Future<List<NostrEvent>> read() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_key);
      if (raw == null || raw.isEmpty) return const [];
      final list = jsonDecode(raw);
      if (list is! List) return const [];
      final events = <NostrEvent>[];
      for (final item in list) {
        if (item is Map<String, dynamic>) {
          try {
            events.add(NostrEvent.fromJson(item));
          } catch (_) {}
        }
      }
      return events;
    } catch (_) {
      return const [];
    }
  }

  /// Persist the newest [maxEvents], deduped by id, newest first.
  Future<void> write(List<NostrEvent> events) async {
    try {
      final seen = <String>{};
      final trimmed = <Map<String, dynamic>>[];
      final sorted = [...events]
        ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
      for (final e in sorted) {
        if (!seen.add(e.id)) continue;
        trimmed.add(e.toJson());
        if (trimmed.length >= maxEvents) break;
      }
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_key, jsonEncode(trimmed));
    } catch (_) {
      // A full/refused store costs the cache, not the feed.
    }
  }

  Future<void> clear() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(_key);
    } catch (_) {}
  }
}
