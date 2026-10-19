import 'dart:convert';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nostrfeed_mobile/core/nostr/nostr_service.dart';
import 'package:share_plus/share_plus.dart';
import 'package:timeago/timeago.dart' as timeago;

import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/features/auth/services/auth_service.dart';
import 'package:nostrfeed_mobile/features/feed/providers/post_actions.dart';
import 'package:nostrfeed_mobile/features/zap/zap_sheet.dart';
import 'package:nostrfeed_mobile/features/feed/widgets/note_content.dart';

/// A rich post card displaying a Nostr event with author info,
/// rich content (links, hashtags, mentions, images), and action buttons.
/// Handles reposts (kind 6/16) by rendering the embedded original event.
class PostCard extends ConsumerStatefulWidget {
  final NostrEvent event;
  final bool isThreadView;

  const PostCard({super.key, required this.event, this.isThreadView = false});

  @override
  ConsumerState<PostCard> createState() => _PostCardState();
}

class _PostCardState extends ConsumerState<PostCard> {
  // Optimistic state — updated immediately on tap, then confirmed by relay.
  // null means "no optimistic action taken", true/false means "liked/unliked"
  // or "reposted/unreposted".
  bool? _optimisticLiked;
  bool? _optimisticReposted;

  @override
  void initState() {
    super.initState();
    _syncOptimistic();
  }

  @override
  void didUpdateWidget(PostCard old) {
    super.didUpdateWidget(old);
    if (old.event.id != widget.event.id) {
      _syncOptimistic();
    }
  }

