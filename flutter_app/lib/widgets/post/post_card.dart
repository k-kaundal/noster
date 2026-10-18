import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:share_plus/share_plus.dart';
import 'package:timeago/timeago.dart' as timeago;

import '../../models/nostr_models.dart';
import '../../providers/app_providers.dart';
import '../../services/auth_service.dart';

/// A rich post card displaying a Nostr event with author info,
/// content, hashtags, and action buttons.
class PostCard extends ConsumerWidget {
  final NostrEvent event;
  final bool isThreadView;

  const PostCard({
    super.key,
    required this.event,
    this.isThreadView = false,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colorScheme = Theme.of(context).colorScheme;
    final profileAsync = ref.watch(profileProvider(event.pubkey));
    final repliesAsync = ref.watch(repliesProvider(event.id));
    final reactionsAsync = ref.watch(reactionsProvider(event.id));
    final repostsAsync = ref.watch(repostsProvider(event.id));
    final followsAsync = ref.watch(followsProvider);
    final auth = ref.watch(authStateProvider);

    final profile = profileAsync.valueOrNull;
    final authorName = profile?.displayNameOrName ?? _truncatedNpub(event.pubkey);
    final authorPicture = profile?.picture;
    final timestamp = DateTime.fromMillisecondsSinceEpoch(event.createdAt * 1000);
    final timeAgo = timeago.format(timestamp);

    final replyCount = repliesAsync.valueOrNull?.length ?? 0;
    final reactionCount = reactionsAsync.valueOrNull?.length ?? 0;
    final repostCount = repostsAsync.valueOrNull?.length ?? 0;

    final follows = followsAsync.valueOrNull ?? [];
    final isFollowing = follows.contains(event.pubkey);
    final isOwnPost = auth.pubkey == event.pubkey;

    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      child: InkWell(
        onTap: isThreadView
            ? null
            : () => context.push('/thread', extra: event),
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // ─── Author row ───────────────────────────────────────
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Avatar
                  GestureDetector(
                    onTap: () => context.push('/profile/${event.pubkey}'),
                    child: CircleAvatar(
                      radius: 20,
                      backgroundColor: colorScheme.primaryContainer,
                      backgroundImage: authorPicture != null && authorPicture.isNotEmpty
                          ? CachedNetworkImageProvider(authorPicture)
                          : null,
                      child: authorPicture == null || authorPicture.isEmpty
                          ? Text(
                              authorName.isNotEmpty ? authorName[0].toUpperCase() : '?',
                              style: TextStyle(
                                color: colorScheme.onPrimaryContainer,
                                fontWeight: FontWeight.bold,
                              ),
                            )
                          : null,
                    ),
                  ),
                  const SizedBox(width: 10),
                  // Name / npub / timestamp
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Flexible(
                              child: Text(
                                authorName,
                                style: const TextStyle(
                                  fontWeight: FontWeight.bold,
                                  fontSize: 15,
                                ),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            if (profile?.nip05 != null) ...[
                              const SizedBox(width: 4),
                              Icon(
                                Icons.verified,
                                size: 14,
                                color: colorScheme.primary,
                              ),
                            ],
                          ],
                        ),
                        Text(
                          '${_truncatedNpub(event.pubkey)} · $timeAgo',
                          style: TextStyle(
                            color: colorScheme.onSurface.withValues(alpha: 0.6),
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                  ),
                  // Follow button
                  if (auth.isLoggedIn && !isOwnPost)
                    _FollowButton(
                      pubkey: event.pubkey,
                      isFollowing: isFollowing,
                    ),
                ],
              ),
              const SizedBox(height: 10),

              // ─── Content ──────────────────────────────────────────
              _buildContent(context, colorScheme),
              const SizedBox(height: 10),

              // ─── Action bar ───────────────────────────────────────
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceAround,
                children: [
                  _ActionButton(
                    icon: Icons.chat_bubble_outline,
                    count: replyCount,
                    onTap: isThreadView
                        ? null
                        : () => context.push('/thread', extra: event),
                  ),
                  _ActionButton(
                    icon: Icons.repeat,
                    count: repostCount,
                    color: colorScheme.secondary,
                    onTap: () => _handleRepost(context, ref, auth),
                  ),
                  _ActionButton(
                    icon: Icons.favorite_border,
                    count: reactionCount,
                    color: Colors.red,
                    onTap: () => _handleLike(context, ref, auth),
                  ),
                  _ActionButton(
                    icon: Icons.bolt,
                    count: 0,
                    color: Colors.amber,
                    onTap: () => _handleZap(context, ref, auth),
                  ),
                  _ActionButton(
                    icon: Icons.share_outlined,
                    count: 0,
                    onTap: () => _handleShare(context, ref),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ─── Content builder with hashtag highlighting ───────────────────

  Widget _buildContent(BuildContext context, ColorScheme colorScheme) {
    final content = event.content;
    final hashtags = event.hashtags.toSet();

    if (hashtags.isEmpty) {
      return Text(
        content,
        style: const TextStyle(fontSize: 15, height: 1.4),
      );
    }

    // Build spans to highlight hashtags
    final spans = <InlineSpan>[];
    final words = content.split(' ');

    for (var i = 0; i < words.length; i++) {
      final word = words[i];
      final stripped = word.replaceAll(RegExp(r'[#,]'), '').toLowerCase();
      final isHashtag = word.startsWith('#') && hashtags.contains(stripped);

      if (isHashtag) {
        spans.add(
          TextSpan(
            text: word,
            style: TextStyle(
              color: colorScheme.primary,
              fontWeight: FontWeight.w600,
            ),
          ),
        );
      } else {
        spans.add(TextSpan(text: word));
      }

      if (i < words.length - 1) {
        spans.add(const TextSpan(text: ' '));
      }
    }

    return Text.rich(
      TextSpan(
        style: TextStyle(
          fontSize: 15,
          height: 1.4,
          color: Theme.of(context).colorScheme.onSurface,
        ),
        children: spans,
      ),
    );
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  String _truncatedNpub(String pubkey) {
    if (pubkey.length <= 16) return pubkey;
    return '${pubkey.substring(0, 8)}...${pubkey.substring(pubkey.length - 4)}';
  }

  void _handleRepost(BuildContext context, WidgetRef ref, AuthState auth) {
    if (!auth.isLoggedIn || auth.isReadOnly) {
      _showLoginPrompt(context);
      return;
    }
    final nostr = ref.read(nostrServiceProvider);
    final repostEvent = nostr.createRepost(event);
    nostr.publish(repostEvent);
    ref.invalidate(repostsProvider(event.id));
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Reposted!')),
    );
  }

  void _handleLike(BuildContext context, WidgetRef ref, AuthState auth) {
    if (!auth.isLoggedIn || auth.isReadOnly) {
      _showLoginPrompt(context);
      return;
    }
    final nostr = ref.read(nostrServiceProvider);
    final reactionEvent = nostr.createReaction(event);
    nostr.publish(reactionEvent);
    ref.invalidate(reactionsProvider(event.id));
  }

  void _handleZap(BuildContext context, WidgetRef ref, AuthState auth) {
    if (!auth.isLoggedIn || auth.isReadOnly) {
      _showLoginPrompt(context);
      return;
    }
    // TODO: Integrate Lightning zap flow
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Zap coming soon! ⚡')),
    );
  }

  void _handleShare(BuildContext context, WidgetRef ref) {
    final nostr = ref.read(nostrServiceProvider);
    final note1 = nostr.authService.encodeNote(event.id);
    Share.share('nostr:$note1');
  }

  void _showLoginPrompt(BuildContext context) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Log in to interact with posts')),
    );
  }
}

// ─── Follow Button ─────────────────────────────────────────────────

class _FollowButton extends ConsumerWidget {
  final String pubkey;
  final bool isFollowing;

