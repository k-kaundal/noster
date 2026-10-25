import 'dart:async';
import 'dart:convert';

import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/nostr/filter.dart';

/// ADR-0005 L2 — the dispatch hub between L1 (RelayPool) and L3
/// (per-domain processors).
///
/// Every relay event from every live subscription flows through ONE bus:
///
/// - **One REQ per filter-set, not per consumer.** Two features wanting the
///   same filters (feed live tail + a notification listener, say) share a
///   single relay subscription — reference-counted, closed when the last
///   consumer releases (Amethyst's MutableComposeSubscriptionManager).
/// - **Cross-spec dedup.** Overlapping filters (feed tail's kind-1 global +
///   the social listener's kind-1 #p=me) deliver the same event on two REQs;
///   the bus drops the second copy, so processors see every event ONCE
///   (Gossip's dedup-first rule; the pool already sig-verifies upstream).
/// - **Consumers filter locally.** The bus carries the UNION of all active
///   specs; each consumer re-applies its own filters with
///   [NostrFilterSetMatcher.matchesAny] — the rx-nostr `share()` +
///   `filterBy` pattern, Dart-native.
class EventBus {
  EventBus({required this._subscribe});

  final Stream<NostrEvent> Function(List<NostrFilter>) _subscribe;

  final _controller = StreamController<NostrEvent>.broadcast();
  final _specs = <String, _ActiveSpec>{};

  /// L3 gates (ADR-0005): an event must pass EVERY gate to reach the bus —
  /// "filter what needs filtering, the rest get lost." Gates run once per
  /// unique event (after cross-spec dedup), so a flood post is dropped for
  /// every consumer at once, not re-judged per feature.
  final _gates = <bool Function(NostrEvent)>[];

  /// Register a gate. Events failing it never reach consumers. Register at
  /// bus construction (gates are pipeline policy, not per-consumer state).
  void addGate(bool Function(NostrEvent event) gate) => _gates.add(gate);

  /// Cross-spec dedup — insertion-ordered (Dart LinkedHashSet), so evicting
  /// the first entry drops the oldest. 10k ≈ several minutes of a busy
  /// relay; a duplicate arriving after eviction just re-processes (harmless:
  /// every processor is idempotent — store writes are INSERT OR REPLACE).
  final Set<String> _seenIds = <String>{};
  static const _dedupCap = 10000;

  /// The single stream of every event from every active subscription.
  Stream<NostrEvent> get stream => _controller.stream;

  /// Number of live REQs (diagnostics — Settings → Relays can show it).
  int get activeSubscriptionCount => _specs.length;

  /// Acquire a subscription for [filters]. Identical filter-sets share one
  /// relay REQ; the caller releases with the returned handle's [dispose].
  ///
  /// Events matching this spec arrive on [stream] — filter locally:
  /// ```dart
  /// final spec = [NostrFilter(kinds: [1], tagFilters: {'e': [id]})];
  /// final handle = bus.acquire(spec);
  /// final sub = bus.stream
  ///   .where((e) => spec.matchesAny(e))
  ///   .listen(onEvent);
  /// // teardown: sub.cancel(); handle.dispose();
  /// ```
  EventBusHandle acquire(List<NostrFilter> filters) {
    final key = specKey(filters);
    final existing = _specs[key];
    if (existing != null) {
      existing.refs++;
      return EventBusHandle._(this, key);
    }
    final sub = _subscribe(filters).listen(
      _ingest,
      onError: (_) {}, // a single relay's error never kills the bus
    );
    _specs[key] = _ActiveSpec(filters: filters, subscription: sub, refs: 1);
    return EventBusHandle._(this, key);
  }

  void _ingest(NostrEvent event) {
    // Dedup first (Gossip order — the pool already sig-verified upstream):
    // one event is processed once no matter how many REQs/relays carry it.
    if (!_seenIds.add(event.id)) return;
    if (_seenIds.length > _dedupCap) _seenIds.remove(_seenIds.first);
    // L3 gates: drop for EVERY consumer on the first failure.
    for (final gate in _gates) {
      if (!gate(event)) return;
    }
    _controller.add(event);
  }

  void _release(String key) {
    final spec = _specs[key];
    if (spec == null) return;
    if (--spec.refs <= 0) {
      unawaited(spec.subscription.cancel());
      _specs.remove(key);
    }
  }

  /// Canonical identity of a filter-set: two specs with the same key share
  /// one REQ. Sorts filters + all list values so ordering differences don't
  /// fork the subscription.
  static String specKey(List<NostrFilter> filters) {
    final canonical = filters.map((f) {
      final j = f.toJson();
      final sorted = <String, dynamic>{};
      for (final key in j.keys.toList()..sort()) {
        final v = j[key];
        sorted[key] = v is List ? (List.of(v)..sort()) : v;
      }
      return sorted;
    }).toList()
      ..sort((a, b) => jsonEncode(a).compareTo(jsonEncode(b)));
    return jsonEncode(canonical);
  }
}

/// The release half of [EventBus.acquire]. Consumers MUST dispose exactly
/// once (Riverpod: `ref.onDispose(handle.dispose)`); the underlying REQ
/// closes when its last holder releases.
class EventBusHandle {
  EventBusHandle._(this._bus, this._key);

  final EventBus _bus;
  final String _key;
  bool _disposed = false;

  void dispose() {
    if (_disposed) return;
    _disposed = true;
    _bus._release(_key);
  }
}

class _ActiveSpec {
  _ActiveSpec({
    required this.filters,
    required this.subscription,
    required this.refs,
  });

  final List<NostrFilter> filters;
  final StreamSubscription<NostrEvent> subscription;
  int refs;
}

/// Local filter matching — a consumer's .where() guard on the bus's union
/// stream. Delegates to the compiled engine in `core/nostr/filter.dart`
/// (ADR-0007 Phase 0), so the bus, the store, and the future local relay
/// share ONE set of NIP-01 semantics. `search` (NIP-50) is relay-side only
/// and evaluates TRUE locally (conservative: never drops a possible match).
extension NostrFilterSetMatcher on List<NostrFilter> {
  /// True when [event] matches ANY filter in the set (OR semantics, like a
  /// relay evaluating a REQ). Compiles per call — fine for `.where()` guards
  /// on the union stream; hot loops should hold a [CompiledFilterGroup].
  bool matchesAny(NostrEvent event) => any((f) => f.matchesEvent(event));
}

extension NostrFilterMatcher on NostrFilter {
  /// Does [event] satisfy this filter? NIP-01-exact semantics via the
  /// compiled engine: AND of present attributes, empty lists match nothing,
  /// hex comparisons case-insensitive, `limit` not a predicate.
  bool matchesEvent(NostrEvent event) =>
      CompiledFilter.from(this).matches(event);
}
