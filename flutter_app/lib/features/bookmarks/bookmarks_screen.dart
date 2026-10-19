import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';

import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/features/feed/widgets/post_card.dart';
import 'package:nostrfeed_mobile/core/widgets/empty_state.dart';
import 'package:nostrfeed_mobile/core/widgets/async_feed_scaffold.dart';

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
        itemBuilder: (context, event) => PostCard(event: event),
      ),
    );
  }
}
