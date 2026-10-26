import 'package:nostrfeed_mobile/core/providers/store_invalidation.dart'
    show StoreTable;
import 'package:sqflite/sqflite.dart';

/// The two capabilities every domain store needs from the shared core:
/// the database handle and the single-writer lane.
///
/// ADR-0008 (God-object split): `event_store.dart` was 2,715 lines owning
/// NINE unrelated domains. The domains that have ZERO interaction with the
/// NIP-01 ingest lifecycle (messaging, notifications, relay fleet, media,
/// publish outbox, profiles, maintenance) are split into per-domain stores
/// under `stores/`. They share ONE database + ONE writer lane through this
/// interface — so there is NO import cycle (a domain store never imports
/// `event_store.dart`; `EventStore` implements [StoreHost] and injects
/// itself).
///
/// The single-writer guarantee holds because [enqueueWrite] serializes onto
/// the SAME lane the core's own writes use — a domain store's write and an
/// ingest write can never interleave into two concurrent transactions.
abstract class StoreHost {
  /// The shared database (opened once, WAL mode, race-free).
  Future<Database> get db;

  /// Serialize a mutation onto the single-writer lane. [touches] declares
  /// which tables changed (the invalidation bus is fired after commit).
  Future<T> enqueueWrite<T>(
    Future<T> Function() op, {
    Set<StoreTable>? touches,
  });

  /// Whether the platform's SQLite has FTS5 (feature-detected at open).
  bool get ftsAvailable;
}
