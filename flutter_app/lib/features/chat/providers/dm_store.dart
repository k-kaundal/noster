import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/nostr/nostr_service.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';

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

  /// True while the message only exists locally (waiting for relay echo).
  final bool isPending;

  const ChatMessage({
    required this.id,
    required this.text,
    required this.senderPubkey,
    this.recipientPubkey,
    required this.createdAt,
    this.isPending = false,
  });
}

/// Central DM store: decrypts incoming DM events once, caches them, and
/// merges in a local outbox so the sender's own NIP-17 messages show up
/// immediately (a NIP-17 gift wrap cannot be decrypted by its sender, and
/// its timestamp is randomized up to 2 days back for privacy — so relying
/// on the relay round-trip alone makes sent messages vanish or sort wrong).
class DmStore {
  final Ref _ref;

  /// Completes once the persisted outbox has been loaded from disk.
  /// Await this before reading [conversations] or [threadFor] after a cold
  /// start — otherwise the outbox is still empty and sent messages vanish.
  late final Future<void> ready;

  /// Bumped every time the outbox or decryption cache changes. The UI
  /// watches [dmStoreVersionProvider] to rebuild threads/conversation lists
  /// reactively (e.g. right after sending a message).
  int _version = 0;
  int get version => _version;

  DmStore(this._ref) {
    ready = _restoreOutbox().then((_) => _bump());
  }

  void _bump() {
    _version++;
    _ref.read(dmStoreVersionProvider.notifier).state = _version;
  }

  /// eventId → decrypted payload, for events we successfully decrypted.
  final Map<String, DecryptedDm> _decrypted = {};

  /// eventId → unit, for events we already tried and failed to decrypt
  /// (avoids re-decrypting on every rebuild).
  final Set<String> _undecryptable = {};

  /// Local outbox: peerPubkey → messages sent by us not yet seen on relays.
  final Map<String, List<ChatMessage>> _outbox = {};

  /// SharedPreferences key for the persisted outbox. NIP-17 gift wraps can
  /// never be re-fetched by their sender (encrypted to the recipient, signed
  /// by an ephemeral key), so this on-disk copy is the ONLY way our own sent
  /// messages survive an app restart.
  static const _outboxKey = 'dm_outbox_v1';

  DecryptedDm? cached(String eventId) => _decrypted[eventId];

  /// Decrypt all DM events we haven't processed yet.
  Future<void> prime(List<NostrEvent> events) async {
    final nostr = _ref.read(nostrServiceProvider);
    final auth = _ref.read(authStateProvider);
    if (auth.pubkey == null) return;

    for (final e in events) {
      if (_decrypted.containsKey(e.id) || _undecryptable.contains(e.id)) {
        continue;
      }
      if (e.kind == 1059 || e.kind == 4) {
        final d = await nostr.decryptDm(e);
        if (d == null) {
          _undecryptable.add(e.id);
          continue;
        }
        _decrypted[e.id] = d;
        // A wrap we CAN decrypt that was sent BY us means the peer echoed our
        // own message back (some relay setups) — clear matching outbox entry.
        _reconcileOutbox(d.senderPubkey, d.plaintext, d.createdAt);
        _bump();
      }
    }
  }

