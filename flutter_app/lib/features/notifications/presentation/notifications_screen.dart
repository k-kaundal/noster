import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nostrfeed_mobile/core/db/event_store.dart';
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

/// Resolves the event a notification's engagement happened ON (the post that
/// was liked/reposted/zapped), store-first, then a bounded relay fetch. Used
/// by the tile preview (show the target's content, not the engagement's).
final _targetEventProvider =
    FutureProvider.family.autoDispose<NostrEvent?, String>((ref, id) async {
  final cached = await EventStore.instance.eventById(id);
  if (cached != null) return cached;
  try {
    final nostr = ref.read(nostrServiceProvider);
    final ev = await nostr.fetchEventById(id);
    if (ev != null) await EventStore.instance.ingest([ev]);
    return ev;
  } catch (_) {
    return null;
  }
});

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

  /// The content preview under the action line. For engagement events
  /// (like/repost/zap), the event's own content is EMPTY (a like carries
  /// nothing) or wrong (a repost embeds the original JSON) — so we show the
  /// TARGET post's content, resolved store-first. For content kinds
  /// (comment/mention/reply), the event IS the content.
  String? _previewFor(WidgetRef ref) {
    final isContentKind = event.kind == 1 || event.kind == 1111;
    if (isContentKind) {
      return event.content.isNotEmpty ? event.content : null;
    }
    final targetId = event.getTag('e') ?? event.getTag('a');
    if (targetId == null) return null;
    final target = ref.watch(_targetEventProvider(targetId)).valueOrNull;
    return target?.content.isNotEmpty == true ? target!.content : null;
  }

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
    final preview = _previewFor(ref);

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
                    if (preview != null) ...[
                      const SizedBox(height: AppSpacing.xxs),
                      Text(
                        preview,
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
    HapticFeedback.lightImpact();
    final type = _typeFor(event);
    switch (type) {
      case 'dm':
        _openDmThread(context, ref, event);
        return;
      case 'follow':
        // New follower → open THEIR profile.
        context.push('/profile/${event.pubkey}');
        return;
      default:
        _openTargetThread(context, ref, event);
        return;
    }
  }

  /// Reactions / reposts / zaps / comments / mentions / RSVPs: navigate to
  /// the POST the action happened on — NOT the engagement event itself.
  ///
  /// The bug this fixes: every one of these pushed `/thread` with the
  /// ENGAGEMENT event as the root, so the thread screen showed "Alice
  /// reposted your note" as the post (a like with empty content renders as
  /// an empty card — the "tap a like, see a broken thread" complaint). The
  /// thread must open on the TARGET (your note), resolved store-first, then
  /// a bounded relay fetch; only when the target can't be resolved do we
  /// fall back to the author's profile (better than a broken thread).
  Future<void> _openTargetThread(
    BuildContext context,
    WidgetRef ref,
    NostrEvent event,
  ) async {
    // Mentions/comments: the event IS content — its own thread is the answer
    // (its rootId chain resolves inside the thread screen). For those, and
    // for any engagement event, resolve the target first.
    final isContentKind = event.kind == 1 || event.kind == 1111;
    final targetId = event.getTag('e') ?? event.getTag('a');

    NostrEvent? target;
    if (!isContentKind && targetId != null) {
      target = await EventStore.instance.eventById(targetId);
      if (target == null) {
        try {
          final nostr = ref.read(nostrServiceProvider);
          target = await nostr.fetchEventById(targetId);
          if (target != null) {
            await EventStore.instance.ingest([target]);
          }
        } catch (_) {}
      }
    }

    if (!context.mounted) return;
    if (isContentKind) {
      context.push('/thread', extra: event);
    } else if (target != null) {
      context.push('/thread', extra: target);
    } else {
      // Target unresolvable (deleted/unreachable) — the author's profile is
      // a better answer than a broken thread.
      context.push('/profile/${event.pubkey}');
    }
  }

  void _openDmThread(BuildContext context, WidgetRef ref, NostrEvent event) {
    if (event.kind == 4) {
      // NIP-04: the peer is the event author.
      context.push('/chat/${event.pubkey}');
    } else if (event.kind == 1059) {
      // NIP-17: the sender is hidden behind an ephemeral wrapper — the chat
      // list resolves the conversation via DmStore.prime().
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
