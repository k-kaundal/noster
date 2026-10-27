import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/db/event_store.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/nostr_service_providers.dart';
import 'package:nostrfeed_mobile/features/auth/data/auth_service.dart';
import 'package:nostrfeed_mobile/features/chat/application/dm_store.dart';

/// Auth state
final authStateProvider = NotifierProvider<AuthNotifier, AuthState>(
  AuthNotifier.new,
);

class AuthNotifier extends Notifier<AuthState> {
  late final NostrService _nostr;

  /// The initial state [build] returned. If [state] has moved on from this
  /// by the time the async storage read resolves, an explicit auth action
  /// happened and the restore must not overwrite it (race guard).
  static const _initial = AuthState();

  /// Whether we've published our kind-10050 DM-inbox relay list this
  /// session — once per login, never on every profile refresh.
  bool _publishedDmInbox = false;

  @override
  AuthState build() {
    _nostr = ref.read(nostrServiceProvider);
    _init();
    return _initial;
  }

  Future<void> _init() async {
    AuthState stored;
    try {
      stored = await _nostr.authService.getStoredAuth();
    } catch (_) {
      stored = const AuthState();
    }
    // State was changed explicitly (login/logout/test) while the storage
    // read was in flight — the newer state wins, drop the stale restore.
    if (state != _initial) return;
    state = stored;
    if (state.isLoggedIn) _loadProfile();
  }

  Future<void> _loadProfile() async {
    if (state.pubkey == null) return;
    _publishDmInboxOnce();
    // Capture what we already have (from secure storage / fresh update) —
    // fetchProfile returns the NEWEST version it can find, but when relays
    // lag it may return the locally-cached fresh one, and when relays are
    // unreachable it returns the cache (possibly stale or null).
    final relayProfile = await _nostr.fetchProfile(state.pubkey!);
    // Never DOWNGRADE: if the relay returned nothing, keep what we have.
    if (relayProfile == null) return;
    state = state.copyWith(profile: relayProfile);
    // Persist so the next cold start shows this profile immediately.
    await _nostr.authService.saveStoredProfile(relayProfile);
    // Keep the account switcher's cached name/avatar fresh too.
    if (state.pubkey != null) {
      await _nostr.authService.updateAccountProfile(
        state.pubkey!,
        relayProfile,
      );
    }
  }

  /// Publishes our kind-10050 DM-inbox relay list (NIP-17) so OTHER clients
  /// know which relays to send our DMs to. Without it every sender falls
  /// back to well-known relays — slower and leakier. 1–3 relays per spec.
  void _publishDmInboxOnce() {
    if (_publishedDmInbox) return;
    if (!state.isLoggedIn || state.privateKey == null) return;
    _publishedDmInbox = true;
    () async {
      try {
        final inboxRelays = _nostr.relayPool.relayUrls.take(3).toList();
        if (inboxRelays.isEmpty) return;
        final event = _nostr.dms.createDmInboxRelayList(inboxRelays);
        await _nostr.relayPool.publishWithAck(event);
      } catch (_) {
        // Best-effort: a failed 10050 publish just means senders fall back.
        _publishedDmInbox = false; // retry next session
      }
    }();
  }

  Future<void> loginWithNsec(String nsec) async {
    state = await _nostr.authService.loginWithNsec(nsec);
    await _nostr.setAuth(state);
    _loadProfile();
  }

  Future<void> loginWithHexKey(String hexKey) async {
    state = await _nostr.authService.loginWithHexKey(hexKey);
    await _nostr.setAuth(state);
    _loadProfile();
  }

  Future<void> loginReadOnly(String npub) async {
    state = await _nostr.authService.loginReadOnly(npub);
    await _nostr.setAuth(state);
    _loadProfile();
  }

  Future<void> generateKeys() async {
    state = await _nostr.authService.generateKeys();
    await _nostr.setAuth(state);
    _loadProfile();
  }

  Future<void> logout() async {
    await _nostr.authService.logout();
    // Wipe per-account DM state (decrypted cache, watermarks, outbox) so the
    // next account on this device never inherits them (cross-account leak).
    try {
      ref.read(dmStoreProvider.notifier).clearAll();
    } catch (_) {}
    await _nostr.setAuth(const AuthState());
    state = const AuthState();
  }

