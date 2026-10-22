import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/widgets/empty_state.dart';
import 'package:nostrfeed_mobile/core/widgets/error_view.dart';
import 'package:nostrfeed_mobile/features/feed/presentation/widgets/post_card.dart';

/// Shows all posts tagged with a specific hashtag.
class HashtagScreen extends ConsumerWidget {
  final String tag;
  const HashtagScreen({super.key, required this.tag});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final feedAsync = ref.watch(hashtagFeedProvider(tag));

    return Scaffold(
      appBar: AppBar(
        title: Text('#$tag'),
      ),
      body: feedAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => ErrorView(
          message: 'Failed to load posts',
          onRetry: () => ref.invalidate(hashtagFeedProvider(tag)),
        ),
        data: (events) {
          if (events.isEmpty) {
            return EmptyState(
              icon: Icons.tag,
              iconColor: Colors.grey,
              title: 'No posts tagged #$tag',
            );
          }
          return RefreshIndicator(
            onRefresh: () async => ref.invalidate(hashtagFeedProvider(tag)),
            child: ListView.builder(
              itemCount: events.length,
              itemBuilder: (context, i) => PostCard(event: events[i]),
            ),
          );
        },
      ),
    );
  }
}
