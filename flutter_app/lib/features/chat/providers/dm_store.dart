import 'package:flutter_riverpod/flutter_riverpod.dart';

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
  DmStore(this._ref);

  /// eventId → decrypted payload, for events we successfully decrypted.
  final Map<String, DecryptedDm> _decrypted = {};

  /// eventId → unit, for events we already tried and failed to decrypt
  /// (avoids re-decrypting on every rebuild).
  final Set<String> _undecryptable = {};

  /// Local outbox: peerPubkey → messages sent by us not yet seen on relays.
  final Map<String, List<ChatMessage>> _outbox = {};

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
  }

  /// Clear the outbox for a peer (e.g. on logout or manual resync).
  void clearOutbox(String peerPubkey) => _outbox.remove(peerPubkey);

  void clearAll() {
    _decrypted.clear();
    _undecryptable.clear();
    _outbox.clear();
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
        return;
      }
    }
  }
}

final dmStoreProvider = Provider<DmStore>((ref) => DmStore(ref));