  /// Switch the active identity to a saved account (trusted-client
  /// multi-account). Restores its keys, clears per-account DM state, and
  /// re-inits so providers re-read the new identity.
  Future<void> switchAccount(String pubkey) async {
    final next = await _nostr.authService.switchAccount(pubkey);
    if (next == null) return;
    try {
      ref.read(dmStoreProvider.notifier).clearAll();
    } catch (_) {}
    await _nostr.setAuth(next);
    state = next;
    if (next.isLoggedIn) _loadProfile();
  }

  /// Updates the in-memory profile on the auth state without publishing.
  /// Used after a kind-0 has already been published (e.g. by the identity /
  /// lightning-address flows) so the local UI reflects it immediately.
  void updateLocalProfile(NostrProfile profile) {
    state = state.copyWith(profile: profile);
  }

  Future<void> updateProfile(NostrProfile profile) async {
    if (!state.isLoggedIn || state.privateKey == null) return;
    final event = _nostr.updateProfile(profile);
    _nostr.publish(event);

    // Update the shared profile cache with the locally-known fresh data.
    // Relays may take a few seconds to propagate the new kind-0, and any
    // fetchProfile during that window will get stale data — this cache
    // ensures the UI sees the update immediately.
    if (state.pubkey != null) {
      _nostr.cacheProfile(
        state.pubkey!,
        profile: profile,
        createdAt: event.createdAt,
        fetchedAt: event.createdAt,
      );
    }

    state = state.copyWith(profile: profile);

    // Persist locally so the profile survives app restarts — otherwise the
    // next cold start shows an empty profile until relays respond.
    await _nostr.authService.saveStoredProfile(profile);

    // Invalidate all profile-dependent providers so every screen that
    // displays this user's info rebuilds with the latest data.
    if (state.pubkey != null) {
      ref.invalidate(profileProvider(state.pubkey!));
    }
  }

  Future<void> toggleFollow(String targetPubkey) async {
    if (!state.isLoggedIn || state.privateKey == null) return;
    // The optimistic FollowsNotifier flips state instantly + publishes
    // behind (the UI never waits on the kind-3 relay round-trip).
    await ref.read(followsProvider.notifier).toggleFollow(targetPubkey);
  }
}

/// All saved accounts (multi-account switcher data), freshest first.
final savedAccountsProvider = FutureProvider.autoDispose<List<SavedAccount>>((
  ref,
) async {
  // Re-fetch when auth changes (a login/logout/switch changes the set).
  ref.watch(authStateProvider);
  return ref.read(nostrServiceProvider).authService.savedAccounts();
});

/// Profile fetcher for any pubkey.
///
/// NOT autoDispose: profiles are the hottest data in the app (every post
/// card, avatar, mention watches one) and `NostrService.profileCache`
/// already TTL-caches the network side. Disposing the provider on every
/// scroll-away re-fetched profiles mid-scroll, which is what made avatars
/// flicker. keepAlive + the 10-min cache = instant, stable profile rows.
final profileProvider = FutureProvider.family<NostrProfile?, String>((
  ref,
  pubkey,
) async {
  final nostr = await initNostr(ref);
  return nostr.fetchProfile(pubkey);
});

/// User follows — keepAlive AsyncNotifier with OPTIMISTIC toggleFollow.
///
/// Was `FutureProvider.autoDispose`: every follow/unfollow did
/// `ref.invalidate(followsProvider)` → the value dropped → every Follow
/// button in the app flickered to "Follow" and back while the kind-3
/// re-fetched from relays. Now the button flips INSTANTLY (optimistic
/// state update), the kind-3 publishes in the background, and a failed
/// publish rolls the state back.
///
/// The service-level `followsCache` is also updated optimistically by
/// `updateFollows`, so this notifier's initial read is already correct
/// after an action (no stale flash on the next screen).
final followsProvider = AsyncNotifierProvider<FollowsNotifier, List<String>>(
  FollowsNotifier.new,
);

class FollowsNotifier extends AsyncNotifier<List<String>> {
  @override
  Future<List<String>> build() async {
    final nostr = await initNostr(ref);
    final auth = ref.watch(authStateProvider);
    if (!auth.isLoggedIn || auth.pubkey == null) return [];
    return nostr.fetchFollows(auth.pubkey!);
  }