  void _syncOptimistic() {
    // Reset optimistic state when the event changes
    _optimisticLiked = null;
    _optimisticReposted = null;
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;

    // ─── Handle reposts (kind 6 / 16) ───────────────────────────────
    final repostedEvent = extractRepostedEvent(widget.event);
    final displayEvent = repostedEvent ?? widget.event;
    final isRepost = repostedEvent != null;

    if (!_isDisplayable(displayEvent)) {
      return const SizedBox.shrink();
    }

    final profileAsync = ref.watch(profileProvider(displayEvent.pubkey));
    final reposterProfileAsync = isRepost
        ? ref.watch(profileProvider(widget.event.pubkey))
        : null;
    final reposterName =
        reposterProfileAsync?.valueOrNull?.displayNameOrName ??
        _truncatedNpub(widget.event.pubkey);

    // Use the batched engagement provider for counts
    final engagementAsync = ref.watch(engagementProvider(displayEvent.id));

    // Use the batched user-interactions provider to know if the user has
    // already liked or reposted — single query for all interaction types.
    final interactionsAsync = ref.watch(
      userInteractionsProvider([displayEvent.id]),
    );

    final followsAsync = ref.watch(followsProvider);
    final bookmarkedIdsAsync = ref.watch(bookmarkedIdsProvider);
    final zapReceiptsAsync = ref.watch(zapReceiptsProvider(displayEvent.id));
    final auth = ref.watch(authStateProvider);

    final profile = profileAsync.valueOrNull;
    final authorName =
        profile?.displayNameOrName ?? _truncatedNpub(displayEvent.pubkey);
    final authorPicture = profile?.picture;
    final timestamp = DateTime.fromMillisecondsSinceEpoch(
      displayEvent.createdAt * 1000,
    );
    final timeAgo = timeago.format(timestamp);

    // Counts from engagement provider
    final engagement = engagementAsync.valueOrNull ?? const EventEngagement();

    // Apply optimistic deltas
    final replyCount = engagement.replies;
    final reactionCount =
        engagement.reactions +
        (_optimisticLiked == true ? 1 : (_optimisticLiked == false ? -1 : 0));
    final repostCount =
        engagement.reposts +
        (_optimisticReposted == true
            ? 1
            : (_optimisticReposted == false ? -1 : 0));

    // Interaction states: optimistic takes priority, then relay state
    final interactions = interactionsAsync.valueOrNull;
    final isLiked =
        _optimisticLiked ?? (interactions?.likes[displayEvent.id] ?? false);
    final isReposted =
        _optimisticReposted ??
        (interactions?.reposts[displayEvent.id] ?? false);

    // Zap data
    final zapReceipts = zapReceiptsAsync.valueOrNull ?? [];
    final zapCount = zapReceipts.length;
    final zapSats = zapReceipts.fold<int>(
      0,
      (sum, r) => sum + _zapAmountSats(r),
    );

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
        onTap: widget.isThreadView
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
                        '$reposterName reposted',
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
                    onTap: () =>
                        context.push('/profile/${displayEvent.pubkey}'),
                    child: CircleAvatar(
                      radius: 22,
                      backgroundColor: colorScheme.primaryContainer,
                      backgroundImage:
                          authorPicture != null && authorPicture.isNotEmpty
                          ? CachedNetworkImageProvider(authorPicture)
                          : null,
                      child: authorPicture == null || authorPicture.isEmpty
                          ? Text(
                              authorName.isNotEmpty
                                  ? authorName[0].toUpperCase()
                                  : '?',
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
                            if (profile?.nip05 != null &&
                                profile!.nip05!.isNotEmpty) ...[
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
                    onTap: widget.isThreadView
                        ? null
                        : () => context.push('/thread', extra: displayEvent),
                  ),
                  _ActionButton(
                    icon: isReposted ? Icons.repeat : Icons.repeat_outlined,
                    count: repostCount,
                    color: isReposted ? Colors.green : colorScheme.secondary,
                    onTap: () =>
                        _handleRepost(context, ref, auth, displayEvent),
                  ),
                  _ActionButton(
                    icon: isLiked ? Icons.favorite : Icons.favorite_border,
                    count: reactionCount,
                    color: isLiked ? Colors.red : null,
                    onTap: () => _handleLike(context, ref, auth, displayEvent),
                  ),
                  _ActionButton(
                    icon: Icons.bolt,
                    count: zapCount,
                    label: zapSats > 0 ? '${_formatSats(zapSats)} sats' : null,
                    color: Colors.amber.shade700,
                    onTap: () => _handleZap(context, ref, auth, displayEvent),
                  ),
                  _ActionButton(
                    icon: isBookmarked ? Icons.bookmark : Icons.bookmark_border,
                    count: 0,
                    color: isBookmarked ? colorScheme.primary : null,
                    onTap: () => _handleBookmark(
                      context,
                      ref,
                      auth,
                      isBookmarked,
                      displayEvent,
                    ),
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

  void _handleRepost(
    BuildContext context,
    WidgetRef ref,
    AuthState auth,
    NostrEvent displayEvent,
  ) {
    if (!auth.isLoggedIn || auth.isReadOnly) {
      _showLoginPrompt(context);
      return;
    }

    final interactionsAsync = ref.read(
      userInteractionsProvider([displayEvent.id]),
    );
    final currentlyReposted =
        _optimisticReposted ??
        (interactionsAsync.valueOrNull?.reposts[displayEvent.id] ?? false);

    // Optimistic UI update; the actual publish/delete + provider refresh
    // is handled by the PostActions controller.
    setState(() => _optimisticReposted = !currentlyReposted);
    ref.read(postActionsProvider).toggleRepost(
          event: displayEvent,
          currentlyReposted: currentlyReposted,
        );
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(currentlyReposted ? 'Repost removed' : 'Reposted!'),
      ),
    );
  }

  void _handleLike(
    BuildContext context,
    WidgetRef ref,
    AuthState auth,
    NostrEvent displayEvent,
  ) {
    if (!auth.isLoggedIn || auth.isReadOnly) {
      _showLoginPrompt(context);
      return;
    }

    final interactionsAsync = ref.read(
      userInteractionsProvider([displayEvent.id]),
    );
    final currentlyLiked =
        _optimisticLiked ??
        (interactionsAsync.valueOrNull?.likes[displayEvent.id] ?? false);

    setState(() => _optimisticLiked = !currentlyLiked);
    ref.read(postActionsProvider).toggleLike(
          event: displayEvent,
          currentlyLiked: currentlyLiked,
        );
  }

  void _handleZap(
    BuildContext context,
    WidgetRef ref,
    AuthState auth,
    NostrEvent displayEvent,
  ) async {
    await showZapDialog(
      context: context,
      targetEvent: displayEvent,
      targetPubkey: displayEvent.pubkey,
    );
    // After the zap sheet closes, refresh zap receipts so the count updates
    ref.read(postActionsProvider).refreshZaps(displayEvent.id);
  }

  Future<void> _handleBookmark(
    BuildContext context,
    WidgetRef ref,
    AuthState auth,
    bool isBookmarked,
    NostrEvent displayEvent,
  ) async {
    if (!auth.isLoggedIn || auth.isReadOnly) {
      _showLoginPrompt(context);
      return;
    }
    try {
      await ref.read(postActionsProvider).toggleBookmark(
            event: displayEvent,
            isCurrentlyBookmarked: isBookmarked,
          );
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
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Failed to bookmark: $e')));
      }
    }
  }

  void _handleShare(
    BuildContext context,
    WidgetRef ref,
    NostrEvent displayEvent,
  ) {
    final nostr = ref.read(nostrServiceProvider);
    final note1 = nostr.authService.encodeNote(displayEvent.id);
    // sharePositionOrigin is required on iOS to anchor the share sheet
    final box = context.findRenderObject() as RenderBox?;
    final origin = box != null
        ? box.localToGlobal(Offset.zero) & box.size
        : const Rect.fromLTWH(0, 0, 100, 100);
    Share.share('nostr:$note1', sharePositionOrigin: origin);
  }

  void _showLoginPrompt(BuildContext context) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Log in to interact with posts')),
    );
  }

  String _formatSats(int n) {
    if (n >= 1000000) return '${(n / 1000000).toStringAsFixed(1)}M';
    if (n >= 1000) return '${(n / 1000).toStringAsFixed(1)}K';
    return '$n';
  }
}

