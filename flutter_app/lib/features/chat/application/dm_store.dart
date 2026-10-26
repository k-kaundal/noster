import 'dart:async';
import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nostrfeed_mobile/core/db/db_models.dart';
import 'package:nostrfeed_mobile/core/db/event_store.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/nostr/dm_crypto_worker.dart';
import 'package:nostrfeed_mobile/core/nostr/nostr_service.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Delivery status of an outgoing message.
enum MessageStatus {
  /// Created locally, publish in flight (or waiting to be retried).
  pending,

  /// At least one relay acknowledged the event.
  sent,

  /// No relay acknowledged it. Can be retried or discarded.
  failed,
}

/// A chat message ready for display — decrypted plaintext plus the metadata
/// the UI needs. Independent of how it arrived (relay event or local outbox).
class ChatMessage {
  final String id;
  final String text;

  /// The REAL sender (inner rumor pubkey for NIP-17; author for kind 4).
  final String senderPubkey;

  /// The REAL recipient (from the rumor 'p' tag for NIP-17).
  final String? recipientPubkey;

  final int createdAt;

  /// Delivery status. Relay-echoed messages are always [MessageStatus.sent].
  final MessageStatus status;

  /// The inner rumor kind: 14 = text, 15 = file message, 7 = reaction.
  final int rumorKind;

  /// For kind-15 file messages: the file's MIME type (`image/jpeg`).
  final String? mimeType;

  const ChatMessage({
    required this.id,
    required this.text,
    required this.senderPubkey,
    this.recipientPubkey,
    required this.createdAt,
    this.status = MessageStatus.sent,
    this.rumorKind = 14,
    this.mimeType,
  });

  /// True when this is a kind-15 file message.
  bool get isFile => rumorKind == 15;

  /// True when this file message is an image (renders inline in the bubble).
  bool get isImage => isFile && (mimeType?.startsWith('image/') ?? true);

  /// Back-compat shim for older call sites/tests.
  bool get isPending => status == MessageStatus.pending;

  ChatMessage copyWith({MessageStatus? status}) => ChatMessage(
        id: id,
        text: text,
        senderPubkey: senderPubkey,
        recipientPubkey: recipientPubkey,
        createdAt: createdAt,
        status: status ?? this.status,
        rumorKind: rumorKind,
        mimeType: mimeType,
      );
}

/// Central DM store: decrypts incoming DM events once, caches them, and
/// merges in a local outbox so the sender's own NIP-17 messages show up
/// immediately (a NIP-17 gift wrap cannot be decrypted by its sender, and
/// its timestamp is randomized up to 2 days back for privacy — so relying
/// on the relay round-trip alone makes sent messages vanish or sort wrong).
///
/// This IS a Riverpod [Notifier] (converted like `NotificationCenter`):
/// mutations emit a new [DmStoreState] via `state =` — NOT the old
/// `dmStoreVersionProvider` hand-poke. Watchers use
/// `dmStoreProvider.select(...)` for rebuild granularity.
class DmStore extends Notifier<DmStoreState> {
  /// Completes once the persisted outbox has been loaded from disk.
  /// Await this before reading [conversations] or [threadFor] after a cold
  /// start — otherwise the outbox is still empty and sent messages vanish.
  late final Future<void> ready;

  /// Bumped every time the outbox or decryption cache changes — kept for
  /// tests/diagnostics; the rebuild signal is [DmStoreState.version].
  int _version = 0;
  int get version => _version;

  @override
  DmStoreState build() {
    ready = Future.wait([_restoreOutbox(), _restoreLastRead()])
        .then((_) => _bump());
    return const DmStoreState();
  }

  void _bump() {
    _version++;
    state = DmStoreState(version: _version);
  }

  /// eventId → decrypted payload, for events we successfully decrypted.
  /// LRU-bounded (Dart Maps keep insertion order): on a heavy DM day these
  /// grew for the whole session; a miss just re-decrypts from the event.
  static const _maxCacheEntries = 500;
  final Map<String, DecryptedDm> _decrypted = {};

  /// eventId → unit, for events we already tried and failed to decrypt
  /// (avoids re-decrypting on every rebuild).
  final Set<String> _undecryptable = {};

  /// Local outbox: peerPubkey → messages sent by us not yet seen on relays.
  final Map<String, List<ChatMessage>> _outbox = {};

  /// Live events received via the real-time subscription (not from one-shot
  /// relay fetches): eventId → event.
  final Map<String, NostrEvent> _liveEvents = {};

  /// eventId → wall-clock arrival time (unix seconds) for live events.
  /// NIP-17 backdates timestamps up to 2 days for privacy, so the event's
  /// own created_at CANNOT be used for "is this new?" decisions — arrival
  /// time is the only honest signal for live deliveries.
  final Map<String, int> _arrivalTs = {};