  /// Follow or unfollow [targetPubkey]. OPTIMISTIC: the list flips now;
  /// the kind-3 publishes behind; a failed publish rolls back. Every
  /// follow-dependent surface (profile button, search button, Following
  /// feed, For You personalization, follow-count stats) updates in the
  /// same frame — real-time, as the user asked.
  Future<void> toggleFollow(String targetPubkey) async {
    final auth = ref.read(authStateProvider);
    if (!auth.isLoggedIn || auth.privateKey == null || auth.pubkey == null) {
      return;
    }
    final current = state.valueOrNull ?? [];
    final isFollowing = current.contains(targetPubkey);
    final optimistic = isFollowing
        ? current.where((pk) => pk != targetPubkey).toList()
        : [...current, targetPubkey];

    // 1. Flip the UI instantly.
    state = AsyncData(optimistic);

    // 2. Publish the kind-3 behind (updateFollows optimistically writes the
    // service cache too, so a re-read in the propagation window stays right).
    try {
      final nostr = ref.read(nostrServiceProvider);
      final event = nostr.updateFollows(optimistic);
      await nostr.relayPool.publishWithAck(event);
      // Refresh followers counts for both parties (cheap, behind).
      ref.invalidate(followersProvider);
    } catch (_) {
      // 3. Publish failed — roll the optimistic flip back so the button
      // doesn't lie about a follow that never landed.
      state = AsyncData(current);
      rethrow;
    }
  }

  /// Silent refresh (pull-to-refresh / reconnect): relay truth merges.
  Future<void> refresh() async {
    final nostr = await initNostr(ref);
    final auth = ref.read(authStateProvider);
    if (!auth.isLoggedIn || auth.pubkey == null) return;
    state = AsyncData(await nostr.fetchFollows(auth.pubkey!));
  }
}

/// Followers count
final followersProvider = FutureProvider.family.autoDispose<int, String>((
  ref,
  pubkey,
) async {
  final nostr = await initNostr(ref);
  final followers = await nostr.fetchFollowers(pubkey);
  return followers.length;
});

/// User posts.
///
/// keepAlive (NOT autoDispose): a profile's posts are re-read on every tab
/// switch (Posts / Replies / Articles / Media all filter the same list), so
/// disposing between tabs re-fetched the whole list per tab — the profile
/// tab flicker. The list is small (50) and profile screens are short-lived;
/// keeping it alive while the profile is open is the right trade.
///
/// Fetches the full displayable set (notes, picture/video posts, articles)
/// — picture-first accounts post kind 20/21/22, and a kind-1-only fetch is
/// why those profiles looked EMPTY. The tabs filter per kind from this set.
///
/// STORE-FIRST: paint the SQLite store instantly (offline + no skeleton),
/// then the relay fetch merges behind it. Same offline-first pattern as
/// the feed + notifications.
final userPostsProvider = FutureProvider.family<List<NostrEvent>, String>((
  ref,
  pubkey,
) async {
  // 1. Instant store paint (offline + no skeleton).
  final stored = await EventStore.instance.queryByFilters([
    NostrFilter(
      kinds: const [1, 6, 16, 20, 21, 22, 30023],
      authors: [pubkey],
      limit: 50,
    ),
  ]);
  if (stored.isNotEmpty) {
    stored.sort((a, b) => b.createdAt.compareTo(a.createdAt));
  }

  // 2. Relay backfill (network truth).
  try {
    final nostr = await initNostr(ref);
    final fresh = await nostr.relayPool.query([
      NostrFilter(
        kinds: const [1, 6, 16, 20, 21, 22, 30023],
        authors: [pubkey],
        limit: 50,
      ),
    ], timeout: const Duration(seconds: 8));
    if (fresh.isNotEmpty) {
      unawaited(EventStore.instance.ingest(fresh));
      // Merge stored + fresh (dedup by id, newest-first).
      if (stored.isNotEmpty) {
        final seen = stored.map((e) => e.id).toSet();
        return [...stored, ...fresh.where((e) => !seen.contains(e.id))]
          ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
      }
      fresh.sort((a, b) => b.createdAt.compareTo(a.createdAt));
      return fresh;
    }
  } catch (_) {
    // Offline / dead relays — the stored paint (if any) stands.
  }
  return stored;
});

/// The Following feed lives on `followingFeedNotifierProvider` (SQLite-
/// backed Notifier). No plain FutureProvider here — one existed and was
/// dead code (unwatched; invalidating an unwatched provider is a no-op).
