import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/moderation/content_filter.dart';
import 'package:nostrfeed_mobile/core/moderation/moderation_providers.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/theme/app_theme.dart';
import 'package:nostrfeed_mobile/core/utils/share_links.dart';
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';

import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/core/widgets/empty_state.dart';
import 'package:nostrfeed_mobile/core/widgets/error_view.dart';
import 'package:nostrfeed_mobile/core/widgets/safe_image.dart';
import 'package:nostrfeed_mobile/core/widgets/skeleton.dart';
import 'package:nostrfeed_mobile/core/widgets/smart_network_image.dart';
import 'package:nostrfeed_mobile/features/feed/application/post_actions.dart';
import 'package:nostrfeed_mobile/features/reels/data/reel_uploader.dart';
import 'package:nostrfeed_mobile/features/zap/presentation/zap_sheet.dart';
import 'package:share_plus/share_plus.dart';
import 'package:video_player/video_player.dart';

class ReelsScreen extends ConsumerStatefulWidget {
  const ReelsScreen({super.key});

  @override
  ConsumerState<ReelsScreen> createState() => _ReelsScreenState();
}

class _ReelsScreenState extends ConsumerState<ReelsScreen>
    with WidgetsBindingObserver {
  final PageController _pageController = PageController();
  int _currentIndex = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _pageController.dispose();
    super.dispose();
  }

  /// When the app lifecycle resumes (user navigates back to reels), force
  /// the keyboard down — a stale keyboard from the upload sheet would
  /// otherwise stay up over the feed and cover the bottom nav.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      FocusManager.instance.primaryFocus?.unfocus();
    }
  }

  @override
  Widget build(BuildContext context) {
    final videosAsync = ref.watch(videosProvider);

    // AppBar is owned by AppShell (hamburger → drawer).
    final auth = ref.watch(authStateProvider);
    final canPost = auth.isLoggedIn && !auth.isReadOnly;

    return Scaffold(
      backgroundColor: Colors.black, // token-guard: allow — immersive video surface
      extendBodyBehindAppBar: true,
      // Immersive full-screen reels (Instagram-style) — a floating back
      // button top-left since this is now a pushed detail page, not a tab.
      appBar: AppBar(
        backgroundColor: Colors.transparent, // token-guard: allow — immersive video surface
        elevation: 0,
        leading: IconButton(
          icon: const AppIcon('back', color: Colors.white), // token-guard: allow — immersive video surface
          tooltip: 'Back',
          onPressed: () {
            HapticFeedback.lightImpact();
            if (Navigator.of(context).canPop()) {
              Navigator.of(context).pop();
            } else {
              context.go('/feed');
            }
          },
        ),
        title: Text(
          'Reels',
          style: Theme.of(context).textTheme.titleLarge?.copyWith(
                color: Colors.white, // token-guard: allow — immersive video surface
                fontWeight: FontWeight.bold,
              ),
        ),
      ),
      // Upload reel — top-right, clear of the right action column.
      floatingActionButton: canPost
          ? FloatingActionButton.small(
              heroTag: 'reel_upload_fab',
              backgroundColor: Colors.white24, // token-guard: allow — immersive video surface
              onPressed: () => ReelUploader.show(context),
              tooltip: 'Upload reel',
              child: const AppIcon('plus', color: Colors.white), // token-guard: allow — immersive video surface
            )
          : null,
      floatingActionButtonLocation: FloatingActionButtonLocation.endTop,
      body: videosAsync.when(
        loading: () => Container(
          color: Colors.black, // token-guard: allow — immersive video surface
          child: const SkeletonList(itemCount: 3),
        ),
        error: (err, _) => ErrorView(
          message: 'Failed to load reels',
          onRetry: () => ref.invalidate(videosProvider),
        ),
        data: (events) {
          final playable = events
              .where((e) => _ReelVideoSource.of(e) != null)
              .toList();
          if (playable.isEmpty) {
            return RefreshIndicator(
              onRefresh: () async => ref.invalidate(videosProvider),
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                children: [
                  SizedBox(
                    height: 420,
                    child: EmptyState(
                      icon: Icons.video_library_outlined,
                      title: 'No reels yet',
                      subtitle: 'Short videos from Nostr will appear here — pull to refresh.',
                      iconColor: Colors.white54, // token-guard: allow — immersive video surface
                      action: canPost
                          ? FilledButton.icon(
                              onPressed: () => ReelUploader.show(context),
                              icon: const AppIcon('video'),
                              label: const Text('Upload the first reel'),
                            )
                          : null,
                    ),
                  ),
                ],
              ),
            );
          }
          // Pull-to-refresh on the reel page itself: a downward pull on the
          // first reel reloads the videos list (the "reels are stale"
          // complaint) — a PageView already takes vertical drags, so wrap
          // the FIRST page's overscroll only.
          return RefreshIndicator(
            onRefresh: () async => ref.invalidate(videosProvider),
            // The indicator measures the PageView's overscroll at the top.
            notificationPredicate: (_) => _currentIndex == 0,
            child: PageView.builder(
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
    return RegExp(
      r'\.(mp4|mov|webm|m4v)(\?|$)',
      caseSensitive: false,
    ).hasMatch(url);
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
  bool _captionExpanded = false;

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

    final controller = VideoPlayerController.networkUrl(Uri.parse(source.url));
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
    // Share the universal app link to this reel (opens the app → reel, or a
    // web preview), not a raw video URL or a `nostr:` string.
    final nostr = ref.read(nostrServiceProvider);
    final note1 = nostr.authService.encodeNote(widget.event.id);
    final url = ShareLinks.forNote(note1);
    // sharePositionOrigin is required on iOS to anchor the share sheet
    final box = context.findRenderObject() as RenderBox?;
    final origin = box != null
        ? box.localToGlobal(Offset.zero) & box.size
        : const Rect.fromLTWH(0, 0, 100, 100);
    await SharePlus.instance.share(ShareParams(text: url, subject: 'Nostr reel', sharePositionOrigin: origin));
  }

  void _handleLike() {
    final auth = ref.read(authStateProvider);
    if (!auth.isLoggedIn || auth.isReadOnly) {
      _showLoginPrompt();
      return;
    }
    // PostActions ingests the reaction into the store so the local count
    // moves instantly (raw publish left the count stale until a relay
    // round-trip — the "liked but count stays" bug). The reel's local
    // engagement check reads from the store, so currently-liked state comes
    // from userInteractionsProvider.
    final liked = ref.read(
      userInteractionsProvider(widget.event.id),
    ).valueOrNull?.likes[widget.event.id] ?? false;
    ref.read(postActionsProvider).toggleLike(
      event: widget.event,
      currentlyLiked: liked,
    );
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
    AppToast.warning(context, 'Log in to interact with reels');
  }

  @override
  Widget build(BuildContext context) {
    // Content filter (Play compliance): spam/explicit reels hide — a reel is
    // a video post, judged on its caption + hashtags (isMediaPost: its URLs
    // are the content, so the link-dump ratio doesn't apply — that rule hid
    // EVERY reel).
    final verdict = ref.watch(contentFilterProvider).verdictForEvent(
          widget.event,
          isMediaPost: true,
        );
    if (verdict.action == FilterAction.hide) {
      return Container(
        color: Colors.black, // token-guard: allow — immersive video surface
        child: const Center(
          child: Text(
            'Hidden by content filter',
            style: TextStyle(color: Colors.white54), // token-guard: allow — immersive video surface
          ),
        ),
      );
    }
    final profileAsync = ref.watch(profileProvider(widget.event.pubkey));
    // localEngagementProvider reads counts from the SQLite event_refs index
    // (a grouped COUNT, rebuilt only when engagement lands) — the per-reel
    // relay query (engagementProvider) was a round-trip per visible reel.
    final engagementAsync = ref.watch(localEngagementProvider(widget.event.id));

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
            color: Colors.black, // token-guard: allow — immersive video surface
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
              child: AppIcon('play', size: 80, color: Colors.white.withValues(alpha: 0.8), // token-guard: allow — immersive video surface
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
                color: Colors.white, // token-guard: allow — immersive video surface
              ),
              style: IconButton.styleFrom(backgroundColor: Colors.black45), // token-guard: allow — immersive video surface
            ),
          ),

        // Right action column
        Positioned(
          right: 12,
          bottom: 100,
          child: Column(
            children: [
              _ReelAction(
                icon: 'heart_filled',
                label: _formatCount(likes),
                color: AppActionColors.like(Brightness.dark),
                onTap: _handleLike,
              ),
              const SizedBox(height: 20),
              _ReelAction(
                icon: 'comment',
                label: _formatCount(comments),
                onTap: _handleComment,
              ),
              const SizedBox(height: 20),
              _ReelAction(
                icon: 'share',
                label: 'Share',
                onTap: _share,
              ),
              const SizedBox(height: 20),
              _ReelAction(
                icon: 'zap',
                label: 'Zap',
                color: AppActionColors.zap,
                onTap: _handleZap,
              ),
            ],
          ),
        ),

        // Bottom author + caption — author row taps through to the user's
        // profile (Instagram-style); caption expands on tap.
        Positioned(
          left: 16,
          right: 80,
          bottom: 32,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              GestureDetector(
                onTap: () {
                  HapticFeedback.lightImpact();
                  context.push('/profile/${widget.event.pubkey}');
                },
                child: Row(
                  children: [
                    profileAsync.when(
                      data: (profile) => SafeAvatar(
                        imageUrl: profile?.picture,
                        radius: 18,
                        fallback: const AppIcon('users', size: 18),
                      ),
                      loading: () => const CircleAvatar(radius: 18),
                      error: (_, _) => const CircleAvatar(
                        radius: 18,
                        child: AppIcon('users', size: 18),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        profileAsync.value?.displayNameOrName ??
                            '${widget.event.pubkey.substring(0, 8)}…',
                        style: Theme.of(context).textTheme.titleSmall?.copyWith(
                              color: Colors.white, // token-guard: allow — immersive video surface
                              fontWeight: FontWeight.bold,
                            ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    const AppIcon(
                      'chevron_r',
                      color: Colors.white70, // token-guard: allow — immersive video surface
                      size: AppIconSize.md,
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 10),
              // Caption — tap to expand (full details like Instagram).
              GestureDetector(
                onTap: () =>
                    setState(() => _captionExpanded = !_captionExpanded),
                child: Text(
                  widget.event.content,
                  maxLines: _captionExpanded ? 20 : 3,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: Colors.white, // token-guard: allow — immersive video surface
                        height: 1.35,
                      ),
                ),
              ),
              if (widget.event.content.length > 120 && !_captionExpanded)
                Text(
                  'more',
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: Colors.white70, // token-guard: allow — immersive video surface
                        fontWeight: FontWeight.w600,
                      ),
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
      child: CircularProgressIndicator(color: Colors.white54), // token-guard: allow — immersive video surface
    );
  }
}

class _ReelAction extends StatelessWidget {
  final String icon;
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
          AppIcon(
            icon,
            color: color ?? Colors.white, // token-guard: allow — immersive video surface
            size: AppIconSize.xl,
          ),
          if (label.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              label,
              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    color: Colors.white, // token-guard: allow — immersive video surface
                  ),
            ),
          ],
        ],
      ),
    );
  }
}