  /// LRU touch + cap for [_decrypted]/[_liveEvents]/[_arrivalTs]: move the
  /// key to most-recently-used and evict the oldest past [_maxCacheEntries].
  void _cachePut<K, V>(Map<K, V> map, K key, V value) {
    map.remove(key);
    map[key] = value;
    while (map.length > _maxCacheEntries) {
      map.remove(map.keys.first);
    }
  }

  /// Ingest a DM event from the live subscription. Decrypts it, records
  /// arrival time, and bumps listeners (badge, banner, thread views).
  Future<void> ingest(NostrEvent event) async {
    if (event.kind != 4 && event.kind != 1059) return;
    if (_liveEvents.containsKey(event.id)) return;
    if (_decrypted.containsKey(event.id) || _undecryptable.contains(event.id)) {
      return;
    }
    _cachePut(_liveEvents, event.id, event);
    _cachePut(
      _arrivalTs,
      event.id,
      DateTime.now().millisecondsSinceEpoch ~/ 1000,
    );
    await prime([event]);
    _bump();
  }

  /// Re-arrival guard: when a thread is marked read, its already-known live
  /// events get their arrival time clamped to the watermark — so the live
  /// subscription re-delivering them moments later can't re-fire unread
  /// counts or notifications (the "opening chat re-notifies" bug).
  void _clampReadEvents(String peerPubkey, int watermark) {
    final auth = ref.read(authStateProvider);
    final myPubkey = auth.pubkey;
    if (myPubkey == null) return;
    for (final entry in _liveEvents.entries) {
      final e = entry.value;
      // Only events that involve this peer.
      final d = _decrypted[e.id];
      final involvesPeer = (e.kind == 1059 &&
              d != null &&
              (d.senderPubkey == peerPubkey ||
                  (d.senderPubkey == myPubkey &&
                      d.recipientPubkey == peerPubkey))) ||
          (e.kind == 4 &&
              ((e.pubkey == peerPubkey && e.getTag('p') == myPubkey) ||
                  (e.pubkey == myPubkey && e.getTag('p') == peerPubkey)));
      if (involvesPeer) {
        final arrival = _arrivalTs[e.id];
        if (arrival != null && arrival > watermark) {
          _arrivalTs[e.id] = watermark;
        }
      }
    }
  }

  /// All events known to the store: relay-fetched + live-ingested, deduped.
  List<NostrEvent> _withLive(List<NostrEvent> events) {
    if (_liveEvents.isEmpty) return events;
    final merged = List<NostrEvent>.of(events);
    final known = events.map((e) => e.id).toSet();
    for (final e in _liveEvents.values) {
      if (!known.contains(e.id)) merged.add(e);
    }
    return merged;
  }

  /// SharedPreferences key for the persisted outbox. NIP-17 gift wraps can
  /// never be re-fetched by their sender (encrypted to the recipient, signed
  /// by an ephemeral key), so this on-disk copy is the ONLY way our own sent
  /// messages survive an app restart.
  static const _outboxKey = 'dm_outbox_v1';

  /// SharedPreferences key for per-peer "last read" timestamps (unix seconds).
  /// Drives unread counts on the conversation list + the chat tab badge.
  static const _lastReadKey = 'dm_last_read_v1';

  /// peerPubkey → last-read timestamp (unix seconds).
  final Map<String, int> _lastRead = {};

  DecryptedDm? cached(String eventId) => _decrypted[eventId];

  /// Wall-clock arrival time for live-ingested events (null for
  /// relay-fetched ones). See [_arrivalTs] for why this exists.
  int? arrivalTsOf(String eventId) => _arrivalTs[eventId];

  /// Newest created_at among events we've already seen (live + decrypted) —
  /// the cursor for gap-fill queries. On resume we ask relays for DMs NEWER
  /// than this so nothing sent while the app was dead is missed, without
  /// re-replaying a frozen window. 0 = cold start (use a bounded lookback).
  int get newestSeenTs {
    var newest = 0;
    for (final e in _liveEvents.values) {
      if (e.createdAt > newest) newest = e.createdAt;
    }
    for (final id in _decrypted.keys) {
      final e = _liveEvents[id];
      if (e != null && e.createdAt > newest) newest = e.createdAt;
    }
    return newest;
  }

  /// How many DM events the live subscription has delivered this session —
  /// used to detect "subscription silently died" (0 while relays claim to be
  /// connected = the gap-fill query becomes the safety net).
  int get liveEventCount => _liveEvents.length;

