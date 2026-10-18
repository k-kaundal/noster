import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/app_providers.dart';
import '../../widgets/post/post_card.dart';

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
        error: (err, _) => Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.cloud_off, size: 48),
              const SizedBox(height: 12),
              const Text('Failed to load posts'),
              const SizedBox(height: 12),
              FilledButton.tonal(
                onPressed: () => ref.invalidate(hashtagFeedProvider(tag)),
                child: const Text('Retry'),
              ),
            ],
          ),
        ),
        data: (events) {
          if (events.isEmpty) {
            return Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.tag, size: 64, color: Colors.grey),
                  const SizedBox(height: 16),
                  Text('No posts tagged #$tag'),
                ],
              ),
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
