import 'dart:async';
import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// A relay the user manages: its URL plus read/write intent.
class ManagedRelay {
  final String url;
  final bool read;
  final bool write;

  const ManagedRelay(this.url, {this.read = true, this.write = true});

  ManagedRelay copyWith({bool? read, bool? write}) =>
      ManagedRelay(url, read: read ?? this.read, write: write ?? this.write);

  Map<String, dynamic> toJson() => {'url': url, 'read': read, 'write': write};

  factory ManagedRelay.fromJson(Map<String, dynamic> json) => ManagedRelay(
        json['url'] as String,
        read: json['read'] as bool? ?? true,
        write: json['write'] as bool? ?? true,
      );
}

/// NIP-65 relay list metadata kind (addressable, `r` tags with read/write
/// markers). Publishing it lets every client see the same relay set.
const relayListKind = 10002;

const _kRelaysKey = 'settings:managed_relays_v1';

/// Module-level view of the current read/write intent, so the relay pool can
/// honor it without a provider import cycle. Updated by the notifier on
/// every change.
final readRelayUrls = <String>{};
final writeRelayUrls = <String>{};

/// The user's relay set: persisted locally (SharedPreferences JSON) and
/// published as a NIP-65 kind 10002 list when signed in.
///
/// Before this, the Manage Relays screen had read/write toggles wired to
/// nothing and custom relays that vanished on restart — the toggles now
/// drive real behaviour (a read-off relay is not queried, a write-off one
/// is not published to) and the set survives restarts.
class RelaySettingsNotifier extends Notifier<List<ManagedRelay>> {
  @override
  List<ManagedRelay> build() {
    _load();
    // Seed from the pool's current URLs (the Env defaults on first run).
    final pool = ref.read(nostrServiceProvider).relayPool;
    final initial = [
      for (final url in pool.relayUrls) ManagedRelay(normalizeRelayUrl(url)),
    ];
    // Prime the module-level intent sets on first build (before _load's
    // persisted set replaces them, which calls _apply and re-primes).
    readRelayUrls
      ..clear()
      ..addAll(initial.map((r) => r.url));
    writeRelayUrls
      ..clear()
      ..addAll(initial.map((r) => r.url));
    return initial;
  }