  /// Ingest a batch from a one-shot gap-fill query (unlike [ingest], these
  /// are relay-fetched, so they only get an arrival stamp when genuinely
  /// recent — the backfill guard in the notifier handles the rest).
  Future<void> ingestBatch(List<NostrEvent> events) async {
    var added = 0;
    for (final e in events) {
      if (e.kind != 4 && e.kind != 1059) continue;
      if (_liveEvents.containsKey(e.id)) continue;
      if (_decrypted.containsKey(e.id) || _undecryptable.contains(e.id)) {
        continue;
      }
      _cachePut(_liveEvents, e.id, e);
      added++;
    }
    if (added > 0) {
      await prime(events);
      _bump();
    }
  }

  /// The last-read watermark for a peer (0 = nothing read yet).
  int lastReadFor(String peerPubkey) => _lastRead[peerPubkey] ?? 0;

  /// True when [eventId] arrived (or was created) after the peer's last-read
  /// watermark — i.e. it genuinely counts as "new" for notifications.
  bool isUnreadFrom(String peerPubkey, NostrEvent event, int eventTs) {
    final effective = _arrivalTs[event.id] ?? eventTs;
    return effective > (_lastRead[peerPubkey] ?? 0);
  }

  // ── Read tracking / unread counts ──────────────────────────────────

  /// Mark every message in the thread with [peerPubkey] as read.
  ///
  /// Uses the newest message timestamp in the thread (not wall-clock now):
  /// a NIP-17 message can carry a randomized backdated timestamp, and a
  /// wall-clock watermark would leave it "unread" forever.
  Future<void> markThreadRead(String peerPubkey, {int? latestKnownTs}) async {
    // Watermark = wall clock now MINUS 1s. Timestamps are second-precision:
    // a message arriving in the same second as the read marker must count
    // as unread (strictly-greater comparison would hide it). 1s of slack is
    // invisible to users but makes the read/unread boundary correct.
    var watermark = DateTime.now().millisecondsSinceEpoch ~/ 1000 - 1;
    if (latestKnownTs != null && latestKnownTs > watermark) {
      // A3: clamp to now — a NIP-17 rumor can carry a skewed/future
      // timestamp; a future `latestKnownTs` must not pin the watermark into
      // the future (genuinely-new messages after it would never count unread).
      final nowSec = DateTime.now().millisecondsSinceEpoch ~/ 1000;
      watermark = latestKnownTs > nowSec ? nowSec : latestKnownTs;
    }
    final existing = _lastRead[peerPubkey] ?? 0;
    if (watermark <= existing) return;
    _lastRead[peerPubkey] = watermark;
    // Cap watermarks to the most recent peers — an old peer's unread count
    // just resets to "all unread" (safe: the user re-reads on open), and the
    // map no longer grows one entry per DM peer forever.
    while (_lastRead.length > 200) {
      _lastRead.remove(_lastRead.keys.first);
    }
    // Clamp known live events to the watermark so the live subscription
    // re-delivering them can't re-fire unread counts or notifications.
    _clampReadEvents(peerPubkey, watermark);
    _bump();
    // ADR-0008 P1: persist the watermark to `dm_threads` (durable, replaces
    // the SharedPreferences JSON map) AND reset the thread's unread count.
    unawaited(
      EventStore.instance
          .markDmThreadRead(peerPubkey, watermark)
          .catchError((_) {}),
    );
    // Debounced legacy write (kept for one release so old installs + the
    // in-session map stay consistent; the store is now the durable copy).
    _lastReadWriteTimer?.cancel();
    _lastReadWriteTimer = Timer(_writeDebounce, () async {
      try {
        final prefs = await SharedPreferences.getInstance();
        final json = _lastRead.map((k, v) => MapEntry(k, v.toString()));
        await prefs.setString(_lastReadKey, jsonEncode(json));
      } catch (_) {}
    });
  }

  /// The effective "when did this message reach us" timestamp for unread
  /// decisions: arrival time for live events (NIP-17 backdates created_at),
  /// created_at for historically-fetched events.
  int _effectiveTs(NostrEvent e, int eventTs) =>
      _arrivalTs[e.id] ?? eventTs;

  /// Unread incoming messages from [peerPubkey] (excludes my own messages
  /// and anything at/before the last-read timestamp).
  int unreadFor(List<NostrEvent> events, String peerPubkey) {
    final auth = ref.read(authStateProvider);
    final myPubkey = auth.pubkey;
    if (myPubkey == null) return 0;
    events = _withLive(events);
    final lastRead = _lastRead[peerPubkey] ?? 0;
    var count = 0;
    for (final e in events) {
      if (e.kind == 1059) {
        final d = _decrypted[e.id];
        if (d == null) continue;
        if (d.senderPubkey == peerPubkey &&
            _effectiveTs(e, d.createdAt) > lastRead) {
          count++;
        }
      } else if (e.kind == 4) {
        if (e.pubkey == peerPubkey &&
            e.getTag('p') == myPubkey &&
            _effectiveTs(e, e.createdAt) > lastRead) {
          count++;
        }
      }
    }
    return count;
  }

