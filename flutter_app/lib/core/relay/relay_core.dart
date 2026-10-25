import 'dart:async';
import 'dart:convert';

import 'package:nostrfeed_mobile/core/db/event_store.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/nostr/filter.dart';

/// ADR-0007 Phase 2 — the relay core, in-process.
///
/// This is the NIP-01 server logic with NO socket: a pure Dart engine that
/// accepts client messages (`EVENT` / `REQ` / `CLOSE`), answers with relay
/// messages (`OK` / `EVENT` / `EOSE` / `CLOSED` / `NOTICE`), and serves the
/// initial query from [EventStore] + the live monitor from an inverted
/// index (strfry's `ActiveMonitors`, sized for Dart).
///
/// Phase 3 puts a WebSocket in front of [RelaySession] (one per
/// connection); everything protocol-correct lives here and is wire-tested
/// without a socket.
///
/// Two flows, per strfry:
///
/// - **Initial query** ("old" data): [EventStore.queryByFilters] scans the
///   best index per filter, then `EOSE`.
/// - **Live monitor** ("new" data): every event ingested (locally published
///   OR arriving from upstream relays) is pushed through [onEvent], which
///   looks up candidate subscriptions in the inverted index and fans the
///   event out — one event reference, no per-sub copies, and a sub is
///   marked up-to-date per event so it's never re-checked or double-sent.
class LocalRelay {
  LocalRelay({required this.store});

  final EventStore store;

  /// Inverted live-monitor index: field → value → subscription ids.
  /// When an event arrives we only fully-check subs that care about one of
  /// its fields (strfry's monitor sets) — never a linear scan of all subs.
  final _byAuthor = <String, Set<String>>{};
  final _byKind = <int, Set<String>>{};
  final _byTag = <String, Set<String>>{}; // 'e' / 'p' / any single letter
  final _any = <String>{}; // subs with no field constraint (time-only)

  final _subs = <String, _Subscription>{};

  /// Outbound relay→client frames. The transport (phase 3: a websocket;
  /// tests: a listener) renders these to NIP-01 JSON arrays.
  final _out = StreamController<RelayFrame>.broadcast();
  Stream<RelayFrame> get frames => _out.stream;

  int get subscriptionCount => _subs.length;

  // ── Client → relay messages ───────────────────────────────────────────

  /// `["REQ", subId, filter1, filter2, …]`: run the initial query, register
  /// the live monitor, stream matching stored events then `EOSE`.
  Future<void> req(String sessionId, String subId, List<NostrFilter> filters) async {
    final key = '$sessionId:$subId';
    close(sessionId, subId); // a REQ on an existing id replaces it
    if (filters.isEmpty) {
      _out.add(RelayFrame.closed(sessionId, subId, 'error: no filters'));
      return;
    }
    final group = CompiledFilterGroup(filters);
    if (group.isDead) {
      // NIP-01: a filter with an empty list matches nothing — answer EOSE
      // immediately, keep the (dead) sub registered so CLOSE is well-defined.
      _register(key, sessionId, subId, group);
      _out.add(RelayFrame.eose(sessionId, subId));
      return;
    }

    // Initial query: stored events (limit:0 filters are live-only, handled
    // inside queryByFilters). Newest-first per NIP-01.
    final stored = await store.queryByFilters(filters);
    _register(key, sessionId, subId, group);
    for (final e in stored) {
      _subs[key]?.upToDate.add(e.id);
      _out.add(RelayFrame.event(sessionId, subId, e));
    }
    _out.add(RelayFrame.eose(sessionId, subId));
  }

  /// `["EVENT", event]`: validate, store (with NIP-01 lifecycle), fan out
  /// to live subscribers, and ack with `OK`.
  Future<void> onClientEvent(String sessionId, NostrEvent event) async {
    if (!event.isValid) {
      _out.add(RelayFrame.ok(sessionId, event.id, false,
          'invalid: signature verification failed'));
      return;
    }
    // Store handles ephemeral-skip / replaceable / deletion semantics.
    await store.ingest([event]);
    _out.add(RelayFrame.ok(sessionId, event.id, true, ''));
    onEvent(event); // live fan-out (to every session, incl. originator's subs)
  }

  /// `["CLOSE", subId]`: tear down the live monitor.
  void close(String sessionId, String subId) {
    final key = '$sessionId:$subId';
    final sub = _subs.remove(key);
    if (sub == null) return;
    for (final set in sub.indexedIn) {
      set.remove(key);
    }
  }

  /// A live-only event stream for [filters] — the transport's view of the
  /// local relay. Unlike [req] (which also replays the stored tail), this
  /// emits ONLY events that arrive via [onEvent] AFTER subscription — the
  /// "new" half of a merged local+remote subscribe. Filtering uses the same
  /// compiled engine; dedup across specs is the caller's job (the merged
  /// transport dedups by id).
  Stream<NostrEvent> liveEventsFor(List<NostrFilter> filters) {
    final group = CompiledFilterGroup(filters);
    final controller = StreamController<NostrEvent>.broadcast();
    final seen = <String>{};
    final sub = _liveTap((event) {
      if (controller.isClosed) return;
      if (!group.matches(event)) return;
      if (!seen.add(event.id)) return;
      controller.add(event);
    });
    controller.onCancel = () {
      _liveTaps.remove(sub);
    };
    return controller.stream;
  }

