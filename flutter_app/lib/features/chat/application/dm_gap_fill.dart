import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/features/chat/application/dm_store.dart';

/// Gap-fill: catches DMs sent while the app was backgrounded/dead, which the
/// live subscription can't deliver retroactively (its replay window is
/// frozen, and NIP-17 backdates timestamps so "new since X" is unreliable).
///
/// Called on app resume (app.dart) — issues a ONE-SHOT query for DMs newer
/// than our newest seen event. Unlike the live sub's frozen `since`, this
/// cursor ADVANCES with every session, so each resume fetches only what
/// arrived while we were gone — nothing more.
final dmGapFillProvider = Provider<DmGapFill>((ref) => DmGapFill(ref));

class DmGapFill {
  final Ref _ref;

  /// Last time a gap-fill ran (debounce: resume fires multiple times during
  /// quick app-switching, and relay reconnects each trigger one too).
  DateTime? _lastRun;

  /// Don't gap-fill more than once per 10s — a resume storm of app-switching
  /// would otherwise fire 5 queries in as many seconds.
  static const _minInterval = Duration(seconds: 10);

  /// Cold-start lookback when we have no cursor at all (never seen a DM).
  /// Bounded so a first install doesn't pull years of history.
  static const _coldLookbackSecs = 7 * 24 * 3600; // 7 days

  DmGapFill(this._ref);

  /// Runs one gap-fill pass. Safe to call freely — debounced internally.
  Future<void> fillGap() async {
    final now = DateTime.now();
    if (_lastRun != null && now.difference(_lastRun!) < _minInterval) return;
    _lastRun = now;

    final auth = _ref.read(authStateProvider);
    if (!auth.isLoggedIn || auth.pubkey == null) return;
    final nostr = _ref.read(nostrServiceProvider);
    if (!nostr.isInitialized) return;

    final store = _ref.read(dmStoreProvider);
    var since = store.newestSeenTs;
    if (since == 0) {
      // Cold start: bounded lookback, not "everything ever".
      since = now.millisecondsSinceEpoch ~/ 1000 - _coldLookbackSecs;
    }

    try {
      final events = await nostr.relayPool.query(
        [
          NostrFilter(
            kinds: [4, 1059],
            tagFilters: {
              'p': [auth.pubkey!],
            },
            since: since,
            limit: 200,
          ),
        ],
        timeout: const Duration(seconds: 6),
      );
      if (events.isNotEmpty) {
        await store.ingestBatch(events);
      }
    } catch (_) {
      // Gap-fill is best-effort — a failed query just means the live sub
      // carries on as before (no regression).
    }
  }
}
