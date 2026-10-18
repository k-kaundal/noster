import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:share_plus/share_plus.dart';
import 'package:timeago/timeago.dart' as timeago;

import '../../models/nostr_models.dart';
import '../../providers/app_providers.dart';
import '../../services/auth_service.dart';
import '../zap/zap_sheet.dart';
import 'note_content.dart';

/// A rich post card displaying a Nostr event with author info,
/// rich content (links, hashtags, mentions, images), and action buttons.
/// Handles reposts (kind 6/16) by rendering the embedded original event.
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

    // ─── Handle reposts (kind 6 / 16) ───────────────────────────────
    // For reposts, we render: "X reposted" header + the embedded original
    final repostedEvent = extractRepostedEvent(event);
    final displayEvent = repostedEvent ?? event;
    final isRepost = repostedEvent != null;

    final profileAsync = ref.watch(profileProvider(displayEvent.pubkey));
    final reposterProfileAsync = isRepost
        ? ref.watch(profileProvider(event.pubkey))
        : null;
    final repliesAsync = ref.watch(repliesProvider(displayEvent.id));
    final reactionsAsync = ref.watch(reactionsProvider(displayEvent.id));
    final repostsAsync = ref.watch(repostsProvider(displayEvent.id));
    final followsAsync = ref.watch(followsProvider);
    final bookmarkedIdsAsync = ref.watch(bookmarkedIdsProvider);
    final auth = ref.watch(authStateProvider);

    final profile = profileAsync.valueOrNull;
    final authorName = profile?.displayNameOrName ?? _truncatedNpub(displayEvent.pubkey);
    final authorPicture = profile?.picture;
    final timestamp = DateTime.fromMillisecondsSinceEpoch(displayEvent.createdAt * 1000);
    final timeAgo = timeago.format(timestamp);

    final replyCount = repliesAsync.valueOrNull?.length ?? 0;
    final reactionCount = reactionsAsync.valueOrNull?.length ?? 0;
    final repostCount = repostsAsync.valueOrNull?.length ?? 0;

    final follows = followsAsync.valueOrNull ?? [];
    final isFollowing = follows.contains(displayEvent.pubkey);
    final isOwnPost = auth.pubkey == displayEvent.pubkey;
    final bookmarkedIds = bookmarkedIdsAsync.valueOrNull ?? <String>{};
    final isBookmarked = bookmarkedIds.contains(displayEvent.id);

    return Container(
      decoration: BoxDecoration(
        border: Border(
          bottom: BorderSide(
            color: colorScheme.outlineVariant.withValues(alpha: 0.5),
            width: 0.5,
          ),
        ),
      ),
      child: InkWell(
        onTap: isThreadView
            ? null
            : () => context.push('/thread', extra: displayEvent),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // ─── Repost header ─────────────────────────────────
              if (isRepost) ...[
                Row(
                  children: [
                    Icon(
                      Icons.repeat,
                      size: 16,
                      color: colorScheme.onSurfaceVariant,
                    ),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        '${reposterProfileAsync?.valueOrNull?.displayNameOrName ?? _truncatedNpub(event.pubkey)} reposted',
                        style: TextStyle(
                          fontSize: 13,
                          color: colorScheme.onSurfaceVariant,
                          fontWeight: FontWeight.w500,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
              ],

              // ─── Author row ────────────────────────────────────
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Avatar
                  GestureDetector(
                    onTap: () => context.push('/profile/${displayEvent.pubkey}'),
                    child: CircleAvatar(
                      radius: 22,
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
                                fontSize: 16,
                              ),
                            )
                          : null,
                    ),
                  ),
                  const SizedBox(width: 12),
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
                            if (profile?.nip05 != null && profile!.nip05!.isNotEmpty) ...[
                              const SizedBox(width: 4),
                              Icon(
                                Icons.verified,
                                size: 15,
                                color: colorScheme.primary,
                              ),
                            ],
                          ],
                        ),
                        const SizedBox(height: 1),
                        Text(
                          '${_truncatedNpub(displayEvent.pubkey)} · $timeAgo',
                          style: TextStyle(
                            color: colorScheme.onSurfaceVariant,
                            fontSize: 13,
                          ),
                        ),
                      ],
                    ),
                  ),
                  // Follow button
                  if (auth.isLoggedIn && !isOwnPost)
                    _FollowButton(
                      pubkey: displayEvent.pubkey,
                      isFollowing: isFollowing,
                    ),
                ],
              ),
              const SizedBox(height: 10),

              // ─── Content ───────────────────────────────────────
              NoteContent(event: displayEvent),
              const SizedBox(height: 12),

              // ─── Action bar ────────────────────────────────────
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  _ActionButton(
                    icon: Icons.chat_bubble_outline,
                    count: replyCount,
                    onTap: isThreadView
                        ? null
                        : () => context.push('/thread', extra: displayEvent),
                  ),
                  _ActionButton(
                    icon: Icons.repeat,
                    count: repostCount,
                    color: colorScheme.secondary,
                    onTap: () => _handleRepost(context, ref, auth, displayEvent),
                  ),
                  _ActionButton(
                    icon: Icons.favorite_border,
                    count: reactionCount,
                    color: Colors.red,
                    onTap: () => _handleLike(context, ref, auth, displayEvent),
                  ),
                  _ActionButton(
                    icon: Icons.bolt,
                    count: 0,
                    color: Colors.amber.shade700,
                    onTap: () => _handleZap(context, ref, auth, displayEvent),
                  ),
                  _ActionButton(
                    icon: isBookmarked ? Icons.bookmark : Icons.bookmark_border,
                    count: 0,
                    color: isBookmarked ? colorScheme.primary : null,
                    onTap: () => _handleBookmark(context, ref, auth, isBookmarked, displayEvent),
                  ),
                  _ActionButton(
                    icon: Icons.share_outlined,
                    count: 0,
                    onTap: () => _handleShare(context, ref, displayEvent),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  String _truncatedNpub(String pubkey) {
    if (pubkey.length <= 16) return pubkey;
    return '${pubkey.substring(0, 8)}…${pubkey.substring(pubkey.length - 4)}';
  }

  void _handleRepost(BuildContext context, WidgetRef ref, AuthState auth, NostrEvent displayEvent) {
    if (!auth.isLoggedIn || auth.isReadOnly) {
      _showLoginPrompt(context);
      return;
    }
    final nostr = ref.read(nostrServiceProvider);
    final repostEvent = nostr.createRepost(displayEvent);
    nostr.publish(repostEvent);
    ref.invalidate(repostsProvider(displayEvent.id));
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Reposted!')),
    );
  }

  void _handleLike(BuildContext context, WidgetRef ref, AuthState auth, NostrEvent displayEvent) {
    if (!auth.isLoggedIn || auth.isReadOnly) {
      _showLoginPrompt(context);
      return;
    }
    final nostr = ref.read(nostrServiceProvider);
    final reactionEvent = nostr.createReaction(displayEvent);
    nostr.publish(reactionEvent);
    ref.invalidate(reactionsProvider(displayEvent.id));
  }

  void _handleZap(BuildContext context, WidgetRef ref, AuthState auth, NostrEvent displayEvent) {
    showZapDialog(
      context: context,
      targetEvent: displayEvent,
      targetPubkey: displayEvent.pubkey,
    );
  }

  Future<void> _handleBookmark(
      BuildContext context, WidgetRef ref, AuthState auth, bool isBookmarked, NostrEvent displayEvent) async {
    if (!auth.isLoggedIn || auth.isReadOnly) {
      _showLoginPrompt(context);
      return;
    }
    try {
      final nostr = ref.read(nostrServiceProvider);
      await nostr.toggleBookmark(displayEvent.id, isBookmarked);
      ref.invalidate(bookmarkedIdsProvider);
      ref.invalidate(bookmarksProvider);
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(isBookmarked ? 'Bookmark removed' : 'Bookmarked!'),
            duration: const Duration(seconds: 1),
          ),
        );
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to bookmark: $e')),
        );
      }
    }
  }

  void _handleShare(BuildContext context, WidgetRef ref, NostrEvent displayEvent) {
    final nostr = ref.read(nostrServiceProvider);
    final note1 = nostr.authService.encodeNote(displayEvent.id);
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
      height: 30,
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
                  color: colorScheme.onSurfaceVariant,
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
    final effectiveColor = color ?? colorScheme.onSurfaceVariant;

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(20),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 19, color: effectiveColor),
            if (count > 0) ...[
              const SizedBox(width: 5),
              Text(
                _formatCount(count),
                style: TextStyle(
                  color: effectiveColor,
                  fontSize: 13,
                  fontWeight: FontWeight.w500,
                ),
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
