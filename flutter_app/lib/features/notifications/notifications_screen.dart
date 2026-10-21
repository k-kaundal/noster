import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:timeago/timeago.dart' as timeago;

import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/widgets/safe_image.dart';
import 'package:nostrfeed_mobile/features/notifications/providers/notification_center.dart';
import 'package:nostrfeed_mobile/core/widgets/empty_state.dart';
import 'package:nostrfeed_mobile/core/widgets/error_view.dart';
import 'package:nostrfeed_mobile/core/widgets/skeleton.dart';

/// Notification filter selection.
final notificationFilterProvider = StateProvider<String>((ref) => 'all');

class NotificationsScreen extends ConsumerStatefulWidget {
  const NotificationsScreen({super.key});

  @override
  ConsumerState<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends ConsumerState<NotificationsScreen>
    with SingleTickerProviderStateMixin {
  static const _filters = [
    ('all', 'All', Icons.notifications_rounded),
    ('mention', 'Mentions', Icons.alternate_email_rounded),
    ('reaction', 'Reactions', Icons.favorite_rounded),
    ('repost', 'Reposts', Icons.repeat_rounded),
    ('zap', 'Zaps', Icons.bolt_rounded),
    ('follow', 'Following', Icons.person_add_alt_1_rounded),
  ];

  late AnimationController _animationController;
  late Animation<double> _fadeAnimation;

  @override
  void initState() {
    super.initState();
    _animationController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 600),
    );
    _fadeAnimation = CurvedAnimation(
      parent: _animationController,
      curve: Curves.easeIn,
    );
    _animationController.forward();
    // Opening the notifications screen marks all notifications as read
    // (clears the bell badge).
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        ref.read(notificationCenterProvider).markAllRead();
      }
    });
  }

  @override
  void dispose() {
    _animationController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final auth = ref.watch(authStateProvider);
    final notifications = ref.watch(notificationsProvider);
    final filter = ref.watch(notificationFilterProvider);

    return Scaffold(
      backgroundColor: colorScheme.surface,
      appBar: AppBar(
        title: const Text(
          'Notifications',
          style: TextStyle(
            fontWeight: FontWeight.w700,
            fontSize: 24,
            letterSpacing: -0.5,
          ),
        ),
        elevation: 0,
        scrolledUnderElevation: 2,
        backgroundColor: colorScheme.surface,
        surfaceTintColor: colorScheme.surfaceTint,
      ),
      body: FadeTransition(
        opacity: _fadeAnimation,
        child: Column(
          children: [
            // Modern filter chips
            Container(
              height: 64,
              decoration: BoxDecoration(
                color: colorScheme.surface,
                border: Border(
                  bottom: BorderSide(
                    color: colorScheme.outlineVariant.withValues(alpha: 0.2),
                    width: 1,
                  ),
                ),
              ),
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                itemCount: _filters.length,
                separatorBuilder: (_, _) => const SizedBox(width: 10),
                itemBuilder: (context, i) {
                  final (value, label, icon) = _filters[i];
                  final selected = filter == value;
                  return _ModernFilterChip(
                    label: label,
                    icon: icon,
                    selected: selected,
                    onSelected: () {
                      HapticFeedback.selectionClick();
                      ref.read(notificationFilterProvider.notifier).state = value;
                    },
                  );
                },
              ),
            ),
            Expanded(
              child: notifications.when(
                data: (events) {
                  if (!auth.isLoggedIn || events.isEmpty) {
                    return _buildEmpty(theme, auth.isLoggedIn);
                  }

                  final filtered = events.where((e) {
                    final type = _typeFor(e);
                    if (filter == 'all') return true;
                    return type == filter;
                  }).toList();

                  if (filtered.isEmpty) {
                    return _buildEmpty(theme, true);
                  }

                  return RefreshIndicator(
                    onRefresh: () async {
                      HapticFeedback.mediumImpact();
                      ref.invalidate(notificationsProvider);
                      await ref.read(notificationsProvider.future);
                    },
                    color: colorScheme.primary,
                    child: ListView.separated(
                      physics: const AlwaysScrollableScrollPhysics(),
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      itemCount: filtered.length,
                      separatorBuilder: (_, _) => Divider(
                        height: 1,
                        indent: 80,
                        color: colorScheme.outlineVariant.withValues(alpha: 0.3),
                      ),
                      itemBuilder: (context, i) => TweenAnimationBuilder<double>(
                        duration: Duration(milliseconds: 300 + (i * 50).clamp(0, 500)),
                        tween: Tween(begin: 0.0, end: 1.0),
                        curve: Curves.easeOutCubic,
                        builder: (context, value, child) {
                          return Transform.translate(
                            offset: Offset(0, 20 * (1 - value)),
                            child: Opacity(
                              opacity: value,
                              child: child,
                            ),
                          );
                        },
                        child: _NotificationTile(event: filtered[i]),
                      ),
                    ),
                  );
                },
                loading: () => const SkeletonList(itemCount: 5),
                error: (e, _) => ErrorView(
                  message: 'Failed to load notifications',
                  onRetry: () {
                    ref.invalidate(notificationsProvider);
                  },
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildEmpty(ThemeData theme, bool loggedIn) {
    return EmptyState(
      icon: Icons.notifications_none_rounded,
      title: loggedIn ? 'No notifications yet' : 'Log in to see notifications',
      subtitle: loggedIn
          ? 'When someone interacts with you,\nyou\'ll see it here'
          : 'Connect your account to get started',
    );
  }
}

// ─── Modern Filter Chip ─────────────────────────────────────────────

class _ModernFilterChip extends StatelessWidget {
  final String label;
  final IconData icon;
  final bool selected;
  final VoidCallback onSelected;

  const _ModernFilterChip({
    required this.label,
    required this.icon,
    required this.selected,
    required this.onSelected,
  });

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;

    return AnimatedContainer(
      duration: const Duration(milliseconds: 200),
      curve: Curves.easeOutCubic,
      decoration: BoxDecoration(
        color: selected
            ? colorScheme.primaryContainer
            : colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: selected
              ? colorScheme.primary
              : colorScheme.outline.withValues(alpha: 0.2),
          width: selected ? 1.5 : 1,
        ),
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onSelected,
          borderRadius: BorderRadius.circular(20),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  icon,
                  size: 18,
                  color: selected
                      ? colorScheme.onPrimaryContainer
                      : colorScheme.onSurfaceVariant,
                ),
                const SizedBox(width: 6),
                Text(
                  label,
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
                    color: selected
                        ? colorScheme.onPrimaryContainer
                        : colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

String _typeFor(NostrEvent e) {
  switch (e.kind) {
    case 7:
      return 'reaction';
    case 6:
    case 16:
      return 'repost';
    case 9735:
      return 'zap';
    case 1111:
      return 'comment';
    case 1059:
      return 'dm';
    case 3:
      return 'follow';
    case 30023:
      return 'article_mention';
    case 31925:
      return 'rsvp';
    case 1:
    default:
      return 'mention';
  }
}

class _NotificationTile extends ConsumerWidget {
  final NostrEvent event;
  const _NotificationTile({required this.event});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final type = _typeFor(event);
    final profile = ref.watch(profileProvider(event.pubkey)).value;
    final name = profile?.displayNameOrName ??
        '${event.pubkey.substring(0, 8)}…';
    final time = DateTime.fromMillisecondsSinceEpoch(event.createdAt * 1000);

    final (icon, color, action) = switch (type) {
      'reaction' => (
          Icons.favorite_rounded,
          Colors.red.shade400,
          'liked your note',
        ),
      'repost' => (
          Icons.repeat_rounded,
          Colors.green.shade400,
          'reposted your note',
        ),
      'zap' => (
          Icons.bolt_rounded,
          Colors.amber.shade700,
          'zapped you',
        ),
      'comment' => (
          Icons.comment_rounded,
          colorScheme.secondary,
          'commented on your note',
        ),
      'dm' => (
          Icons.mail_rounded,
          colorScheme.primary,
          'sent you a message',
        ),
      'follow' => (
          Icons.person_add_alt_1_rounded,
          colorScheme.primary,
          'started following you',
        ),
      'article_mention' => (
          Icons.article_rounded,
          colorScheme.tertiary,
          'mentioned you in an article',
        ),
      'rsvp' => (
          Icons.event_available_rounded,
          colorScheme.primary,
          'RSVP\'d to your event',
        ),
      _ => (
          Icons.alternate_email_rounded,
          colorScheme.primary,
          'mentioned you',
        ),
    };

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: () {
          HapticFeedback.lightImpact();
          _open(context, ref, event);
        },
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Icon indicator
              Container(
                width: 32,
                height: 32,
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.15),
                  shape: BoxShape.circle,
                ),
                child: Icon(icon, color: color, size: 18),
              ),
              const SizedBox(width: 12),
              // Avatar
              _Avatar(imageUrl: profile?.picture, name: name),
              const SizedBox(width: 12),
              // Content
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    RichText(
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      text: TextSpan(
                        style: theme.textTheme.bodyMedium?.copyWith(
                          height: 1.4,
                        ),
                        children: [
                          TextSpan(
                            text: name,
                            style: const TextStyle(
                              fontWeight: FontWeight.w700,
                              letterSpacing: -0.2,
                            ),
                          ),
                          TextSpan(
                            text: ' $action',
                            style: TextStyle(
                              color: colorScheme.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ),
                    ),
                    if (event.content.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Text(
                        event.content,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: colorScheme.onSurfaceVariant,
                          height: 1.3,
                        ),
                      ),
                    ],
                    const SizedBox(height: 6),
                    Text(
                      timeago.format(time),
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: colorScheme.onSurfaceVariant.withValues(alpha: 0.7),
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _open(BuildContext context, WidgetRef ref, NostrEvent event) {
    final type = _typeFor(event);
    switch (type) {
      case 'dm':
        // DM notification: the sender is the event author (for kind 4) or the
        // ephemeral wrapper (for kind 1059). Navigate to the chat thread with
        // the sender — for 1059 we need to decrypt to get the real sender.
        // The peer is always the event author for incoming DMs.
        _openDmThread(context, ref, event);
      case 'mention':
      case 'comment':
      case 'article_mention':
        // Navigate to the thread/post where the mention happened.
        final rootId = event.getTag('e') ?? event.getTag('a');
        if (rootId != null) {
          context.push('/thread', extra: event);
        } else {
          context.push('/profile/${event.pubkey}');
        }
      case 'reaction':
      case 'repost':
      case 'zap':
        // Navigate to the post that was liked/reposted/zapped.
        final targetId = event.getTag('e') ?? event.getTag('a');
        if (targetId != null) {
          context.push('/thread', extra: event);
        } else {
          context.push('/profile/${event.pubkey}');
        }
      case 'follow':
        // New follower → open THEIR profile.
        context.push('/profile/${event.pubkey}');
      case 'rsvp':
        // Navigate to the calendar event.
        final eventId = event.getTag('e') ?? event.getTag('a');
        if (eventId != null) {
          context.push('/thread', extra: event);
        } else {
          context.push('/profile/${event.pubkey}');
        }
      default:
        // Fallback: go to the author's profile, not our own.
        context.push('/profile/${event.pubkey}');
    }
  }

  void _openDmThread(BuildContext context, WidgetRef ref, NostrEvent event) {
    if (event.kind == 4) {
      // NIP-04: the peer is the event author.
      context.push('/chat/${event.pubkey}');
    } else if (event.kind == 1059) {
      // NIP-17: we need to decrypt to find the real sender. The chat screen
      // will handle decryption via DmStore.prime().
      // For now, navigate to the chat list — the conversation should appear
      // there once decrypted. In the future we could decrypt here and push
      // directly to the thread.
      context.go('/chat');
    } else {
      context.go('/chat');
    }
  }
}

class _Avatar extends StatelessWidget {
  final String? imageUrl;
  final String name;
  const _Avatar({this.imageUrl, required this.name});

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final initial = name.isNotEmpty ? name[0].toUpperCase() : '?';

    return SafeAvatar(
      imageUrl: imageUrl,
      radius: 24,
      backgroundColor: colorScheme.primaryContainer,
      fallback: Text(
        initial,
        style: TextStyle(
          color: colorScheme.onPrimaryContainer,
          fontWeight: FontWeight.w600,
          fontSize: 18,
        ),
      ),
    );
  }
}