  /// Total unread across all conversations — drives the chat tab badge.
  int totalUnread(List<NostrEvent> events) {
    final auth = ref.read(authStateProvider);
    if (auth.pubkey == null) return 0;
    var total = 0;
    for (final c in conversations(events)) {
      total += unreadFor(events, c.peer);
    }
    return total;
  }

  Future<void> _restoreLastRead() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_lastReadKey);
      if (raw == null || raw.isEmpty) return;
      final json = jsonDecode(raw) as Map<String, dynamic>;
      _lastRead.clear();
      for (final e in json.entries) {
        final ts = int.tryParse(e.value.toString());
        if (ts != null) _lastRead[e.key] = ts;
      }
    } catch (_) {}
  }

  /// Decrypt all DM events we haven't processed yet.
  ///
  /// ADR-0008 P1: the NIP-44/NIP-04 crypto now runs OFF the UI isolate (the
  /// [DmCryptoWorker] pool) — a gap-fill of 50 gift-wraps is ~100 sequential
  /// NIP-44 decryptions that used to block the frame thread even with the
  /// old time-slicing (the "chat is janky after opening" freeze). Each
  /// decrypted message is ALSO persisted to `dm_messages` (device-only
  /// plaintext, like Signal's local DB), so a cold start re-reads the store
  /// instead of re-decrypting everything.
  Future<void> prime(List<NostrEvent> events) async {
    final auth = ref.read(authStateProvider);
    if (auth.pubkey == null || auth.privateKey == null) return;
    final myPubkey = auth.pubkey!;
    final privateKey = auth.privateKey!;

    // Collect the events that actually need decrypting (skip cached/failed).
    final todo = <NostrEvent>[];
    for (final e in events) {
      if (e.kind != 1059 && e.kind != 4) continue;
      if (_decrypted.containsKey(e.id) || _undecryptable.contains(e.id)) {
        continue;
      }
      todo.add(e);
    }
    if (todo.isEmpty) return;

    // Decrypt the batch OFF the UI isolate (2 worker isolates, round-robin).
    final worker = DmCryptoWorker.instance;
    final results = await Future.wait([
      for (final e in todo)
        worker.decrypt(
          DmDecryptJob(
            eventId: e.id,
            kind: e.kind,
            pubkey: e.pubkey,
            content: e.content,
            createdAt: e.createdAt,
            tags: e.tags,
            privateKey: privateKey,
            myPubkey: myPubkey,
          ),
        ),
    ]);

    for (var i = 0; i < todo.length; i++) {
      final e = todo[i];
      final r = results[i];
      if (r == null) {
        _undecryptable.add(e.id);
        while (_undecryptable.length > _maxCacheEntries) {
          _undecryptable.remove(_undecryptable.first);
        }
        continue;
      }
      // Map the worker result onto the session's DecryptedDm cache (the UI
      // reads this in-memory shape today).
      final d = DecryptedDm(
        plaintext: r.plaintext,
        senderPubkey: r.senderPubkey,
        recipientPubkey: r.recipientPubkey,
        createdAt: r.createdAt,
        rumorKind: r.rumorKind,
        tags: r.tags,
      );
      _cachePut(_decrypted, e.id, d);
      // First-seen time for relay-fetched NIP-17 messages (backdated rumor
      // ts — without an arrival stamp a fresh message sorts as "2d ago").
      // Only stamp for messages from OTHERS (mine show from the outbox).
      if (e.kind == 1059 &&
          d.senderPubkey != myPubkey &&
          !_arrivalTs.containsKey(e.id)) {
        _cachePut(
          _arrivalTs,
          e.id,
          DateTime.now().millisecondsSinceEpoch ~/ 1000,
        );
      }
      // Persist the plaintext to the store (device-only) — the durable copy
      // that survives restart (the session cache is a 500-entry LRU).
      unawaited(_persistMessage(e, r, myPubkey));
      // A wrap we CAN decrypt that was sent BY us means the peer echoed our
      // own message back — clear the matching outbox entry.
      _reconcileOutbox(d.senderPubkey, d.plaintext, d.createdAt);
      _bump();
    }
  }

  /// Persist one decrypted DM into `dm_messages` (fire-and-forget on the
  /// writer lane). Direction is derived: sender == me → outgoing, else
  /// incoming. Display timestamp mirrors the threadFor rule (arrival time
  /// for live events, rumor time for history).
  Future<void> _persistMessage(
    NostrEvent e,
    DmDecryptResult r,
    String myPubkey,
  ) async {
    final outgoing = r.senderPubkey == myPubkey;
    final peer = outgoing
        ? (r.recipientPubkey ?? r.senderPubkey)
        : r.senderPubkey;
    if (peer.isEmpty) return;
    final msg = DbMessage(
      id: e.id,
      peer: peer,
      direction: outgoing ? DbDmDirection.outgoing : DbDmDirection.incoming,
      content: r.plaintext,
      createdAt: _arrivalTs[e.id] ?? r.createdAt,
      rawId: e.id,
      wrapKind: e.kind,
      rumorKind: r.rumorKind,
      status: DbMessageStatus.sent,
      mimeType: r.mimeType,
    );
    try {
      await EventStore.instance.upsertDmMessage(msg);
    } catch (_) {
      // Persistence is best-effort — the session cache still shows the msg.
    }
  }

  /// Messages exchanged with [peerPubkey], sorted newest-first.
  /// Combines decrypted relay events + live events + local outbox.
  List<ChatMessage> threadFor(List<NostrEvent> events, String peerPubkey) {
    final auth = ref.read(authStateProvider);
    final myPubkey = auth.pubkey;
    if (myPubkey == null) return const [];

    events = _withLive(events);
    final messages = <ChatMessage>[];
    for (final e in events) {
      if (e.kind == 1059) {
        final d = _decrypted[e.id];
        if (d == null) continue;
        // Conversation membership: between me and the peer, in either direction.
        // For messages TO us: senderPubkey == peerPubkey.
        // For messages FROM us: senderPubkey == myPubkey AND recipientPubkey == peerPubkey.
        final fromThem = d.senderPubkey == peerPubkey;
        final fromMe = d.senderPubkey == myPubkey &&
            (d.recipientPubkey == peerPubkey || d.recipientPubkey == null);
        if (!fromThem && !fromMe) continue;
        // Skip my own relay-echoed message if we already show it from the outbox.
        if (fromMe && _isInOutbox(peerPubkey, d.plaintext)) continue;
        messages.add(
          ChatMessage(
            id: e.id,
            text: d.plaintext,
            senderPubkey: d.senderPubkey,
            recipientPubkey: d.recipientPubkey,
            // Display time: live events show ARRIVAL time (NIP-17 backdates
            // created_at up to 2 days for privacy — a message that just
            // arrived would show "2d ago" otherwise). Relay history keeps
            // its real (approximate) rumor time.
            createdAt: _arrivalTs[e.id] ?? d.createdAt,
            rumorKind: d.rumorKind,
            mimeType: d.mimeType,
          ),
        );
      } else if (e.kind == 4) {
        final fromMe = e.pubkey == myPubkey && e.getTag('p') == peerPubkey;
        final fromThem = e.pubkey == peerPubkey && e.getTag('p') == myPubkey;
        if (!fromMe && !fromThem) continue;
        final d = _decrypted[e.id];
        messages.add(
          ChatMessage(
            id: e.id,
            text: d?.plaintext ?? '',
            senderPubkey: e.pubkey,
            recipientPubkey: e.getTag('p'),
            // Live events show arrival time (see note on the 1059 branch).
            createdAt: _arrivalTs[e.id] ?? e.createdAt,
          ),
        );
      }
    }

    // Merge the local outbox for this peer (my sent-but-not-yet-echoed).
    final outbox = _outbox[peerPubkey] ?? const [];
    messages.addAll(outbox);

    messages.sort((a, b) => b.createdAt.compareTo(a.createdAt));
    return messages;
  }

  /// Group DM events into conversations keyed by REAL peer pubkey.
  /// Returns (peerPubkey, latest event, latest decrypted payload if known).
  List<({String peer, NostrEvent lastEvent, DecryptedDm? decrypted})>
  conversations(List<NostrEvent> events) {
    final auth = ref.read(authStateProvider);
    final myPubkey = auth.pubkey;
    if (myPubkey == null) return const [];

    events = _withLive(events);
    final map =
        <String, ({NostrEvent lastEvent, DecryptedDm? decrypted, int ts})>{};
    for (final e in events) {
      String peer = '';
      DecryptedDm? decrypted;
      var ts = e.createdAt;
      if (e.kind == 1059) {
        decrypted = _decrypted[e.id];
        if (decrypted == null) continue;
        // Determine the peer for this conversation. For messages TO us, the
        // peer is the sender. For messages FROM us (our own NIP-17 copy),
        // the peer is the recipient — use the rumor's p-tag.
        if (decrypted.senderPubkey == myPubkey) {
          peer = decrypted.recipientPubkey ?? decrypted.senderPubkey;
        } else {
          peer = decrypted.senderPubkey;
        }
        ts = decrypted.createdAt;
      } else if (e.kind == 4) {
        decrypted = _decrypted[e.id];
        peer = e.pubkey == myPubkey ? e.getTag('p') ?? '' : e.pubkey;
        // If we couldn't decrypt, still show the conversation with a lock
        // preview — the peer is knowable from the event itself, so a failed
        // decrypt shouldn't make the whole conversation disappear.
        decrypted ??= DecryptedDm(
          plaintext: '',
          senderPubkey: peer,
          createdAt: e.createdAt,
        );
      }
      if (peer.isEmpty) continue;
      final existing = map[peer];
      if (existing == null || ts > existing.ts) {
        map[peer] = (lastEvent: e, decrypted: decrypted, ts: ts);
      }
    }
    // Include outbox-only peers (we messaged them, nothing on relays yet).
    for (final entry in _outbox.entries) {
      if (entry.value.isEmpty || map.containsKey(entry.key)) continue;
      final last = entry.value.first; // newest first
      map[entry.key] = (
        lastEvent: NostrEvent(
          id: last.id,
          pubkey: myPubkey,
          createdAt: last.createdAt,
          kind: 1059,
          tags: const [],
          content: '',
          sig: '',
        ),
        decrypted: DecryptedDm(
          plaintext: last.text,
          senderPubkey: myPubkey,
          createdAt: last.createdAt,
        ),
        ts: last.createdAt,
      );
    }
    final list = map.entries
        .map(
          (e) => (
            peer: e.key,
            lastEvent: e.value.lastEvent,
            decrypted: e.value.decrypted,
          ),
        )
        .toList();
    list.sort((a, b) {
      final ats = a.decrypted?.createdAt ?? a.lastEvent.createdAt;
      final bts = b.decrypted?.createdAt ?? b.lastEvent.createdAt;
      return bts.compareTo(ats);
    });
    return list;
  }

  /// Record a message we just sent so it renders immediately, before the
  /// relay echo arrives. Returns the local message id so the caller can
  /// flip its status via [markStatus] once the publish ack resolves.
  ///
  /// ADR-0008 P1: ALSO persisted to `dm_messages` (pending) so the sent
  /// message survives restart — the old SharedPreferences outbox was the
  /// only copy and aged out after 7 days.
  String recordSent({
    required String peerPubkey,
    required String plaintext,
    required String eventId,
  }) {
    final auth = ref.read(authStateProvider);
    if (auth.pubkey == null) return '';
    final now = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    final msg = ChatMessage(
      id: 'local-$eventId',
      text: plaintext,
      senderPubkey: auth.pubkey!,
      recipientPubkey: peerPubkey,
      createdAt: now,
      status: MessageStatus.pending,
    );
    _outbox.putIfAbsent(peerPubkey, () => []).insert(0, msg);
    _persistOutbox();
    _bump();
    // Persist the pending outgoing message (device-only plaintext).
    unawaited(_persistOutgoing(
      peerPubkey: peerPubkey,
      localId: msg.id,
      plaintext: plaintext,
      createdAt: now,
      status: DbMessageStatus.pending,
    ));
    return msg.id;
  }

  Future<void> _persistOutgoing({
    required String peerPubkey,
    required String localId,
    required String plaintext,
    required int createdAt,
    required DbMessageStatus status,
  }) async {
    try {
      await EventStore.instance.upsertDmMessage(
        DbMessage(
          id: localId,
          peer: peerPubkey,
          direction: DbDmDirection.outgoing,
          content: plaintext,
          createdAt: createdAt,
          wrapKind: 1059,
          rumorKind: 14,
          status: status,
        ),
      );
    } catch (_) {}
  }

  /// Update the delivery status of an outbox message (after publish ack).
  void markStatus(String peerPubkey, String messageId, MessageStatus status) {
    final list = _outbox[peerPubkey];
    if (list == null) return;
    final idx = list.indexWhere((m) => m.id == messageId);
    if (idx < 0) return;
    list[idx] = list[idx].copyWith(status: status);
    _persistOutbox();
    _bump();
    // Mirror the status into the durable store.
    final dbStatus = switch (status) {
      MessageStatus.sent => DbMessageStatus.sent,
      MessageStatus.failed => DbMessageStatus.failed,
      MessageStatus.pending => DbMessageStatus.pending,
    };
    unawaited(
      EventStore.instance
          .updateDmMessageStatus(messageId, dbStatus)
          .catchError((_) {}),
    );
  }

  /// Flag an outbox entry as a kind-15 file message so the bubble renders it
  /// as an image/file chip instead of a raw URL. The outbox stores the file
  /// URL as its text; this just marks the type.
  void markFileMessage(String peerPubkey, String messageId,
      {String? mimeType}) {
    final list = _outbox[peerPubkey];
    if (list == null) return;
    final idx = list.indexWhere((m) => m.id == messageId);
    if (idx < 0) return;
    final m = list[idx];
    list[idx] = ChatMessage(
      id: m.id,
      text: m.text,
      senderPubkey: m.senderPubkey,
      recipientPubkey: m.recipientPubkey,
      createdAt: m.createdAt,
      status: m.status,
      rumorKind: 15,
      mimeType: mimeType,
    );
    _persistOutbox();
    _bump();
  }

  /// Remove a pending message from the outbox (e.g. publish failed and the
  /// user discarded it).
  void removePending(String peerPubkey, String messageId) {
    final list = _outbox[peerPubkey];
    if (list == null) return;
    list.removeWhere((m) => m.id == messageId);
    if (list.isEmpty) _outbox.remove(peerPubkey);
    _persistOutbox();
    _bump();
    unawaited(EventStore.instance.removeDmOutbox(messageId).catchError((_) {}));
  }

  /// Clear the outbox for a peer (e.g. on logout or manual resync).
  void clearOutbox(String peerPubkey) {
    _outbox.remove(peerPubkey);
    _persistOutbox();
    _bump();
  }

  // ── Outbox persistence ─────────────────────────────────────────────

  /// Writes are DEBOUNCED: `recordSent`/`markStatus`/`markFileMessage`/
  /// `removePending` each call [_persistOutbox], and every one used to write
  /// the ENTIRE outbox JSON — sending 5 messages was 5 full-map writes.
  /// Batching bursts into one write per window kills the amplification.
  /// The in-memory state is always current, so the disk write can lag.
  Timer? _outboxWriteTimer;
  Timer? _lastReadWriteTimer;
  static const _writeDebounce = Duration(milliseconds: 500);

  void _persistOutbox() {
    _outboxWriteTimer?.cancel();
    _outboxWriteTimer = Timer(_writeDebounce, _writeOutboxNow);
  }

  Future<void> _writeOutboxNow() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final json = _outbox.map(
        (peer, msgs) => MapEntry(
          peer,
          msgs
              .map((m) => {
                    'id': m.id,
                    'text': m.text,
                    'senderPubkey': m.senderPubkey,
                    'recipientPubkey': m.recipientPubkey,
                    'createdAt': m.createdAt,
                    'status': m.status.name,
                    'rumorKind': m.rumorKind,
                    if (m.mimeType != null) 'mimeType': m.mimeType,
                  })
              .toList(),
        ),
      );
      await prefs.setString(_outboxKey, jsonEncode(json));
    } catch (_) {
      // Persistence is best-effort — never crash the send flow over it.
    }
  }

  Future<void> _restoreOutbox() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_outboxKey);
      if (raw == null || raw.isEmpty) return;
      final json = jsonDecode(raw) as Map<String, dynamic>;
      _outbox.clear();
      // Drop pending messages older than 7 days — if no relay has accepted
      // them by now they never will, and keeping them forever would show
      // phantom "sending…" messages.
      final cutoff =
          DateTime.now().millisecondsSinceEpoch ~/ 1000 - 7 * 24 * 3600;
      for (final entry in json.entries) {
        final msgs = (entry.value as List)
            .map(
              (m) => ChatMessage(
                id: m['id'] as String,
                text: m['text'] as String,
                senderPubkey: m['senderPubkey'] as String,
                recipientPubkey: m['recipientPubkey'] as String?,
                createdAt: m['createdAt'] as int,
                // Messages restored from disk that never got an ack are shown
                // as failed (not pending) so the user can retry or delete.
                status: switch (m['status'] as String?) {
                  'sent' => MessageStatus.sent,
                  'failed' => MessageStatus.failed,
                  // Legacy entries had no status; they never confirmed.
                  _ => MessageStatus.failed,
                },
                rumorKind: (m['rumorKind'] as num?)?.toInt() ?? 14,
                mimeType: m['mimeType'] as String?,
              ),
            )
            .where((m) => m.createdAt > cutoff)
            .toList();
        if (msgs.isNotEmpty) _outbox[entry.key] = msgs;
      }
    } catch (_) {
      // Corrupted/outdated store — start with an empty outbox.
    }
  }

  /// Full wipe on logout / account switch — decrypted cache, outbox, live
  /// events, arrival times, per-peer read watermarks, AND the durable store
  /// tables. Without this the next account on this device inherited the
  /// previous one's DM state (cross-account leak: Bob saw Alice's chats).
  void clearAll() {
    _decrypted.clear();
    _undecryptable.clear();
    _liveEvents.clear();
    _arrivalTs.clear();
    _lastRead.clear();
    _outbox.clear();
    _persistOutbox();
    SharedPreferences.getInstance()
        .then((prefs) => prefs.remove(_lastReadKey))
        .ignore();
    // Wipe the durable messaging tables too (device-only plaintext).
    unawaited(EventStore.instance.clearDmData().catchError((_) {}));
  }

  bool _isInOutbox(String peerPubkey, String plaintext) {
    final outbox = _outbox[peerPubkey];
    if (outbox == null) return false;
    return outbox.any((m) => m.text == plaintext);
  }

  void _reconcileOutbox(String senderPubkey, String plaintext, int createdAt) {
    final auth = ref.read(authStateProvider);
    if (senderPubkey != auth.pubkey) return;
    // Find which peer this was to and drop the matching pending message.
    for (final entry in _outbox.entries) {
      final idx = entry.value.indexWhere((m) => m.text == plaintext);
      if (idx >= 0) {
        final localId = entry.value[idx].id; // 'local-{eventId}'
        entry.value.removeAt(idx);
        _persistOutbox();
        // A4: also drop the durable `local-` pending row — the real event
        // (self-copy echo) is now the source of truth, so the optimistic
        // pending row must not linger as a stuck duplicate.
        unawaited(
          EventStore.instance.deleteLocalPendingDm(localId).catchError((_) {}),
        );
        return;
      }
    }
  }
}

