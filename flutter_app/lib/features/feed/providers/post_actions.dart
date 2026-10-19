import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';

/// Post interaction use-cases (like / repost / bookmark).
///
/// This logic previously lived inside `_PostCardState` (a widget), mixing
/// business rules (kind-5 deletions, kind-6/16 reposts, optimistic updates,
/// provider invalidation) with presentation. Now the widget only handles
/// rendering + optimistic UI state and delegates all side effects here.
class PostActions {
  final Ref _ref;
  PostActions(this._ref);

  /// Like `event`, or unlike if `currentlyLiked` is true.
  ///
  /// Unlike = NIP-09 deletion of the user's existing reaction event.
  /// Interaction/engagement providers are refreshed after a short delay so
  /// relays have time to propagate.
  void toggleLike({
    required NostrEvent event,
    required bool currentlyLiked,
  }) {
    final auth = _ref.read(authStateProvider);
    if (!auth.isLoggedIn || auth.isReadOnly || auth.pubkey == null) return;

    final nostr = _ref.read(nostrServiceProvider);

    if (currentlyLiked) {
      final reactions =
          _ref.read(reactionsProvider(event.id)).valueOrNull ?? [];
      final userReaction =
          reactions.where((e) => e.pubkey == auth.pubkey).firstOrNull;
      if (userReaction != null) {
        nostr.publish(nostr.createDeletion(userReaction.id));
      }
    } else {
      nostr.publish(nostr.createReaction(event));
    }
    _scheduleEngagementRefresh(event.id);
  }

  /// Repost `event`, or undo the repost if `currentlyReposted` is true.
  void toggleRepost({
    required NostrEvent event,
    required bool currentlyReposted,
  }) {
    final auth = _ref.read(authStateProvider);
    if (!auth.isLoggedIn || auth.isReadOnly || auth.pubkey == null) return;

    final nostr = _ref.read(nostrServiceProvider);

    if (currentlyReposted) {
      // Note: Nostr doesn't have a true "delete" — we publish a kind 5
      // deletion request. Most clients will hide the repost.
      final reposts = _ref.read(repostsProvider(event.id)).valueOrNull ?? [];
      final userRepost =
          reposts.where((e) => e.pubkey == auth.pubkey).firstOrNull;
      if (userRepost != null) {
        nostr.publish(nostr.createDeletion(userRepost.id));
      }
    } else {
      nostr.publish(nostr.createRepost(event));
    }
    _scheduleEngagementRefresh(event.id);
  }

  /// Add/remove the event from the user's kind-10003 bookmark list.
  Future<void> toggleBookmark({
    required NostrEvent event,
    required bool isCurrentlyBookmarked,
  }) async {
    final auth = _ref.read(authStateProvider);
    if (!auth.isLoggedIn || auth.isReadOnly) return;

    final nostr = _ref.read(nostrServiceProvider);
    await nostr.toggleBookmark(event.id, isCurrentlyBookmarked);
    _ref.invalidate(bookmarkedIdsProvider);
    _ref.invalidate(bookmarksProvider);
  }

  /// Refresh zap receipts for the event (called after the zap sheet closes).
  void refreshZaps(String eventId) {
    Future.delayed(const Duration(seconds: 2), () {
      _ref.invalidate(zapReceiptsProvider(eventId));
    });
  }

  void _scheduleEngagementRefresh(String eventId) {
    Future.delayed(const Duration(seconds: 2), () {
      _ref.invalidate(userInteractionsProvider([eventId]));
      _ref.invalidate(engagementProvider(eventId));
    });
  }
}

/// Accessor for [PostActions]. Not autoDispose — it's a stateless controller.
final postActionsProvider = Provider<PostActions>((ref) => PostActions(ref));