// ─── Follow Button ─────────────────────────────────────────────────

class _FollowButton extends ConsumerWidget {
  final String pubkey;
  final bool isFollowing;

  const _FollowButton({required this.pubkey, required this.isFollowing});

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
  final String? label;
  final VoidCallback? onTap;
  final Color? color;

  const _ActionButton({
    required this.icon,
    required this.count,
    this.label,
    this.onTap,
    this.color,
  });

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final effectiveColor = color ?? colorScheme.onSurfaceVariant;

    return InkWell(
      onTap: onTap != null
          ? () {
              HapticFeedback.lightImpact();
              onTap!();
            }
          : null,
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
                label ?? _formatCount(count),
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

/// Whether an event should be rendered as a post card.
///
/// Returns false for events whose content is machine-readable JSON rather
/// than human-readable text. This catches:
/// - Kind 0 profile metadata wrapped in a generic repost (kind 16)
/// - Kind 3 contact lists wrapped in a generic repost
/// - Kind 10002 relay lists wrapped in a generic repost
/// - Any kind 1 whose content starts with `{` (JSON payload, not a note)
///
/// The web app handles this by only attempting `JSON.parse` when content
/// starts with `{` and validating the parsed object has `id` and `content`
/// string fields. We mirror that here.
bool _isDisplayable(NostrEvent event) {
  // Only these kinds should be rendered as a post card
  if (![1, 20, 21, 22, 30023].contains(event.kind)) return false;

  final trimmed = event.content.trim();
  if (trimmed.isEmpty) return true; // Empty note is fine (e.g. media-only)

  // If it starts with `{`, it's almost certainly JSON, not a note.
  // Some clients embed JSON in kind 1 for machine-readable data — those
  // aren't meant to be read as posts.
  if (trimmed.startsWith('{')) {
    // Exception: a tiny number of clients post JSON that IS the note content.
    // We try to parse it and check if it looks like a Nostr event.
    try {
      final parsed = jsonDecode(trimmed) as Map<String, dynamic>;
      // If it has an `id` and `content` field, it's an embedded event,
      // not a note. Don't display it.
      if (parsed.containsKey('id') && parsed.containsKey('content')) {
        return false;
      }
      // If it has a `name` or `about` field, it's profile metadata.
      if (parsed.containsKey('name') || parsed.containsKey('about')) {
        return false;
      }
      // If it has a `relays` field, it's a relay list.
      if (parsed.containsKey('relays')) {
        return false;
      }
      // Otherwise it might be a legitimate note that happens to start with `{`.
      // Let it through — the NoteContent renderer will handle it as text.
      return true;
    } catch (_) {
      // Not valid JSON — treat it as plain text. Some notes genuinely
      // start with `{` (e.g. "{gm}").
      return true;
    }
  }

  return true;
}

/// Extract zap amount in sats from a kind 9735 zap receipt.
///
/// Per NIP-57, the amount is NOT a top-level tag on the receipt. Two sources:
/// 1. The `description` tag contains a JSON-encoded kind 9734 zap request
///    with an `amount` tag in millisats.
/// 2. The `bolt11` tag encodes the amount in the invoice prefix.
int _zapAmountSats(NostrEvent receipt) {
  // Try the description tag first (zap request has the amount tag)
  final desc = receipt.getTag('description');
  if (desc != null) {
    try {
      final zapReq = jsonDecode(desc) as Map<String, dynamic>;
      final tags = (zapReq['tags'] as List?)?.cast<List<dynamic>>() ?? [];
      for (final tag in tags) {
        if (tag.isNotEmpty && tag[0] == 'amount' && tag.length > 1) {
          final msats = int.tryParse(tag[1].toString()) ?? 0;
          return msats ~/ 1000; // msats → sats
        }
      }
    } catch (_) {}
  }

  // Fallback: parse bolt11 prefix
  final bolt11 = receipt.getTag('bolt11');
  if (bolt11 != null) {
    final match = RegExp(
      r'^lnbc(\d+)([munp]?)',
      caseSensitive: false,
    ).firstMatch(bolt11);
    if (match != null) {
      final value = BigInt.parse(match.group(1)!);
      final mult = match.group(2) ?? '';
      const satsPerBtc = 100000000; // 10^8 sats per BTC
      BigInt sats;
      switch (mult.toLowerCase()) {
        case 'm':
          sats = value * BigInt.from(satsPerBtc) ~/ BigInt.from(1000);
          break;
        case 'u':
          sats = value * BigInt.from(satsPerBtc) ~/ BigInt.from(1000000);
          break;
        case 'n':
          sats = value * BigInt.from(satsPerBtc) ~/ BigInt.from(1000000000);
          break;
        case 'p':
          sats = value * BigInt.from(satsPerBtc) ~/ BigInt.from(1000000000000);
          break;
        default:
          sats = value * BigInt.from(satsPerBtc);
      }
      return sats.toInt();
    }
  }

  return 0;
}
