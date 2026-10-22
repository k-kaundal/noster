import 'package:flutter_riverpod/flutter_riverpod.dart';

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
      ref.read(dmStoreProvider).clearAll();
    } catch (_) {}
    await _nostr.setAuth(const AuthState());
    state = const AuthState();
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
      _nostr.profileCache[state.pubkey!] = (
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
    final currentFollows = await _nostr.fetchFollows(state.pubkey!);
    final isFollowing = currentFollows.contains(targetPubkey);
    final newFollows = isFollowing
        ? currentFollows.where((pk) => pk != targetPubkey).toList()
        : [...currentFollows, targetPubkey];
    final event = _nostr.updateFollows(newFollows);
    _nostr.publish(event);

    // Invalidate follow-dependent providers so counts/lists update everywhere.
    ref.invalidate(followsProvider);
    ref.invalidate(followersProvider);
    ref.invalidate(followingFeedProvider);
  }
}

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

/// User follows
final followsProvider = FutureProvider.autoDispose<List<String>>((ref) async {
  final nostr = await initNostr(ref);
  final auth = ref.watch(authStateProvider);
  if (!auth.isLoggedIn || auth.pubkey == null) return [];
  return nostr.fetchFollows(auth.pubkey!);
});

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
final userPostsProvider = FutureProvider.family<List<NostrEvent>, String>((
  ref,
  pubkey,
) async {
  final nostr = await initNostr(ref);
  return nostr.fetchFeed(limit: 50, authors: [pubkey]);
});

/// Feed events (following)
final followingFeedProvider = FutureProvider<List<NostrEvent>>((ref) async {
  final nostr = await initNostr(ref);
  final auth = ref.watch(authStateProvider);
  if (!auth.isLoggedIn || auth.pubkey == null) return [];
  final follows = await nostr.fetchFollows(auth.pubkey!);
  return nostr.fetchFollowingFeed(follows);
});