  Future<void> _load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_kRelaysKey);
      if (raw == null || raw.isEmpty) return;
      final list = (jsonDecode(raw) as List)
          .whereType<Map<String, dynamic>>()
          .map(ManagedRelay.fromJson)
          .toList();
      if (list.isEmpty) return;

      state = list;
      // Reconcile the pool with the persisted set: add missing, drop removed.
      final pool = ref.read(nostrServiceProvider).relayPool;
      final wanted = {for (final r in list) r.url};
      for (final r in list) {
        if (!pool.relayUrls.contains(r.url)) {
          await pool.addRelay(r.url);
        }
      }
      for (final url in List.of(pool.relayUrls)) {
        if (!wanted.contains(normalizeRelayUrl(url))) {
          pool.removeRelay(url);
        }
      }
      _publishStatus();
    } catch (_) {}
  }

  /// Disk write, DEBOUNCED: `_apply` fires on every toggle (setRead/setWrite/
  /// add/remove), and each used to JSON-encode the entire relay list
  /// synchronously — 10 toggles was 10 full writes. One write per burst.
  Timer? _saveTimer;

  void _save() {
    _saveTimer?.cancel();
    _saveTimer = Timer(const Duration(milliseconds: 300), () async {
      try {
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString(
          _kRelaysKey,
          jsonEncode(state.map((r) => r.toJson()).toList()),
        );
      } catch (_) {}
    });
  }

  void _publishStatus() {
    final pool = ref.read(nostrServiceProvider).relayPool;
    ref.read(relayStatusProvider.notifier).state = pool.relayStates;
  }

  Future<void> _apply() async {
    readRelayUrls
      ..clear()
      ..addAll(state.where((r) => r.read).map((r) => r.url));
    writeRelayUrls
      ..clear()
      ..addAll(state.where((r) => r.write).map((r) => r.url));
    _save(); // debounced — not awaited
    _publishStatus();
  }

  // ── Mutations ─────────────────────────────────────────────────────

  Future<void> addRelay(String url) async {
    final normalized = normalizeRelayUrl(url);
    if (state.any((r) => r.url == normalized)) return;
    state = [...state, ManagedRelay(normalized)];
    await ref.read(nostrServiceProvider).relayPool.addRelay(normalized);
    await _apply();
  }

  Future<void> removeRelay(String url) async {
    final normalized = normalizeRelayUrl(url);
    state = state.where((r) => r.url != normalized).toList();
    ref.read(nostrServiceProvider).relayPool.removeRelay(normalized);
    await _apply();
  }

  Future<void> setRead(String url, bool read) async {
    state = [
      for (final r in state) r.url == url ? r.copyWith(read: read) : r,
    ];
    await _apply();
  }

  Future<void> setWrite(String url, bool write) async {
    state = [
      for (final r in state) r.url == url ? r.copyWith(write: write) : r,
    ];
    await _apply();
  }

  /// URLs a query should use: relays with read intent.
  List<String> get readUrls =>
      state.where((r) => r.read).map((r) => r.url).toList();

  /// URLs a publish should target: relays with write intent.
  List<String> get writeUrls =>
      state.where((r) => r.write).map((r) => r.url).toList();

  // ── NIP-65 sync ───────────────────────────────────────────────────

  /// Publish the current set as a NIP-65 kind 10002 relay list. The `r` tag
  /// carries no marker when the relay does both, and `read`/`write` markers
  /// when it does only one.
  Future<bool> publishList() async {
    final nostr = ref.read(nostrServiceProvider);
    if (!nostr.canSign) return false;
    try {
      final event = nostr.createEvent(
        kind: relayListKind,
        content: '',
        tags: [
          for (final r in state)
            if (r.read && r.write)
              ['r', r.url]
            else if (r.read)
              ['r', r.url, 'read']
            else if (r.write)
              ['r', r.url, 'write'],
        ],
      );
      return await nostr.publishEvent(event);
    } catch (_) {
      return false;
    }
  }

  /// Fetch the user's NIP-65 list and merge it with the local set. The
  /// published list wins for the relays it names (it is the one other
  /// clients honour); local-only relays are kept.
  Future<void> mergeFromNetwork() async {
    final nostr = ref.read(nostrServiceProvider);
    final pubkey = nostr.auth.pubkey;
    if (pubkey == null) return;
    try {
      if (!nostr.isInitialized) await nostr.init();
      final events = await nostr.relayPool.query(
        [
          NostrFilter(kinds: [relayListKind], authors: [pubkey], limit: 3),
        ],
        timeout: const Duration(seconds: 8),
      );
      if (events.isEmpty) return;
      events.sort((a, b) => b.createdAt.compareTo(a.createdAt));
      final latest = events.first;

      final remote = <ManagedRelay>[];
      for (final tag in latest.tags) {
        if (tag.isEmpty || tag[0] != 'r' || tag.length < 2) continue;
        final url = normalizeRelayUrl(tag[1]);
        final marker = tag.length > 2 ? tag[2].toLowerCase() : '';
        remote.add(
          ManagedRelay(
            url,
            read: marker != 'write',
            write: marker != 'read',
          ),
        );
      }
      if (remote.isEmpty) return;

      // Merge: remote wins per-URL, local-only relays kept, then apply to
      // the pool so connections match.
      final byUrl = {for (final r in state) r.url: r};
      for (final r in remote) {
        byUrl[r.url] = r;
      }
      state = byUrl.values.toList();

      final pool = ref.read(nostrServiceProvider).relayPool;
      final wanted = {for (final r in state) r.url};
      for (final url in wanted) {
        if (!pool.relayUrls.contains(url)) await pool.addRelay(url);
      }
      for (final url in List.of(pool.relayUrls)) {
        if (!wanted.contains(normalizeRelayUrl(url))) pool.removeRelay(url);
      }
      await _apply();
    } catch (_) {}
  }
}

final relaySettingsProvider =
    NotifierProvider<RelaySettingsNotifier, List<ManagedRelay>>(
  RelaySettingsNotifier.new,
);
