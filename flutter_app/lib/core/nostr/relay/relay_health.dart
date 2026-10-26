import 'dart:async';

import 'package:nostrfeed_mobile/core/config/env.dart';
import 'package:nostrfeed_mobile/core/db/db_models.dart';
import 'package:nostrfeed_mobile/core/db/event_store.dart';
import 'package:nostrfeed_mobile/features/settings/application/relay_settings_providers.dart'
    show readRelayUrls, writeRelayUrls;

/// ADR-0008 P3 — relay fleet tiers + EWMA health scoring.
///
/// Relays were a flat `Map<String, RelayConnection>` with no priority, no
/// latency tracking, and queries broadcast to ALL of them (the "too many
/// events at once" flood on both the server and the client's verify/merge
/// pipeline). This tracker gives every relay a **tier** (trust + routing
/// priority) and a **score** (EWMA of connect success + EOSE latency +
/// events delivered), persisted to `relay_health` so a cold start inherits
/// the fleet's learned behavior instead of re-probing every relay blind.
///
/// Design (mirrors how Gossip/Amethyst rank relays):
/// - **T0 platform** — our own infra (`relay.nostrfeed.com` + the paid
///   relay). Always connect first, never demote (WE operate it; a bad day
///   is our bug, not a reason to route away).
/// - **T1 user** — the user's NIP-65/managed relays (read/write toggles).
/// - **T2 curated public** — the health-checked default set. Scored; a
///   failing relay auto-demotes out of the top-K, a recovering one promotes.
/// - **T3 ad-hoc** — per-user outbox-discovery relays. Bounded pool, never
///   scored (ephemeral).
///
/// The score is an EWMA (`score = 0.7·score + 0.3·sample`) so recent behavior
/// dominates but one bad probe doesn't tank a good relay. Samples:
/// - connect success/failure → 1.0 / 0.0
/// - EOSE latency → 1.0 fast … 0.0 at/above [_eoseSlowMs]
/// - events delivered → small positive reinforcement (0.8)
class RelayHealthTracker {
  RelayHealthTracker({EventStore? store}) : _store = store ?? EventStore.instance;

  final EventStore _store;

  /// In-memory health map (loaded once from the store, updated on events,
  /// persisted debounced). url → health.
  final Map<String, DbRelayHealth> _health = {};

  /// EOSE latency considered "slow" (score → 0). Faster than this is
  /// proportionally better (1.0 at 0ms).
  static const _eoseSlowMs = 4000;

  /// Persistence debounce — health events fire constantly during a feed
  /// refresh; writes batch into one per window on the writer lane.
  Timer? _persistTimer;
  static const _persistDebounce = Duration(seconds: 3);

  bool _loaded = false;

  /// Load persisted health once (idempotent). Call at pool init.
  Future<void> load() async {
    if (_loaded) return;
    _loaded = true;
    try {
      for (final h in await _store.allRelayHealth()) {
        _health[h.url] = h;
      }
    } catch (_) {
      // Cold start with no table yet — start blank, fill in from events.
    }
  }

  // ── Tiering ──────────────────────────────────────────────────────────

  static const _platformRelays = {
    'wss://relay.nostrfeed.com',
    Env.paidRelay,
  };

  /// The trust/routing tier of a relay URL (drives connection priority +
  /// query routing). Pure — derived from the static sets + the user's
  /// read/write intent, never stored (computed on the fly).
  DbRelayTier tierOf(String url) {
    if (_platformRelays.contains(url)) return DbRelayTier.platform;
    if (readRelayUrls.contains(url) || writeRelayUrls.contains(url)) {
      return DbRelayTier.user;
    }
    if (Env.defaultRelays.contains(url) || Env.indexerRelays.contains(url)) {
      return DbRelayTier.curated;
    }
    return DbRelayTier.adhoc;
  }

  // ── Scoring ──────────────────────────────────────────────────────────

  DbRelayHealth _for(String url) {
    final existing = _health[url];
    if (existing != null) return existing;
    final fresh = DbRelayHealth(
      url: url,
      tier: tierOf(url),
      updatedAt: 0,
    );
    _health[url] = fresh;
    return fresh;
  }

