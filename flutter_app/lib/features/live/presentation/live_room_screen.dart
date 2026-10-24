import 'dart:async';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/core/widgets/safe_image.dart';
import 'package:nostrfeed_mobile/core/widgets/smart_network_image.dart';
import 'package:nostrfeed_mobile/features/live/application/live_providers.dart';
import 'package:nostrfeed_mobile/features/live/domain/live_event.dart';
import 'package:nostrfeed_mobile/features/zap/presentation/zap_sheet.dart';
import 'package:timeago/timeago.dart' as timeago;
import 'package:url_launcher/url_launcher.dart';
import 'package:video_player/video_player.dart';

/// Live room: video player + live chat (NIP-53 kind 1311) + zap.
class LiveRoomScreen extends ConsumerStatefulWidget {
  final LiveEvent event;
  const LiveRoomScreen({super.key, required this.event});

  @override
  ConsumerState<LiveRoomScreen> createState() => _LiveRoomScreenState();
}

class _LiveRoomScreenState extends ConsumerState<LiveRoomScreen> {
  final _chatController = TextEditingController();
  final _scrollController = ScrollController();
  final List<NostrEvent> _chatMessages = [];
  final Set<String> _chatSeen = {};
  StreamSubscription<NostrEvent>? _liveChatSub;
  VideoPlayerController? _videoController;
  bool _videoReady = false;
  bool _sendingChat = false;

  @override
  void initState() {
    super.initState();
    _loadChat();
    _subscribeChat();
    _setupVideo();
  }

  @override
  void dispose() {
    _liveChatSub?.cancel();
    _chatController.dispose();
    _scrollController.dispose();
    _videoController?.dispose();
    super.dispose();
  }

  Future<void> _setupVideo() async {
    final url = widget.event.streamingUrl;
    if (url == null) return;
    try {
      final controller = VideoPlayerController.networkUrl(Uri.parse(url));
      _videoController = controller;
      await controller.initialize();
      if (!mounted) return;
      await controller.setLooping(true);
      if (widget.event.isLive) await controller.play();
      setState(() => _videoReady = true);
    } catch (_) {
      // Stream URL unreachable — show the thumbnail + chat instead.
    }
  }

  Future<void> _loadChat() async {
    try {
      final messages = await ref.read(liveChatProvider(widget.event.coordinate).future);
      if (!mounted) return;
      setState(() {
        for (final m in messages) {
          if (_chatSeen.add(m.id)) _chatMessages.add(m);
        }
        _chatMessages.sort((a, b) => b.createdAt.compareTo(a.createdAt));
      });
    } catch (_) {}
  }

  void _subscribeChat() {
    final nostr = ref.read(nostrServiceProvider);
    if (!nostr.isInitialized) return;
    _liveChatSub = nostr.subscribeLiveChat(widget.event.coordinate).listen((event) {
      if (!mounted) return;
      if (_chatSeen.add(event.id)) {
        setState(() => _chatMessages.insert(0, event));
      }
    });
  }