  const _FollowButton({
    required this.pubkey,
    required this.isFollowing,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colorScheme = Theme.of(context).colorScheme;

    return SizedBox(
      height: 32,
      child: isFollowing
          ? OutlinedButton(
              onPressed: () => _toggleFollow(ref),
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                side: BorderSide(color: colorScheme.outline),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
              ),
              child: Text(
                'Following',
                style: TextStyle(
                  fontSize: 12,
                  color: colorScheme.onSurface.withValues(alpha: 0.7),
                ),
              ),
            )
          : FilledButton(
              onPressed: () => _toggleFollow(ref),
              style: FilledButton.styleFrom(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
              ),
              child: const Text('Follow', style: TextStyle(fontSize: 12)),
            ),
    );
  }

  Future<void> _toggleFollow(WidgetRef ref) async {
    final auth = ref.read(authStateProvider);
    if (!auth.isLoggedIn || auth.isReadOnly) return;

    final nostr = ref.read(nostrServiceProvider);
    final follows = ref.read(followsProvider).valueOrNull ?? [];

    final updated = isFollowing
        ? follows.where((pk) => pk != pubkey).toList()
        : [...follows, pubkey];

    final event = nostr.updateFollows(updated);
    nostr.publish(event);
    ref.invalidate(followsProvider);
  }
}

// ─── Action Button ─────────────────────────────────────────────────

class _ActionButton extends StatelessWidget {
  final IconData icon;
  final int count;
  final VoidCallback? onTap;
  final Color? color;

  const _ActionButton({
    required this.icon,
    required this.count,
    this.onTap,
    this.color,
  });

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final effectiveColor = color ?? colorScheme.onSurface.withValues(alpha: 0.6);

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(20),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 18, color: effectiveColor),
            if (count > 0) ...[
              const SizedBox(width: 4),
              Text(
                _formatCount(count),
                style: TextStyle(color: effectiveColor, fontSize: 13),
              ),
            ],
          ],
        ),
      ),
    );
  }

  String _formatCount(int count) {
    if (count >= 1000000) return '${(count / 1000000).toStringAsFixed(1)}M';
    if (count >= 1000) return '${(count / 1000).toStringAsFixed(1)}K';
    return count.toString();
  }
}
