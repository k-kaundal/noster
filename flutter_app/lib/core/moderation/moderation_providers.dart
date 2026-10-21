import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/moderation/content_filter.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';

/// Storage keys.
const _kHideNsfwKey = 'settings:filter_nsfw';
const _kHideSpamKey = 'settings:filter_spam';
const _kBlockedWordsKey = 'settings:blocked_words';
const _kBlockedAuthorsKey = 'settings:blocked_authors';

/// NIP-51 mute list kind (public items only — private encrypted mutes are
/// left alone; we never publish over a list that has them).
const muteListKind = 10000;

/// Master NSFW filter toggle. DEFAULT ON — the store policies (Play UGC,
/// Apple 1.2) require explicit content hidden by default.
final nsfwFilterProvider = NotifierProvider<NsfwFilterNotifier, bool>(
  NsfwFilterNotifier.new,
);

class NsfwFilterNotifier extends Notifier<bool> {
  @override
  bool build() {
    _load();
    return true;
  }

  Future<void> _load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final stored = prefs.getBool(_kHideNsfwKey);
      if (stored != null && state != stored) state = stored;
    } catch (_) {}
  }

  Future<void> toggle(bool value) async {
    state = value;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool(_kHideNsfwKey, value);
    } catch (_) {}
  }
}

/// Spam-link filter toggle. DEFAULT ON — a link dump is not speech anyone
/// opted into.
final spamFilterProvider = NotifierProvider<SpamFilterNotifier, bool>(
  SpamFilterNotifier.new,
);

class SpamFilterNotifier extends Notifier<bool> {
  @override
  bool build() {
    _load();
    return true;
  }

  Future<void> _load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final stored = prefs.getBool(_kHideSpamKey);
      if (stored != null && state != stored) state = stored;
    } catch (_) {}
  }

  Future<void> toggle(bool value) async {
    state = value;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool(_kHideSpamKey, value);
    } catch (_) {}
  }
}

/// The user's own blocked words (Settings → Content filters). Local first,
/// synced to the NIP-51 mute list's `word` tags when logged in.
final blockedWordsProvider =
    NotifierProvider<BlockedWordsNotifier, Set<String>>(
  BlockedWordsNotifier.new,
);

class BlockedWordsNotifier extends Notifier<Set<String>> {
  @override
  Set<String> build() {
    _load();
    return const {};
  }

  Future<void> _load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final stored = prefs.getStringList(_kBlockedWordsKey);
      if (stored != null) {
        state = stored.map((w) => w.trim().toLowerCase()).toSet();
      }
    } catch (_) {}
  }

  Future<void> _save() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setStringList(_kBlockedWordsKey, state.toList());
    } catch (_) {}
  }

  Future<void> add(String word) async {
    final clean = word.trim().toLowerCase();
    if (clean.isEmpty) return;
    state = {...state, clean};
    await _save();
  }

  Future<void> remove(String word) async {
    if (!state.contains(word)) return;
    state = {...state}..remove(word);
    await _save();
  }
}

/// Blocked authors (a.k.a. muted users). Local first, merged with the
/// NIP-51 kind 10000 mute list fetched from relays, and published back on
/// change so the block follows the user across clients.
final blockedAuthorsProvider =
    NotifierProvider<BlockedAuthorsNotifier, Set<String>>(
  BlockedAuthorsNotifier.new,
);

class BlockedAuthorsNotifier extends Notifier<Set<String>> {
  @override
  Set<String> build() {
    _load();
    return const {};
  }

  Future<void> _load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final stored = prefs.getStringList(_kBlockedAuthorsKey);
      if (stored != null && stored.isNotEmpty) state = stored.toSet();
    } catch (_) {}
  }

  Future<void> _save() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setStringList(_kBlockedAuthorsKey, state.toList());
    } catch (_) {}
  }

  Future<void> add(String pubkey) => _mutate({...state, pubkey});

  Future<void> remove(String pubkey) =>
      _mutate({...state}..remove(pubkey));

  Future<void> _mutate(Set<String> next) async {
    if (next.length == state.length && next.containsAll(state)) return;
    state = next;
    await _save();
    // Publish the NIP-51 mute list best-effort: blocking works locally even
    // if the publish fails, and the next login re-merges.
    await _publish();
  }

  Future<void> _publish() async {
    final nostr = ref.read(nostrServiceProvider);
    if (!nostr.canSign) return;
    try {
      final words = ref.read(blockedWordsProvider);
      final event = nostr.createEvent(
        kind: muteListKind,
        content: '',
        tags: [
          for (final pk in state) ['p', pk],
          for (final w in words) ['word', w],
        ],
      );
      await nostr.publishEvent(event);
    } catch (_) {
      // Local block stands; the sync is a bonus, not a prerequisite.
    }
  }

  /// Merge a mute list fetched from relays (union — a remote block is a
  /// block, removal is explicit on this device).
  Future<void> mergeFromRelays(NostrEvent muteListEvent) async {
    final remote = muteListEvent.pubkeyRefs.toSet();
    final remoteWords = muteListEvent.getTags('word');
    var changed = false;

    final merged = {...state, ...remote};
    if (merged.length != state.length) {
      state = merged;
      await _save();
      changed = true;
    }
    if (remoteWords.isNotEmpty) {
      final words = ref.read(blockedWordsProvider.notifier);
      for (final w in remoteWords) {
        await words.add(w);
      }
    }
    if (changed) {
      // words added above persist through their own notifier
    }
  }
}

/// Fetch and merge the user's NIP-51 mute list once per session-ish.
/// AutoDispose: runs again when the screen that watches it re-opens.
final muteListSyncProvider = FutureProvider.autoDispose<void>((ref) async {
  final auth = ref.watch(authStateProvider);
  final pubkey = auth.pubkey;
  if (pubkey == null) return;

  final nostr = ref.read(nostrServiceProvider);
  if (!nostr.isInitialized) await nostr.init();

  final events = await nostr.relayPool.query(
    [
      NostrFilter(kinds: [muteListKind], authors: [pubkey], limit: 5),
    ],
    timeout: const Duration(seconds: 8),
  );
  if (events.isEmpty) return;

  // Newest mute list wins (they are replaceable).
  events.sort((a, b) => b.createdAt.compareTo(a.createdAt));
  await ref.read(blockedAuthorsProvider.notifier).mergeFromRelays(events.first);
});

/// The filter instance everything consults. Rebuilt when toggles or
/// blocklists change; cheap — matching cost is per-post at call time.
final contentFilterProvider = Provider<ContentFilter>((ref) {
  final nsfwOn = ref.watch(nsfwFilterProvider);
  final spamOn = ref.watch(spamFilterProvider);
  final words = ref.watch(blockedWordsProvider);
  final authors = ref.watch(blockedAuthorsProvider);

  return ContentFilter(
    blockedWords: words,
    blockedAuthors: authors,
    nsfwTermsEnabled: nsfwOn,
    spamLinksEnabled: spamOn,
  );
});

/// Central verdict for an event, honoring the toggles. Everything that
/// renders a post calls this rather than ContentFilter directly.
///
/// Works from widgets (WidgetRef) and providers (Ref) — both expose the
/// `.watch` this needs, and Riverpod 2.6 has no shared interface for them.
FilterVerdict filteredEventVerdict(
  WidgetRef ref,
  NostrEvent event, {
  NostrProfile? authorProfile,
}) {
  return ref
      .watch(contentFilterProvider)
      .verdictForEvent(event, authorProfile: authorProfile);
}