  /// Messages exchanged with [peerPubkey], sorted newest-first.
  /// Combines decrypted relay events + local outbox.
  List<ChatMessage> threadFor(List<NostrEvent> events, String peerPubkey) {
    final auth = _ref.read(authStateProvider);
    final myPubkey = auth.pubkey;
    if (myPubkey == null) return const [];

    final messages = <ChatMessage>[];
    for (final e in events) {
      if (e.kind == 1059) {
        final d = _decrypted[e.id];
        if (d == null) continue;
        // Conversation membership: between me and the peer, in either direction.
        final fromThem = d.senderPubkey == peerPubkey;
        final fromMe = d.senderPubkey == myPubkey;
        if (!fromThem && !fromMe) continue;
        // Skip my own relay-echoed message if we already show it from the outbox.
        if (fromMe && _isInOutbox(peerPubkey, d.plaintext)) continue;
        messages.add(
          ChatMessage(
            id: e.id,
            text: d.plaintext,
            senderPubkey: d.senderPubkey,
            createdAt: d.createdAt,
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
            createdAt: e.createdAt,
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
    final auth = _ref.read(authStateProvider);
    final myPubkey = auth.pubkey;
    if (myPubkey == null) return const [];

    final map =
        <String, ({NostrEvent lastEvent, DecryptedDm? decrypted, int ts})>{};
    for (final e in events) {
      String peer = '';
      DecryptedDm? decrypted;
      var ts = e.createdAt;
      if (e.kind == 1059) {
        decrypted = _decrypted[e.id];
        if (decrypted == null) continue;
        peer = decrypted.senderPubkey;
        ts = decrypted.createdAt;
      } else if (e.kind == 4) {
        decrypted = _decrypted[e.id];
        peer = e.pubkey == myPubkey ? e.getTag('p') ?? '' : e.pubkey;
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
  /// relay echo arrives. Call with the plaintext and the peer's pubkey.
  void recordSent({
    required String peerPubkey,
    required String plaintext,
    required String eventId,
  }) {
    final auth = _ref.read(authStateProvider);
    if (auth.pubkey == null) return;
    final msg = ChatMessage(
      id: 'local-$eventId',
      text: plaintext,
      senderPubkey: auth.pubkey!,
      recipientPubkey: peerPubkey,
      createdAt: DateTime.now().millisecondsSinceEpoch ~/ 1000,
      isPending: true,
    );
    _outbox.putIfAbsent(peerPubkey, () => []).insert(0, msg);
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
  }

  /// Clear the outbox for a peer (e.g. on logout or manual resync).
  void clearOutbox(String peerPubkey) {
    _outbox.remove(peerPubkey);
    _persistOutbox();
    _bump();
  }

  // ── Outbox persistence ─────────────────────────────────────────────

  Future<void> _persistOutbox() async {
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
                isPending: true,
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

  void clearAll() {
    _decrypted.clear();
    _undecryptable.clear();
    _outbox.clear();
    _persistOutbox();
  }

  bool _isInOutbox(String peerPubkey, String plaintext) {
    final outbox = _outbox[peerPubkey];
    if (outbox == null) return false;
    return outbox.any((m) => m.text == plaintext);
  }

  void _reconcileOutbox(String senderPubkey, String plaintext, int createdAt) {
    final auth = _ref.read(authStateProvider);
    if (senderPubkey != auth.pubkey) return;
    // Find which peer this was to and drop the matching pending message.
    for (final entry in _outbox.entries) {
      final idx = entry.value.indexWhere((m) => m.text == plaintext);
      if (idx >= 0) {
        entry.value.removeAt(idx);
        _persistOutbox();
        return;
      }
    }
  }
}

final dmStoreProvider = Provider<DmStore>((ref) => DmStore(ref));

/// Version counter for [DmStore] mutations. Widgets watch this to rebuild
/// threads/conversation lists reactively when the outbox or decryption cache
/// changes (e.g. right after sending a message).
final dmStoreVersionProvider = StateProvider<int>((ref) => 0);

/// Reactive conversation list: combines relay DM events + outbox, decrypts
/// once, and rebuilds only when the underlying data changes — no FutureBuilder
/// flicker in the UI.
final conversationListProvider =
    FutureProvider.autoDispose<List<({String peer, NostrEvent lastEvent, DecryptedDm? decrypted})>>(
        (ref) async {
  final events = await ref.watch(dmsProvider.future);
  final store = ref.read(dmStoreProvider);
  await store.ready;
  await store.prime(events);
  // Watch the version so this provider re-evaluates when the outbox changes.
  ref.watch(dmStoreVersionProvider);
  return store.conversations(events);
});
