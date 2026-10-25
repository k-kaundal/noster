import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/nostr/kinds.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/theme/app_motion.dart';
import 'package:nostrfeed_mobile/core/theme/app_shapes.dart';
import 'package:nostrfeed_mobile/core/theme/app_spacing.dart';
import 'package:nostrfeed_mobile/core/theme/app_theme.dart';
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';
import 'package:nostrfeed_mobile/core/widgets/empty_state.dart';
import 'package:nostrfeed_mobile/core/widgets/error_view.dart';
import 'package:nostrfeed_mobile/core/widgets/safe_image.dart';
import 'package:nostrfeed_mobile/core/widgets/skeleton.dart';
import 'package:nostrfeed_mobile/features/notifications/application/notification_center.dart';
import 'package:timeago/timeago.dart' as timeago;

/// Notification filter selection.
final notificationFilterProvider = StateProvider.autoDispose<String>((ref) => 'all');

class NotificationsScreen extends ConsumerStatefulWidget {
  const NotificationsScreen({super.key});

  @override
  ConsumerState<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends ConsumerState<NotificationsScreen>
    with SingleTickerProviderStateMixin {
  static const _filters = [
    ('all', 'All', 'bell'),
    ('mention', 'Mentions', 'at'),
    ('reaction', 'Reactions', 'heart'),
    ('repost', 'Reposts', 'repost'),
    ('zap', 'Zaps', 'zap'),
    ('follow', 'Following', 'users'),
  ];

  late AnimationController _animationController;
  late Animation<double> _fadeAnimation;

  @override
  void initState() {
    super.initState();
    _animationController = AnimationController(
      vsync: this,
      duration: AppMotion.slow,
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
        ref.read(notificationCenterProvider.notifier).markAllRead();
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
        title: Text(
          'Notifications',
          style: theme.textTheme.headlineSmall?.copyWith(
            fontWeight: FontWeight.w700,
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
            // Filter chips row
            Container(
              height: 56,
              decoration: BoxDecoration(
                color: colorScheme.surface,
                border: Border(
                  bottom: BorderSide(
                    color: colorScheme.outlineVariant,
                    width: 1,
                  ),
                ),
              ),
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(
                  horizontal: AppSpacing.md,
                  vertical: AppSpacing.sm,
                ),
                itemCount: _filters.length,
                separatorBuilder: (_, _) => const SizedBox(width: AppSpacing.sm),
                itemBuilder: (context, i) {
                  final (value, label, iconName) = _filters[i];
                  final selected = filter == value;
                  return _FilterChip(
                    label: label,
                    iconName: iconName,
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
                      padding: const EdgeInsets.symmetric(
                        vertical: AppSpacing.xs,
                      ),
                      itemCount: filtered.length,
                      separatorBuilder: (_, _) => Divider(
                        height: 1,
                        indent: 68,
                        color: colorScheme.outlineVariant,
                      ),
                      itemBuilder: (context, i) => TweenAnimationBuilder<double>(
                        duration: AppMotion.normal +
                            AppMotion.stagger * i.clamp(0, 16),
                        tween: Tween(begin: 0.0, end: 1.0),
                        curve: AppMotion.curve,
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

// ─── Filter chip (Refined: hairline, quiet) ─────────────────────────

class _FilterChip extends StatelessWidget {
  final String label;
  final String iconName;
  final bool selected;
  final VoidCallback onSelected;

  const _FilterChip({
    required this.label,
    required this.iconName,
    required this.selected,
    required this.onSelected,
  });

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;

    return AnimatedContainer(
      duration: AppMotion.fast,
      curve: AppMotion.curve,
      decoration: BoxDecoration(
        color: selected
            ? colorScheme.primaryContainer
            : colorScheme.surfaceContainerLowest,
        borderRadius: AppShapes.radiusXl,
        border: Border.all(
          color: selected
              ? colorScheme.primary
              : colorScheme.outlineVariant,
          width: 1,
        ),
      ),
      child: Material(
        color: Colors.transparent, // token-guard: allow — ink surface
        child: InkWell(
          onTap: onSelected,
          borderRadius: AppShapes.radiusXl,
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.md,
              vertical: AppSpacing.xs,
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                AppIcon(
                  iconName,
                  size: AppIconSize.sm,
                  color: selected
                      ? colorScheme.onPrimaryContainer
                      : colorScheme.onSurfaceVariant,
                ),
                const SizedBox(width: AppSpacing.xxs),
                Text(
                  label,
                  style: Theme.of(context).textTheme.labelLarge?.copyWith(
                        fontWeight:
                            selected ? FontWeight.w600 : FontWeight.w500,
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
    case NostrKinds.reaction:
      return 'reaction';
    case NostrKinds.repost:
    case NostrKinds.genericRepost:
      return 'repost';
    case NostrKinds.zapReceipt:
      return 'zap';
    case NostrKinds.comment:
      return 'comment';
    case NostrKinds.giftWrap:
      return 'dm';
    case NostrKinds.contacts:
      return 'follow';
    case NostrKinds.longForm:
      return 'article_mention';
    case NostrKinds.calendarRsvp:
      return 'rsvp';
    case NostrKinds.textNote:
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
    final lastRead = ref.watch(
      notificationCenterProvider.select((s) => s.lastRead),
    );
    final isUnread = event.createdAt >= lastRead;

    final (iconName, color, action) = switch (type) {
      'reaction' => (
          'heart_filled',
          AppActionColors.like(colorScheme.brightness),
          'liked your note',
        ),
      'repost' => (
          'repost',
          AppActionColors.repost(colorScheme.brightness),
          'reposted your note',
        ),
      'zap' => (
          'zap_filled',
          AppActionColors.zap,
          'zapped you',
        ),
      'comment' => (
          'comment',
          colorScheme.primary,
          'commented on your note',
        ),
      'dm' => (
          'chat',
          colorScheme.primary,
          'sent you a message',
        ),
      'follow' => (
          'users',
          colorScheme.onSurfaceVariant,
          'started following you',
        ),
      'article_mention' => (
          'article',
          colorScheme.primary,
          'mentioned you in an article',
        ),
      'rsvp' => (
          'calendar',
          colorScheme.primary,
          'RSVP\'d to your event',
        ),
      _ => (
          'at',
          colorScheme.primary,
          'mentioned you',
        ),
    };

    return Material(
      color: isUnread
          ? colorScheme.primaryContainer.withValues(alpha: 0.12)
          : Colors.transparent, // token-guard: allow — ink surface
      child: InkWell(
        onTap: () {
          HapticFeedback.lightImpact();
          _open(context, ref, event);
        },
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.md,
            vertical: AppSpacing.sm,
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Type icon in a soft-tinted circle
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.12),
                  shape: BoxShape.circle,
                ),
                child: Center(
                  child: AppIcon(
                    iconName,
                    size: AppIconSize.md,
                    color: color,
                  ),
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              // Avatar
              _Avatar(imageUrl: profile?.picture, name: name),
              const SizedBox(width: AppSpacing.sm),
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
                            style: theme.textTheme.bodyMedium?.copyWith(
                              fontWeight: FontWeight.w700,
                              letterSpacing: -0.2,
                            ),
                          ),
                          TextSpan(
                            text: ' $action',
                            style: theme.textTheme.bodyMedium?.copyWith(
                              color: colorScheme.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ),
                    ),
                    if (event.content.isNotEmpty) ...[
                      const SizedBox(height: AppSpacing.xxs),
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
                    const SizedBox(height: AppSpacing.xxs),
                    Text(
                      timeago.format(time),
                      style: theme.textTheme.labelSmall?.copyWith(
                        color:
                            colorScheme.onSurfaceVariant.withValues(alpha: 0.7),
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
    final initial = firstGrapheme(name);

    return SafeAvatar(
      imageUrl: imageUrl,
      radius: 20,
      backgroundColor: colorScheme.primaryContainer,
      fallback: Text(
        initial,
        style: Theme.of(context).textTheme.titleSmall?.copyWith(
              color: colorScheme.onPrimaryContainer,
              fontWeight: FontWeight.w600,
            ),
      ),
    );
  }
}
