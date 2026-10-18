import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../providers/app_providers.dart';
import '../../widgets/post/post_card.dart';

class FeedScreen extends ConsumerWidget {
  const FeedScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final feedAsync = ref.watch(feedProvider);
    final relayCount = ref.watch(relayStatusProvider).values
        .where((s) => s.name == 'connected')
        .length;

    return Scaffold(
      appBar: AppBar(
        title: const Text('NostrFeed', style: TextStyle(fontWeight: FontWeight.bold)),
        actions: [
          if (relayCount > 0)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: Center(
                child: Text(
                  '$relayCount relays',
                  style: const TextStyle(fontSize: 12, color: Colors.green),
                ),
              ),
            ),
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () => ref.invalidate(feedProvider),
          ),
        ],
      ),
      body: feedAsync.when(
        loading: () => const Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              CircularProgressIndicator(),
              SizedBox(height: 16),
              Text('Connecting to Nostr relays...'),
            ],
          ),
        ),
        error: (error, _) => Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.cloud_off, size: 64, color: Theme.of(context).colorScheme.error),
                const SizedBox(height: 16),
                const Text('Connection Error', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                const SizedBox(height: 8),
                Text(error.toString(), textAlign: TextAlign.center),
                const SizedBox(height: 24),
                FilledButton.icon(
                  onPressed: () => ref.invalidate(feedProvider),
                  icon: const Icon(Icons.refresh),
                  label: const Text('Retry'),
                ),
              ],
            ),
          ),
        ),
        data: (events) {
          if (events.isEmpty) {
            return Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.feed_outlined, size: 64, color: Colors.grey),
                  const SizedBox(height: 16),
                  const Text('No posts found', style: TextStyle(fontSize: 18)),
                  const SizedBox(height: 24),
                  FilledButton(
                    onPressed: () => ref.invalidate(feedProvider),
                    child: const Text('Refresh'),
                  ),
                ],
              ),
            );
          }

          return RefreshIndicator(
            onRefresh: () async => ref.invalidate(feedProvider),
            child: ListView.builder(
              itemCount: events.length,
              itemBuilder: (context, index) => PostCard(event: events[index]),
            ),
          );
        },
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => context.push('/compose'),
        child: const Icon(Icons.edit),
      ),
    );
  }
}
