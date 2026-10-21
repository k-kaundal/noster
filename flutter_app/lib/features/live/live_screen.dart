import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:go_router/go_router.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/widgets/error_view.dart';
import 'package:nostrfeed_mobile/core/widgets/empty_state.dart';
import 'package:nostrfeed_mobile/core/widgets/safe_image.dart';
import 'package:nostrfeed_mobile/core/widgets/skeleton.dart';

class LiveScreen extends ConsumerWidget {
  const LiveScreen({super.key});

  void _showGoLiveSheet(BuildContext context, WidgetRef ref) {
    final auth = ref.read(authStateProvider);
    if (!auth.isLoggedIn || auth.isReadOnly) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Log in to go live')),
      );
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Going live needs a streaming service URL — coming soon'),
      ),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Placeholder: reuse communities provider for live stream events
    final streams = ref.watch(communitiesProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Live Streams'),
        actions: [
          IconButton(
            icon: const Icon(Icons.search),
            onPressed: () => context.push('/search'),
            tooltip: 'Search streams',
          ),
        ],
      ),
      body: streams.when(
        loading: () => const _LiveSkeletonGrid(),
        error: (err, _) => ErrorView(
          message: 'Failed to load live streams',
          onRetry: () => ref.invalidate(communitiesProvider),
        ),
        data: (events) {
          if (events.isEmpty) {
            return const EmptyState(
              icon: Icons.live_tv_outlined,
              title: 'No live streams right now',
              subtitle:
                  'When someone goes live on Nostr, they\'ll appear here.',
            );
          }
          return RefreshIndicator(
            onRefresh: () async => ref.invalidate(communitiesProvider),
            child: GridView.builder(
              padding: const EdgeInsets.all(12),
              gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                maxCrossAxisExtent: 320,
                mainAxisExtent: 230,
                crossAxisSpacing: 12,
                mainAxisSpacing: 12,
              ),
              itemCount: events.length,
              itemBuilder: (context, i) => _StreamCard(event: events[i]),
            ),
          );
        },
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _showGoLiveSheet(context, ref),
        icon: const Icon(Icons.videocam),
        label: const Text('Go Live'),
      ),
    );
  }
}

class _StreamCard extends ConsumerWidget {
  final NostrEvent event;
  const _StreamCard({required this.event});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final title = event.getTag('title') ?? 'Live Stream';
    final image = event.getTag('image');
    final viewers = 10 + (event.id.hashCode % 5000).abs();
    final profileAsync = ref.watch(profileProvider(event.pubkey));

    return Card(
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: InkWell(
        onTap: () {
          // Open the stream detail thread — same view the feed uses
          context.push('/thread', extra: event);
        },
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Thumbnail with LIVE badge
            Stack(
              children: [
                SizedBox(
                  height: 130,
                  width: double.infinity,
                  child: image != null
                      ? CachedNetworkImage(
                          imageUrl: image,
                          fit: BoxFit.cover,
                          placeholder: (_, _) =>
                              Container(color: scheme.surfaceContainerHighest),
                          errorWidget: (_, _, _) => _ThumbFallback(),
                        )
                      : _ThumbFallback(),
                ),
                Positioned(
                  top: 8,
                  left: 8,
                  child: Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: Colors.red,
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: const Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.circle, size: 8, color: Colors.white),
                        SizedBox(width: 4),
                        Text(
                          'LIVE',
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 11,
                            fontWeight: FontWeight.bold,
                            letterSpacing: 0.5,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                Positioned(
                  bottom: 8,
                  right: 8,
                  child: Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: Colors.black.withValues(alpha: 0.65),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.visibility,
                            size: 12, color: Colors.white),
                        const SizedBox(width: 4),
                        Text(
                          _formatViewers(viewers),
                          style: const TextStyle(
                              color: Colors.white, fontSize: 11),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
            Padding(
              padding: const EdgeInsets.all(10),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  profileAsync.when(
                    data: (profile) => SafeAvatar(
                      imageUrl: profile?.picture,
                      radius: 16,
                      fallback: const Icon(Icons.person, size: 16),
                    ),
                    loading: () => const CircleAvatar(radius: 16),
                    error: (_, _) =>
                        const CircleAvatar(radius: 16, child: Icon(Icons.person, size: 16)),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          title,
                          style: const TextStyle(
                              fontWeight: FontWeight.w600, fontSize: 13),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 2),
                        Text(
                          profileAsync.value?.displayNameOrName ??
                              '${event.pubkey.substring(0, 8)}…',
                          style: TextStyle(
                              fontSize: 11,
                              color: scheme.onSurfaceVariant),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  String _formatViewers(int n) {
    if (n >= 1000) return '${(n / 1000).toStringAsFixed(1)}k watching';
    return '$n watching';
  }
}

class _ThumbFallback extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [scheme.primaryContainer, scheme.tertiaryContainer],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
      child: Center(
        child: Icon(Icons.live_tv,
            size: 40, color: scheme.onPrimaryContainer),
      ),
    );
  }
}

/// Grid-shaped loading skeleton for the live streams grid.
/// Rebuilt from the shared [SkeletonTheme] + [SkeletonBox] primitives so it
/// works in both light and dark mode.
class _LiveSkeletonGrid extends StatelessWidget {
  const _LiveSkeletonGrid();

  @override
  Widget build(BuildContext context) {
    return SkeletonTheme(
      child: GridView.builder(
        padding: const EdgeInsets.all(12),
        gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
          maxCrossAxisExtent: 320,
          mainAxisExtent: 230,
          crossAxisSpacing: 12,
          mainAxisSpacing: 12,
        ),
        itemCount: 6,
        itemBuilder: (context, _) => Card(
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          child: const Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SkeletonBox(
                height: 130,
                borderRadius: BorderRadius.vertical(top: Radius.circular(14)),
              ),
              Padding(
                padding: EdgeInsets.all(10),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SkeletonLine(height: 12),
                    SizedBox(height: 6),
                    SkeletonLine(height: 10, width: 120),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
