import 'dart:async';

import 'package:nostrfeed_mobile/core/db/event_store.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';

/// ADR-0007 — local-first merged queries for the repositories.
///
/// Every one-shot read ("feed page", "replies to X", "profiles", "thread")
/// used to go straight to remote relays — slow, and dead offline. Now:
///
/// 1. The **local store** answers instantly (offline-correct) — this is the
///    in-app relay serving the UI, the whole point of ADR-0007.
/// 2. The **remote pool** answers in parallel; its events are ingested into
///    the store (staying the single source of truth).
/// 3. Results merge **deduped by id**, newest-first (NIP-01 tie: lowest id).
///
/// Latency rule: remote gets a short window ([remoteWait]) to *improve* the
/// local answer, never to *block* it — with the local relay present, a dead
/// relay / airplane mode still returns the cached page immediately instead
/// of hanging on a socket timeout. Callers that only need freshness
/// (pull-to-refresh) can wait longer via [remoteWait].
Future<List<NostrEvent>> localFirstQuery(
  List<NostrFilter> filters, {
  required EventStore store,
  required Future<List<NostrEvent>> Function(List<NostrFilter> filters)
      remoteQuery,
  Duration remoteWait = const Duration(seconds: 2),
  int defaultLimit = 50,
}) async {
  // Local and remote run in PARALLEL — the merged answer must never be
  // slower than the remote leg alone. Local is instant and offline-correct;
  // remote supplements and is bounded so a dead relay can't block. The
  // remote call is wrapped so even a SYNCHRONOUS throw (a dead-pool bug) is
  // caught, never breaking the local answer.
  final localFuture = store.queryByFilters(filters, defaultLimit: defaultLimit);
  final remoteFuture = Future<List<NostrEvent>>(() => remoteQuery(filters))
      .timeout(remoteWait, onTimeout: () => const <NostrEvent>[])
      .catchError((_) => <NostrEvent>[]);

  final local = await localFuture;
  final remote = await remoteFuture;
  if (remote.isEmpty) return local;

  // Ingest remote into the store so it stays the single source of truth.
  // Awaited (it's just a local write and the remote leg already resolved) —
  // deterministic: by the time this call returns, the store holds these
  // events, so a follow-up local read sees them.
  await store.ingest(remote);

  // Merge deduped by id, newest-first, NIP-01 tie-break.
  final merged = <String, NostrEvent>{for (final e in local) e.id: e};
  for (final e in remote) {
    merged[e.id] = e;
  }
  final out = merged.values.toList()
    ..sort((a, b) {
      final byTime = b.createdAt.compareTo(a.createdAt);
      return byTime != 0 ? byTime : a.id.compareTo(b.id);
    });

  // Bound the merged answer by the SUM of the per-filter bounds — NIP-01 OR
  // semantics: each filter's limit caps ITS OWN contribution (a single
  // filter's limit then caps the whole answer; a broad filter is never
  // starved by a tight companion). `limit: 0` is live-only (contributes 0).
  var bound = 0;
  for (final f in filters) {
    bound += f.limit ?? defaultLimit;
  }
  return out.length > bound ? out.sublist(0, bound) : out;
}
