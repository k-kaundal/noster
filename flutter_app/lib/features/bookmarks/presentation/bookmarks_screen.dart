import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/core/widgets/async_feed_scaffold.dart';
import 'package:nostrfeed_mobile/core/widgets/empty_state.dart';
import 'package:nostrfeed_mobile/features/feed/application/post_actions.dart';
import 'package:nostrfeed_mobile/features/feed/presentation/widgets/post_card.dart';
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';

/// Saved posts. Each row is a PostCard (with its own bookmark toggle), and a
/// swipe removes it — the explicit UNBOOKMARK path, so removing a save isn't
/// only reachable by hunting the tiny icon on the card.
class BookmarksScreen extends ConsumerWidget {
  const BookmarksScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final bookmarks = ref.watch(bookmarksProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Bookmarks')),
      body: AsyncFeedList<NostrEvent>(
        value: bookmarks,
        onRefresh: () async => ref.invalidate(bookmarksProvider),
        emptyState: const EmptyState(
          icon: Icons.bookmark_border,
          title: 'No bookmarks yet',
          subtitle: 'Save posts to read later by tapping the bookmark icon on any post.',
        ),
        itemBuilder: (context, event) => _BookmarkRow(event: event),
      ),
    );
  }
}

class _BookmarkRow extends ConsumerWidget {
  final NostrEvent event;
  const _BookmarkRow({required this.event});

  Future<bool> _confirmRemove(BuildContext context, WidgetRef ref) async {
    // Unbookmark = the same toggle, removing from the kind-10003 list.
    try {
      await ref.read(postActionsProvider).toggleBookmark(
            event: event,
            isCurrentlyBookmarked: true,
          );
      if (context.mounted) {
        AppToast.success(context, 'Removed from bookmarks');
      }
      return true; // dismiss the row
    } catch (e) {
      if (context.mounted) AppToast.error(context, '$e');
      return false; // keep it — the removal failed
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    return Dismissible(
      key: ValueKey(event.id),
      direction: DismissDirection.endToStart,
      confirmDismiss: (_) => _confirmRemove(context, ref),
      background: Container(
        alignment: Alignment.centerRight,
        padding: const EdgeInsets.only(right: 20),
        color: scheme.error,
        child: const AppIcon('bookmark', color: Colors.white), // token-guard: allow — on error-red bg
      ),
      child: PostCard(event: event),
    );
  }
}