  /// EWMA blend: recent sample weighs 0.3, history 0.7.
  static double _blend(double score, double sample) =>
      score <= 0 ? sample : (0.7 * score + 0.3 * sample);

  void _update(String url, double sample, void Function(_HealthWriter w) fn) {
    final cur = _for(url);
    final w = _HealthWriter(cur);
    fn(w);
    _health[url] = DbRelayHealth(
      url: url,
      tier: cur.tier,
      score: _blend(cur.score, sample),
      lastEoseMs: w.lastEoseMs ?? cur.lastEoseMs,
      eoseSamples: w.eoseSamples,
      successCount: w.successCount,
      failureCount: w.failureCount,
      updatedAt: DateTime.now().millisecondsSinceEpoch ~/ 1000,
    );
    _schedulePersist();
  }

  /// A successful socket connect (sample = 1.0).
  void recordConnectSuccess(String url) {
    _update(url, 1.0, (w) => w.successCount++);
  }

  /// A failed connect / socket error (sample = 0.0).
  void recordConnectFailure(String url) {
    _update(url, 0.0, (w) => w.failureCount++);
  }

  /// An EOSE that completed in [ms] (sample ∝ speed; slow → 0).
  void recordEose(String url, int ms) {
    final sample = (1.0 - (ms / _eoseSlowMs)).clamp(0.0, 1.0);
    _update(url, sample, (w) {
      w.lastEoseMs = ms;
      w.eoseSamples++;
    });
  }

  /// The relay delivered an event (small positive reinforcement, 0.8).
  void recordEventDelivered(String url) {
    _update(url, 0.8, (_) {});
  }

  /// The current score for a relay (0 = unknown/never sampled).
  double scoreOf(String url) => _health[url]?.score ?? 0;

  /// The health record for a relay (null = unknown).
  DbRelayHealth? healthOf(String url) => _health[url];

  /// Rank a set of relay URLs by (tier asc, score desc) — the query routing
  /// order: platform first, then user, then curated, best-scoring within
  /// each tier. Pure (no side effects).
  List<String> ranked(Iterable<String> urls) {
    final list = urls.toList();
    list.sort((a, b) {
      final ta = tierOf(a).v, tb = tierOf(b).v;
      if (ta != tb) return ta.compareTo(tb);
      return scoreOf(b).compareTo(scoreOf(a));
    });
    return list;
  }

  /// The top-K relays to fan a query out to, from a candidate set.
  /// Platform relays ALWAYS make the cut (they're our infra); the rest fill
  /// by rank. K≈4 bounds the verify/merge flood (was: broadcast to ALL).
  List<String> topK(Iterable<String> candidates, {int k = 4}) {
    final rankedList = ranked(candidates);
    if (rankedList.length <= k) return rankedList;
    final platform = rankedList.where((u) => tierOf(u) == DbRelayTier.platform);
    final rest = rankedList.where((u) => tierOf(u) != DbRelayTier.platform);
    final out = <String>{...platform};
    for (final url in rest) {
      if (out.length >= k) break;
      out.add(url);
    }
    return out.toList();
  }

  // ── Persistence (debounced, best-effort) ─────────────────────────────

  void _schedulePersist() {
    _persistTimer?.cancel();
    _persistTimer = Timer(_persistDebounce, _persistNow);
  }

  Future<void> _persistNow() async {
    try {
      // Snapshot + upsert each (writer lane serializes; a handful of rows).
      final all = _health.values.toList();
      for (final h in all) {
        await _store.upsertRelayHealth(h);
      }
    } catch (_) {
      // Health persistence is best-effort — routing works from memory.
    }
  }

  /// Force a flush (app backgrounding / tests).
  Future<void> flush() async {
    _persistTimer?.cancel();
    await _persistNow();
  }
}

/// Mutable scratch for one health update (avoids allocating per counter).
class _HealthWriter {
  _HealthWriter(DbRelayHealth cur)
      : lastEoseMs = cur.lastEoseMs,
        eoseSamples = cur.eoseSamples,
        successCount = cur.successCount,
        failureCount = cur.failureCount;
  int? lastEoseMs;
  int eoseSamples;
  int successCount;
  int failureCount;
}
