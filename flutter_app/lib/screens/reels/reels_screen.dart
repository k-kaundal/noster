import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:shimmer/shimmer.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../providers/app_providers.dart';
import '../../models/nostr_models.dart';

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
    final videosAsync = ref.watch(videosProvider);

    return Scaffold(
      backgroundColor: Colors.black,
      extendBodyBehindAppBar: true,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        title: const Text('Reels', style: TextStyle(color: Colors.white)),
      ),
      body: videosAsync.when(
        loading: () => const _ReelsSkeleton(),
        error: (err, _) => _ReelsError(
          onRetry: () => ref.invalidate(videosProvider),
        ),
        data: (events) {
          if (events.isEmpty) return const _EmptyReels();
          return PageView.builder(
            controller: _pageController,
            scrollDirection: Axis.vertical,
            itemCount: events.length,
            itemBuilder: (context, i) => _ReelPage(
              event: events[i],
            ),
          );
        },
      ),
    );
  }
}

class _ReelPage extends ConsumerWidget {
  final NostrEvent event;
  const _ReelPage({required this.event});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profileAsync = ref.watch(profileProvider(event.pubkey));
    final engagementAsync = ref.watch(engagementProvider(event.id));

    final engagement = engagementAsync.valueOrNull;
    final likes = engagement?.reactions ?? 0;
    final comments = engagement?.replies ?? 0;
    final videoUrl = _extractVideoUrl(event.content);

    return Stack(
      fit: StackFit.expand,
      children: [
        // Video area — tappable to open URL
        GestureDetector(
          onTap: videoUrl != null ? () => _openUrl(videoUrl) : null,
          child: Container(
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
            child: Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.play_circle_outline,
                      size: 80, color: Colors.white54),
                  if (videoUrl != null) ...[
                    const SizedBox(height: 16),
                    Text(
                      'Tap to play video',
                      style: TextStyle(color: Colors.white.withValues(alpha: 0.7)),
                    ),
                  ],
                ],
              ),
            ),
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
                  Expanded(
                    child: Text(
                      profileAsync.value?.displayNameOrName ??
                          '${event.pubkey.substring(0, 8)}…',
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.bold,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Text(
                event.content,
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

  String? _extractVideoUrl(String content) {
    final urlRegex = RegExp(r'https?://[^\s]+\.(mp4|mov|webm)', caseSensitive: false);
    final match = urlRegex.firstMatch(content);
    return match?.group(0);
  }

  Future<void> _openUrl(String url) async {
    final uri = Uri.parse(url);
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
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