/// Immutable snapshot emitted on every store mutation. `version` is
/// monotonic — watchers use it as the rebuild signal (equivalent to the
/// old `dmStoreVersionProvider`, minus the manual poke).
class DmStoreState {
  final int version;
  const DmStoreState({this.version = 0});
}

final dmStoreProvider = NotifierProvider<DmStore, DmStoreState>(
  DmStore.new,
);

/// Real-time DM subscription: streams incoming kind 4 (NIP-04) and kind 1059
/// (NIP-17) events p-tagged to the current user from ALL connected relays.
/// Without this, messages only appear on manual refresh — the "message sent
/// from Primal never shows up" bug.
///
/// ADR-0005: shared EventBus (acquire → local filter), not a raw sub.
final dmLiveEventsProvider = StreamProvider.autoDispose<NostrEvent>((ref) {
  final auth = ref.watch(authStateProvider);
  if (!auth.isLoggedIn || auth.pubkey == null) return const Stream.empty();
  final nostr = ref.watch(nostrServiceProvider);
  if (!nostr.isInitialized) return const Stream.empty();
  // `since` slightly in the past so events sent just before opening the app
  // (while relays were still connecting) aren't missed. Deduped in DmStore.
  final since =
      DateTime.now().millisecondsSinceEpoch ~/ 1000 - 6 * 3600; // 6h back
  final spec = [
    NostrFilter(
      kinds: [4, 1059],
      tagFilters: {
        'p': [auth.pubkey!],
      },
      since: since,
    ),
  ];
  final bus = ref.watch(eventBusProvider);
  final handle = bus.acquire(spec);
  ref.onDispose(handle.dispose);
  return bus.stream.where(spec.matchesAny);
});

