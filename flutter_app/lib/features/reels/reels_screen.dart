import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:share_plus/share_plus.dart';
import 'package:video_player/video_player.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/widgets/empty_state.dart';
import 'package:nostrfeed_mobile/core/widgets/error_view.dart';
import 'package:nostrfeed_mobile/core/widgets/smart_network_image.dart';
import 'package:nostrfeed_mobile/features/zap/zap_sheet.dart';

class ReelsScreen extends ConsumerStatefulWidget {
  const ReelsScreen({super.key});

  @override
  ConsumerState<ReelsScreen> createState() => _ReelsScreenState();
}

class _ReelsScreenState extends ConsumerState<ReelsScreen> {
  final PageController _pageController = PageController();
  int _currentIndex = 0;

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
        loading: () => const Center(
          child: CircularProgressIndicator(color: Colors.white54),
        ),
        error: (err, _) => ErrorView(
          message: 'Failed to load reels',
          onRetry: () => ref.invalidate(videosProvider),
        ),
        data: (events) {
          final playable =
              events.where((e) => _ReelVideoSource.of(e) != null).toList();
          if (playable.isEmpty) {
            return const EmptyState(
              icon: Icons.video_library_outlined,
              title: 'No reels yet',
              subtitle: 'Short videos from Nostr will appear here.',
              iconColor: Colors.white54,
            );
          }
          return PageView.builder(
            controller: _pageController,
            scrollDirection: Axis.vertical,
            // AlwaysScrollable ensures the page view takes drags even when a
            // child gesture arena is competing for them (the tap-to-pause
            // detector inside each reel page)
            physics: const AlwaysScrollableScrollPhysics(),
            itemCount: playable.length,
            onPageChanged: (i) => setState(() => _currentIndex = i),
            itemBuilder: (context, i) => _ReelPage(
              key: ValueKey(playable[i].id),
              event: playable[i],
              // Only the reel on screen plays — the rest pause to save
              // bandwidth and battery, same as Instagram
              isActive: i == _currentIndex,
            ),
          );
        },
      ),
    );
  }
}

/// Where the video actually lives.
///
/// NIP-71 puts the playable source in `imeta` tags; kind-1 reposts of the
/// same idea put the URL in the body. Both are checked, imeta first because
/// it carries the poster and is the canonical source.
class _ReelVideoSource {
  final String url;
  final String? poster;

  const _ReelVideoSource(this.url, {this.poster});

  static _ReelVideoSource? of(NostrEvent event) {
    // imeta tags — NIP-71 format: ["imeta", "url <x>", "image <poster>", ...]
    for (final tag in event.tags) {
      if (tag.isEmpty || tag[0] != 'imeta') continue;
      String? url;
      String? poster;
      bool isVideo = false;
      for (var i = 1; i < tag.length; i++) {
        final part = tag[i];
        if (part.startsWith('url ')) url = part.substring(4).trim();
        if (part.startsWith('image ')) poster = part.substring(6).trim();
        if (part.startsWith('m video/')) isVideo = true;
      }
      if (url != null && (isVideo || _looksLikeVideo(url))) {
        return _ReelVideoSource(url, poster: poster);
      }
    }

    // Fallback: a video URL in the note body
    final urlRegex = RegExp(
      r'https?://[^\s]+\.(mp4|mov|webm|m4v)(\?[^\s]*)?',
      caseSensitive: false,
    );
    final match = urlRegex.firstMatch(event.content);
    if (match != null) return _ReelVideoSource(match.group(0)!);

    return null;
  }

  static bool _looksLikeVideo(String url) {
    return RegExp(r'\.(mp4|mov|webm|m4v)(\?|$)', caseSensitive: false)
        .hasMatch(url);
  }
}

class _ReelPage extends ConsumerStatefulWidget {
  final NostrEvent event;
  final bool isActive;

  const _ReelPage({super.key, required this.event, required this.isActive});

  @override
  ConsumerState<_ReelPage> createState() => _ReelPageState();
}

class _ReelPageState extends ConsumerState<_ReelPage> {
  VideoPlayerController? _controller;
  bool _initialized = false;
  bool _showPlayIcon = false;
  bool _muted = false;

  /// Tracks whether the current pointer sequence is a tap (vs a scroll).
  /// Set on pointer down, cleared when the pointer moves more than a few
  /// pixels, and read on pointer up to decide whether to toggle playback.
  bool _tapDown = false;

  @override
  void initState() {
    super.initState();
    _setup();
  }

  Future<void> _setup() async {
    final source = _ReelVideoSource.of(widget.event);
    if (source == null) return;

    final controller =
        VideoPlayerController.networkUrl(Uri.parse(source.url));
    _controller = controller;

    try {
      await controller.initialize();
      if (!mounted) return;
      await controller.setLooping(true);
      setState(() => _initialized = true);
      _syncPlayback();
    } catch (_) {
      // A video that won't load shouldn't crash the rest of the feed
    }
  }

  void _syncPlayback() {
    final controller = _controller;
    if (controller == null || !_initialized) return;

    if (widget.isActive) {
      controller.play();
    } else {
      controller.pause();
      // Reset so the next visit starts from the top, like Instagram
      controller.seekTo(Duration.zero);
    }
  }