  /// Lightweight listeners that see every [onEvent] (the transport's live
  /// tap) — separate from the REQ/subscription machinery above, which is
  /// session-scoped and frame-emitting.
  final _liveTaps = <void Function(NostrEvent)>{};
  void Function(NostrEvent) _liveTap(void Function(NostrEvent) fn) {
    _liveTaps.add(fn);
    return fn;
  }

  /// Drop every subscription owned by a disconnected session.
  void closeSession(String sessionId) {
    final keys = _subs.keys
        .where((k) => k.startsWith('$sessionId:'))
        .toList(growable: false);
    for (final k in keys) {
      final sub = _subs.remove(k);
      for (final set in sub!.indexedIn) {
        set.remove(k);
      }
    }
  }

  // ── Live monitor (upstream events arrive here too) ────────────────────

  /// Push a newly-ingested event through the live monitor. Called by the
  /// relay layer for upstream events and by [onClientEvent] for local
  /// publishes. Fan-out is one event reference to all matching subs.
  void onEvent(NostrEvent event) {
    // Transport live taps (session-less live streams) see every event.
    for (final tap in _liveTaps) {
      tap(event);
    }
    if (_subs.isEmpty) return;
    // Candidate subs: union of the inverted-index lookups on this event's
    // fields + the field-less (time-only) subs.
    final candidates = <String>{..._any};
    void collect(Map<dynamic, Set<String>> index, dynamic value) {
      final hit = index[value];
      if (hit != null) candidates.addAll(hit);
    }

    collect(_byAuthor, event.pubkey.toLowerCase());
    collect(_byKind, event.kind);
    for (final tag in event.tags) {
      if (tag.length > 1 && tag[0].length == 1) {
        collect(_byTag, '${tag[0]}:${tag[1].toLowerCase()}');
      }
    }

    for (final key in candidates) {
      final sub = _subs[key];
      if (sub == null) continue;
      // strfry's up-to-date rule: never re-check or double-send per event.
      if (!sub.upToDate.add(event.id)) continue;
      if (!sub.group.matches(event)) continue;
      _out.add(RelayFrame.event(sub.sessionId, sub.subId, event));
    }
  }

  // ── Live-monitor registration ─────────────────────────────────────────

  void _register(
    String key,
    String sessionId,
    String subId,
    CompiledFilterGroup group,
  ) {
    final indexedIn = <Set<String>>{};
    void add(Map<dynamic, Set<String>> index, dynamic value) {
      final set = index.putIfAbsent(value, () => <String>{})..add(key);
      indexedIn.add(set);
    }

    var constrained = false;
    for (final f in group.filters) {
      for (final a in f.authors ?? const <String>{}) {
        add(_byAuthor, a);
        constrained = true;
      }
      for (final k in f.kinds ?? const <int>{}) {
        add(_byKind, k);
        constrained = true;
      }
      f.tags?.forEach((name, values) {
        for (final v in values) {
          add(_byTag, '$name:${v.toLowerCase()}');
          constrained = true;
        }
      });
    }
    // A filter group with no field constraint anywhere (time-only) goes in
    // the catch-all set — every event is a candidate for it.
    if (!constrained) {
      _any.add(key);
      indexedIn.add(_any);
    }
    _subs[key] = _Subscription(
      sessionId: sessionId,
      subId: subId,
      group: group,
      indexedIn: indexedIn,
    );
  }

  Future<void> dispose() async {
    _subs.clear();
    _byAuthor.clear();
    _byKind.clear();
    _byTag.clear();
    _any.clear();
    await _out.close();
  }
}

class _Subscription {
  _Subscription({
    required this.sessionId,
    required this.subId,
    required this.group,
    required this.indexedIn,
  });

  final String sessionId;
  final String subId;
  final CompiledFilterGroup group;

  /// The inverted-index sets this sub is registered in (for O(1) teardown).
  final Set<Set<String>> indexedIn;

  /// Event ids this sub has already seen (initial query + live) — the
  /// up-to-date marker that prevents re-checks and double-sends.
  final Set<String> upToDate = <String>{};
}

/// A relay→client frame, rendered to NIP-01 JSON by the transport.
class RelayFrame {
  RelayFrame._(this.sessionId, this.type, this.payload);

  factory RelayFrame.event(String s, String subId, NostrEvent e) =>
      RelayFrame._(s, 'EVENT', ['EVENT', subId, e.toJson()]);
  factory RelayFrame.ok(String s, String id, bool ok, String msg) =>
      RelayFrame._(s, 'OK', ['OK', id, ok, msg]);
  factory RelayFrame.eose(String s, String subId) =>
      RelayFrame._(s, 'EOSE', ['EOSE', subId]);
  factory RelayFrame.closed(String s, String subId, String msg) =>
      RelayFrame._(s, 'CLOSED', ['CLOSED', subId, msg]);
  factory RelayFrame.notice(String s, String msg) =>
      RelayFrame._(s, 'NOTICE', ['NOTICE', msg]);

  final String sessionId;
  final String type;
  final List<dynamic> payload;

  String toJsonLine() => jsonEncode(payload);
}
