import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:shimmer/shimmer.dart';
import '../../providers/app_providers.dart';

class ReelsScreen extends ConsumerStatefulWidget {
  const ReelsScreen({super.key});

  @override
  ConsumerState<ReelsScreen> createState() => _ReelsScreenState();
}

class _ReelsScreenState extends ConsumerState<ReelsScreen> {
  final PageController _pageController = PageController();

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Placeholder list of reels; in production, query kind 1 with video URLs
    final feed = ref.watch(trendingProvider);

    return Scaffold(
      backgroundColor: Colors.black,
      extendBodyBehindAppBar: true,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        title: const Text('Reels', style: TextStyle(color: Colors.white)),
        actions: [
          IconButton(
            icon: const Icon(Icons.camera_alt_outlined, color: Colors.white),
            onPressed: () {},
            tooltip: 'Create reel',
          ),
        ],
      ),
      body: feed.when(
        loading: () => const _ReelsSkeleton(),
        error: (err, _) => _ReelsError(
          onRetry: () => ref.invalidate(trendingProvider),
        ),
        data: (events) {
          final reels = events.take(20).toList();
          if (reels.isEmpty) return const _EmptyReels();
          return PageView.builder(
            controller: _pageController,
            scrollDirection: Axis.vertical,
            itemCount: reels.length,
            itemBuilder: (context, i) => _ReelPage(
              index: i,
              authorPubkey: reels[i].pubkey,
              caption: reels[i].content,
            ),
          );
        },
      ),
    );
  }
}

class _ReelPage extends ConsumerWidget {
  final int index;
  final String authorPubkey;
  final String caption;
  const _ReelPage({
    required this.index,
    required this.authorPubkey,
    required this.caption,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profileAsync = ref.watch(profileProvider(authorPubkey));
    final likes = 42 + (index * 137) % 900;
    final comments = 5 + (index * 31) % 120;

    return Stack(
      fit: StackFit.expand,
      children: [
        // Video placeholder
        Container(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [
                Colors.deepPurple.shade900,
                Colors.black,
                Colors.indigo.shade900,
              ],
            ),
          ),
          child: const Center(
            child: Icon(Icons.play_circle_outline,
                size: 80, color: Colors.white54),
          ),
        ),

        // Right action column
        Positioned(
          right: 12,
          bottom: 100,
          child: Column(
            children: [
              _ReelAction(
                icon: Icons.favorite,
                label: _formatCount(likes),
                color: Colors.redAccent,
                onTap: () {},
              ),
              const SizedBox(height: 20),
              _ReelAction(
                icon: Icons.chat_bubble_outline,
                label: _formatCount(comments),
                onTap: () {},
              ),
              const SizedBox(height: 20),
              _ReelAction(
                icon: Icons.share_outlined,
                label: 'Share',
                onTap: () {},
              ),
              const SizedBox(height: 20),
              _ReelAction(
                icon: Icons.bookmark_border,
                label: 'Save',
                onTap: () {},
              ),
              const SizedBox(height: 20),
              _ReelAction(
                icon: Icons.bolt,
                label: 'Zap',
                color: Colors.amber,
                onTap: () {},
              ),
            ],
          ),
        ),

        // Bottom author + caption
        Positioned(
          left: 16,
          right: 80,
          bottom: 32,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  profileAsync.when(
                    data: (profile) => CircleAvatar(
                      radius: 18,
                      backgroundImage: profile?.picture != null
                          ? CachedNetworkImageProvider(profile!.picture!)
                          : null,
                      child: profile?.picture == null
                          ? const Icon(Icons.person, size: 18)
                          : null,
                    ),
                    loading: () => const CircleAvatar(radius: 18),
                    error: (_, _) =>
                        const CircleAvatar(radius: 18, child: Icon(Icons.person, size: 18)),
                  ),
                  const SizedBox(width: 10),
                  Text(
                    profileAsync.value?.displayNameOrName ??
                        '${authorPubkey.substring(0, 8)}…',
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(width: 10),
                  OutlinedButton(
                    onPressed: () {},
                    style: OutlinedButton.styleFrom(
                      foregroundColor: Colors.white,
                      side: const BorderSide(color: Colors.white),
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                      minimumSize: const Size(0, 28),
                    ),
                    child: const Text('Follow', style: TextStyle(fontSize: 12)),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Text(
                caption,
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(color: Colors.white, fontSize: 13),
              ),
            ],
          ),
        ),
      ],
    );
  }

  String _formatCount(int n) {
    if (n >= 1000) return '${(n / 1000).toStringAsFixed(1)}k';
    return '$n';
  }
}

class _ReelAction extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color? color;
  final VoidCallback onTap;
  const _ReelAction({
    required this.icon,
    required this.label,
    required this.onTap,
    this.color,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Column(
        children: [
          Icon(icon, color: color ?? Colors.white, size: 30),
          const SizedBox(height: 4),
          Text(label,
              style: const TextStyle(color: Colors.white, fontSize: 11)),
        ],
      ),
    );
  }
}

class _EmptyReels extends StatelessWidget {
  const _EmptyReels();

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.video_library_outlined, size: 64, color: Colors.white54),
          SizedBox(height: 16),
          Text('No reels yet',
              style: TextStyle(color: Colors.white, fontSize: 18)),
          SizedBox(height: 8),
          Text('Short videos from Nostr will appear here.',
              style: TextStyle(color: Colors.white54)),
        ],
      ),
    );
  }
}

class _ReelsSkeleton extends StatelessWidget {
  const _ReelsSkeleton();

  @override
  Widget build(BuildContext context) {
    return Shimmer.fromColors(
      baseColor: Colors.grey.shade900,
      highlightColor: Colors.grey.shade800,
      child: Container(color: Colors.black),
    );
  }
}

class _ReelsError extends StatelessWidget {
  final VoidCallback onRetry;
  const _ReelsError({required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.cloud_off, size: 56, color: Colors.white54),
          const SizedBox(height: 16),
          const Text('Failed to load reels',
              style: TextStyle(color: Colors.white, fontSize: 16)),
          const SizedBox(height: 16),
          FilledButton.tonalIcon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh),
            label: const Text('Retry'),
          ),
        ],
      ),
    );
  }
}