/// Wires the live subscription into the store. Watch this once at the app
/// root (app.dart) — it ingests every incoming DM into [DmStore], which
/// then drives banners, badges, and thread updates reactively.
final dmLiveListenerProvider = Provider<void>((ref) {
  ref.listen(dmLiveEventsProvider, (_, next) {
    next.whenData((event) {
      ref.read(dmStoreProvider.notifier).ingest(event);
    });
  });
});

/// Version counter for [DmStore] mutations — kept as a thin shim so
/// existing watchers (`ref.watch(dmStoreVersionProvider)`) keep compiling
/// while they migrate to `dmStoreProvider` directly. New code watches
/// `dmStoreProvider` (the Notifier state) or a `.select` on it.
final dmStoreVersionProvider = Provider<int>((ref) {
  return ref.watch(dmStoreProvider.select((s) => s.version));
});

/// Reactive conversation list: combines relay DM events + outbox, decrypts
/// once, and rebuilds only when the underlying data changes.
///
/// This is a FutureProvider so it can await the async decryption. It watches
/// BOTH [dmsProvider] (relay events) and [dmStoreProvider] (outbox /
/// decryption cache mutations) so any change re-evaluates the future and
/// the UI rebuilds with the latest conversations.
final conversationListProvider =
    FutureProvider.autoDispose<List<({String peer, NostrEvent lastEvent, DecryptedDm? decrypted})>>(
        (ref) async {
  final events = await ref.watch(dmsProvider.future);
  // Watch the store state so this provider re-evaluates when the outbox or
  // decryption cache changes (e.g. after sending a message, or when prime()
  // finishes decrypting a batch of incoming DMs).
  ref.watch(dmStoreProvider);
  final store = ref.read(dmStoreProvider.notifier);
  await store.ready;
  await store.prime(events);
  return store.conversations(events);
});