  Future<void> _sendChat() async {
    final text = _chatController.text.trim();
    if (text.isEmpty || _sendingChat) return;
    final auth = ref.read(authStateProvider);
    if (!auth.isLoggedIn || auth.isReadOnly) {
      AppToast.warning(context, 'Log in to chat');
      return;
    }
    HapticFeedback.lightImpact();
    setState(() => _sendingChat = true);
    try {
      final nostr = ref.read(nostrServiceProvider);
      final event = nostr.createLiveChatMessage(widget.event.coordinate, text);
      nostr.publishEvent(event);
      _chatController.clear();
      if (_chatSeen.add(event.id)) {
        setState(() => _chatMessages.insert(0, event));
      }
    } catch (e) {
      if (mounted) AppToast.error(context, 'Send failed: $e');
    } finally {
      if (mounted) setState(() => _sendingChat = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final hostAsync = ref.watch(profileProvider(widget.event.hostPubkey));
    final host = hostAsync.valueOrNull;
    final auth = ref.watch(authStateProvider);

    return Scaffold(
      backgroundColor: colorScheme.surface,
      appBar: AppBar(
        title: Row(
          children: [
            if (widget.event.isLive)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: Colors.red,
                  borderRadius: BorderRadius.circular(4),
                ),
                child: const Text(
                  'LIVE',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 10,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                widget.event.title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 16),
              ),
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.bolt_rounded, color: Colors.amber),
            tooltip: 'Zap the host',
            onPressed: () => showZapDialog(
              context: context,
              // Zap the live activity event itself (kind 30311).
              targetEvent: NostrEvent(
                id: widget.event.id,
                pubkey: widget.event.hostPubkey,
                createdAt: widget.event.updatedAt,
                kind: 30311,
                content: '',
                tags: [
                  ['d', widget.event.dTag],
                ],
                sig: '',
              ),
              targetPubkey: widget.event.hostPubkey,
            ),
          ),
        ],
      ),
      body: Column(
        children: [
          // ── Video / thumbnail ──
          AspectRatio(
            aspectRatio: 16 / 9,
            child: Container(
              color: Colors.black,
              child: _videoReady && _videoController != null
                  ? VideoPlayer(_videoController!)
                  : widget.event.image != null
                      ? CachedNetworkImage(
                          httpHeaders: kImageHttpHeaders,
                          imageUrl: widget.event.image!,
                          fit: BoxFit.cover,
                          errorWidget: (_, _, _) => const _VideoFallback(),
                        )
                      : const _VideoFallback(),
            ),
          ),

          // ── Host + info ──
          Padding(
            padding: const EdgeInsets.all(12),
            child: Row(
              children: [
                SafeAvatar(
                  imageUrl: host?.picture,
                  radius: 18,
                  fallback: const Icon(Icons.person, size: 18),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        host?.displayNameOrName ??
                            '${widget.event.hostPubkey.substring(0, 8)}…',
                        style: const TextStyle(
                            fontWeight: FontWeight.bold, fontSize: 14),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      if (widget.event.currentParticipants != null)
                        Text(
                          '${widget.event.currentParticipants} watching',
                          style: TextStyle(
                            fontSize: 11,
                            color: colorScheme.onSurfaceVariant,
                          ),
                        ),
                    ],
                  ),
                ),
                if (widget.event.streamingUrl != null)
                  IconButton(
                    icon: const Icon(Icons.open_in_new_rounded),
                    tooltip: 'Open stream',
                    onPressed: () => launchUrl(
                      Uri.parse(widget.event.streamingUrl!),
                      mode: LaunchMode.externalApplication,
                    ),
                  ),
              ],
            ),
          ),
          Divider(height: 1, color: colorScheme.outlineVariant.withValues(alpha: 0.5)),

          // ── Live chat ──
          Expanded(
            child: _chatMessages.isEmpty
                ? Center(
                    child: Text(
                      'No chat messages yet — say hi!',
                      style: TextStyle(color: colorScheme.onSurfaceVariant),
                    ),
                  )
                : ListView.builder(
                    controller: _scrollController,
                    reverse: true,
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    itemCount: _chatMessages.length,
                    itemBuilder: (context, index) =>
                        _ChatMessage(event: _chatMessages[index]),
                  ),
          ),

          // ── Chat input ──
          Container(
            padding: EdgeInsets.only(
              left: 12,
              right: 8,
              top: 6,
              bottom: MediaQuery.of(context).viewPadding.bottom + 6,
            ),
            decoration: BoxDecoration(
              color: colorScheme.surface,
              border: Border(
                top: BorderSide(
                  color: colorScheme.outlineVariant.withValues(alpha: 0.5),
                ),
              ),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Container(
                    decoration: BoxDecoration(
                      color: colorScheme.surfaceContainerHighest
                          .withValues(alpha: 0.6),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: TextField(
                      controller: _chatController,
                      decoration: const InputDecoration(
                        hintText: 'Chat…',
                        border: InputBorder.none,
                        contentPadding: EdgeInsets.symmetric(
                          horizontal: 14,
                          vertical: 9,
                        ),
                      ),
                      enabled: auth.isLoggedIn && !auth.isReadOnly,
                      onSubmitted: (_) => _sendChat(),
                    ),
                  ),
                ),
                IconButton(
                  onPressed: _sendingChat ? null : _sendChat,
                  icon: _sendingChat
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : Icon(Icons.send_rounded, color: colorScheme.primary),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ChatMessage extends ConsumerWidget {
  final NostrEvent event;
  const _ChatMessage({required this.event});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colorScheme = Theme.of(context).colorScheme;
    final profileAsync = ref.watch(profileProvider(event.pubkey));
    final profile = profileAsync.valueOrNull;
    final name = profile?.displayNameOrName ??
        '${event.pubkey.substring(0, 8)}…';
    final time = DateTime.fromMillisecondsSinceEpoch(event.createdAt * 1000);

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SafeAvatar(
            imageUrl: profile?.picture,
            radius: 14,
            fallback: Text(
              firstGrapheme(name),
              style: const TextStyle(fontSize: 10),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        name,
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: colorScheme.primary,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    const SizedBox(width: 6),
                    Text(
                      timeago.format(time, locale: 'en_short'),
                      style: TextStyle(
                        fontSize: 10,
                        color: colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 2),
                Text(
                  event.content,
                  style: const TextStyle(fontSize: 13, height: 1.3),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _VideoFallback extends StatelessWidget {
  const _VideoFallback();

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Icon(Icons.play_circle_outline_rounded,
          color: Colors.white54, size: 56),
    );
  }
}