  @override
  void didUpdateWidget(_ReelPage old) {
    super.didUpdateWidget(old);
    if (old.isActive != widget.isActive) _syncPlayback();
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  void _togglePlay() {
    final controller = _controller;
    if (controller == null || !_initialized) return;

    setState(() {
      if (controller.value.isPlaying) {
        controller.pause();
        _showPlayIcon = true;
      } else {
        controller.play();
        _showPlayIcon = false;
      }
    });
  }

  void _toggleMute() {
    final controller = _controller;
    if (controller == null) return;
    setState(() {
      _muted = !_muted;
      controller.setVolume(_muted ? 0 : 1);
    });
  }

  Future<void> _share() async {
    final source = _ReelVideoSource.of(widget.event);
    final url = source?.url ?? 'nostr:${widget.event.id}';
    // sharePositionOrigin is required on iOS to anchor the share sheet
    final box = context.findRenderObject() as RenderBox?;
    final origin = box != null
        ? box.localToGlobal(Offset.zero) & box.size
        : const Rect.fromLTWH(0, 0, 100, 100);
    await Share.share(url, subject: 'Nostr reel', sharePositionOrigin: origin);
  }

  void _handleLike() {
    final auth = ref.read(authStateProvider);
    if (!auth.isLoggedIn || auth.isReadOnly) {
      _showLoginPrompt();
      return;
    }
    final nostr = ref.read(nostrServiceProvider);
    nostr.publish(nostr.createReaction(widget.event));
    ref.invalidate(reactionsProvider(widget.event.id));
    ref.invalidate(engagementProvider(widget.event.id));
  }

  void _handleComment() {
    final auth = ref.read(authStateProvider);
    if (!auth.isLoggedIn || auth.isReadOnly) {
      _showLoginPrompt();
      return;
    }
    // Reels comment thread is the same thread view the feed uses
    context.push('/thread', extra: widget.event);
  }

  void _handleZap() {
    showZapDialog(
      context: context,
      targetEvent: widget.event,
      targetPubkey: widget.event.pubkey,
    );
  }

  void _showLoginPrompt() {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Log in to interact with reels')),
    );
  }

  @override
  Widget build(BuildContext context) {
    final profileAsync = ref.watch(profileProvider(widget.event.pubkey));
    final engagementAsync = ref.watch(engagementProvider(widget.event.id));

    final engagement = engagementAsync.valueOrNull;
    final likes = engagement?.reactions ?? 0;
    final comments = engagement?.replies ?? 0;
    final source = _ReelVideoSource.of(widget.event);
    final controller = _controller;

    return Stack(
      fit: StackFit.expand,
      children: [
        // Video — tap to play/pause, drag to scroll. A raw Listener is used
        // instead of GestureDetector because tap and vertical-drag recognizers
        // fight in the gesture arena, and the drag must always win so the
        // PageView can scroll. Listener does no arena negotiation: it just
        // watches pointer events and fires a tap when the pointer barely moved.
        Listener(
          behavior: HitTestBehavior.translucent,
          onPointerDown: (_) => _tapDown = true,
          onPointerMove: (event) {
            // More than ~8 logical pixels of movement is a scroll, not a tap
            if (event.delta.distance > 8) _tapDown = false;
          },
          onPointerUp: (_) {
            if (_tapDown) _togglePlay();
            _tapDown = false;
          },
          onPointerCancel: (_) => _tapDown = false,
          child: Container(
            color: Colors.black,
            child: _initialized && controller != null
                ? Center(
                    child: AspectRatio(
                      aspectRatio: controller.value.aspectRatio,
                      child: VideoPlayer(controller),
                    ),
                  )
                : source?.poster != null
                    ? SmartNetworkImage(
                        url: source!.poster!,
                        fit: BoxFit.contain,
                        placeholder: (_, _) => const _VideoLoading(),
                        errorWidget: (_, _, _) => const _VideoLoading(),
                      )
                    : const _VideoLoading(),
          ),
        ),

        // Paused indicator — only shown after the user pauses, not on load
        if (_showPlayIcon && _initialized)
          IgnorePointer(
            child: Center(
              child: Icon(
                Icons.play_arrow,
                size: 80,
                color: Colors.white.withValues(alpha: 0.8),
              ),
            ),
          ),

        // Mute toggle
        if (_initialized)
          Positioned(
            top: MediaQuery.of(context).padding.top + 56,
            right: 12,
            child: IconButton(
              onPressed: _toggleMute,
              icon: Icon(
                _muted ? Icons.volume_off : Icons.volume_up,
                color: Colors.white,
              ),
              style: IconButton.styleFrom(
                backgroundColor: Colors.black45,
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
                onTap: _handleLike,
              ),
              const SizedBox(height: 20),
              _ReelAction(
                icon: Icons.chat_bubble_outline,
                label: _formatCount(comments),
                onTap: _handleComment,
              ),
              const SizedBox(height: 20),
              _ReelAction(
                icon: Icons.share_outlined,
                label: 'Share',
                onTap: _share,
              ),
              const SizedBox(height: 20),
              _ReelAction(
                icon: Icons.bolt,
                label: 'Zap',
                color: Colors.amber,
                onTap: _handleZap,
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
                    error: (_, _) => const CircleAvatar(
                        radius: 18, child: Icon(Icons.person, size: 18)),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      profileAsync.value?.displayNameOrName ??
                          '${widget.event.pubkey.substring(0, 8)}…',
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
                widget.event.content,
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
    return n > 0 ? '$n' : '';
  }
}

class _VideoLoading extends StatelessWidget {
  const _VideoLoading();

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: CircularProgressIndicator(color: Colors.white54),
    );
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
      onTap: () {
        HapticFeedback.lightImpact();
        onTap();
      },
      child: Column(
        children: [
          Icon(icon, color: color ?? Colors.white, size: 30),
          if (label.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(label,
                style: const TextStyle(color: Colors.white, fontSize: 11)),
          ],
        ],
      ),
    );
  }
}


