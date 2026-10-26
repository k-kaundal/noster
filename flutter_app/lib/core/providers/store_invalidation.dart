import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

/// ADR-0008 P5 — the per-table invalidation bus.
///
/// **The problem**: ONE global `engagementVersionProvider` counter drove
/// every rebuild. A like landing rebuilt feed cards — but so did a DM write,
/// a notification write, a profile update… any write to ANY table bumped the
/// one counter, so the whole app re-evaluated on every commit. That's the
/// "app re-renders constantly during a sync" jank.
///
/// **The fix**: per-table version counters. The store's writer lane reports
/// WHICH tables changed after each batch commit (via `EventStore.onTablesChanged`),
/// and this bus bumps ONLY those counters (debounced per table). Providers
/// `.select` on exactly their slice — a like landing rebuilds ONE card's
/// count (`StoreTable.eventRefs`), a DM landing rebuilds ONE thread
/// (`StoreTable.dmMessages`), and NEITHER rebuilds the other.
///
/// This is how 60fps is kept while writes land: writes are frequent and
/// batched, rebuilds are scoped and debounced.

/// The store tables a feature can listen to. Fine-grained by design —
/// `eventRefs` (engagement) is separate from `events` (content) because
/// counts change far more often than content, and a count change must not
/// re-render the content.
enum StoreTable {
  events, // posts/articles/content rows
  eventRefs, // engagement (likes/reposts/zaps/replies counts)
  profiles, // kind-0 metadata
  dmMessages, // chat messages
  dmThreads, // conversations + unread counts
  notifications, // the bell
  relayHealth, // relay fleet scoring
  media, // media metadata
}

/// Immutable snapshot of all table versions. Watch ONE table via
/// [tableVersionProvider] (rebuilds only when THAT table's counter changes).
final class StoreInvalidation {
  final Map<StoreTable, int> versions;
  const StoreInvalidation(this.versions);

  /// The version of one table (0 = never written this session).
  int operator [](StoreTable t) => versions[t] ?? 0;
}

/// The invalidation bus: bumps per-table counters (debounced per table so a
/// write BURST is ONE bump, not N). The store's writer lane feeds it via
/// `EventStore.onTablesChanged` (registered by [storeInvalidationWiringProvider]).
class StoreInvalidationBus extends Notifier<StoreInvalidation> {
  final Map<StoreTable, int> _versions = {};
  final Map<StoreTable, Timer> _pending = {};

  /// Per-table debounce — a sync burst of 50 ingests = one bump ~300ms after
  /// the last, not 50 rebuilds. Matches the existing engagement debounce.
  static const _debounce = Duration(milliseconds: 300);

  @override
  StoreInvalidation build() {
    ref.onDispose(() {
      for (final t in _pending.values) {
        t.cancel();
      }
    });
    return StoreInvalidation(Map.unmodifiable(_versions));
  }

  /// Report a set of changed tables (from the writer lane). Debounced per
  /// table — a burst collapses to one bump per table.
  void bumpAll(Set<StoreTable> tables) {
    for (final t in tables) {
      bump(t);
    }
  }

  /// Bump ONE table (debounced). A second bump inside the window is merged.
  void bump(StoreTable table) {
    if (_pending.containsKey(table)) return; // already scheduled
    _pending[table] = Timer(_debounce, () {
      _pending.remove(table);
      _increment(table);
    });
  }

  /// Bump ONE table IMMEDIATELY (no debounce) — for user-initiated writes
  /// that must reflect NOW (send a message, mark read, pull-to-refresh).
  void bumpNow(StoreTable table) {
    _pending.remove(table)?.cancel();
    _increment(table);
  }

  void _increment(StoreTable table) {
    _versions[table] = (_versions[table] ?? 0) + 1;
    state = StoreInvalidation(Map.unmodifiable(_versions));
  }
}

/// The bus provider. Watch a SINGLE table's version via [tableVersionProvider]
/// — never watch this whole map from a card (that rebuilds on every table).
final storeInvalidationProvider =
    NotifierProvider<StoreInvalidationBus, StoreInvalidation>(
  StoreInvalidationBus.new,
);

/// Watch ONE table's version. A provider that watches this rebuilds ONLY
/// when THAT table's counter changes — the fine-grained rebuild signal.
///
/// Usage (replaces watching a global version counter):
/// ```dart
/// final count = await ref.watch(
///   localEngagementProvider(eventId).future,
/// );
/// // inside localEngagementProvider:
/// ref.watch(tableVersionProvider(StoreTable.eventRefs));
/// ```
final tableVersionProvider = Provider.family<int, StoreTable>((ref, table) {
  return ref.watch(
    storeInvalidationProvider.select((s) => s[table]),
  );
});

/// Wires the store's writer-lane hook into the bus. Watch ONCE at the app
/// root (app.dart) — it points `EventStore.onTablesChanged` at the bus so
/// every committed write batch reports its tables. Kept as a provider so the
/// wiring shares the app's lifecycle (and is trivially reset in tests).
final storeInvalidationWiringProvider = Provider<void>((ref) {
  final bus = ref.read(storeInvalidationProvider.notifier);
  // EventStore is a plain singleton (Riverpod-free by design) — it exposes
  // a callback the bus registers here. One registration; no circular import
  // (the store never imports Riverpod).
  _wireEventStore(bus);
  ref.onDispose(() {
    EventStoreHooks.onTablesChanged = null;
  });
});

/// The seam between the Riverpod-free store and the bus. The store calls
/// [EventStoreHooks.onTablesChanged] after each committed write batch.
abstract final class EventStoreHooks {
  /// Set by [storeInvalidationWiringProvider]. Called with the changed
  /// tables after a write batch commits on the writer lane.
  static void Function(Set<StoreTable> tables)? onTablesChanged;
}

void _wireEventStore(StoreInvalidationBus bus) {
  EventStoreHooks.onTablesChanged = bus.bumpAll;
}
