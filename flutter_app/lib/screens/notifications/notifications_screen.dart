import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:timeago/timeago.dart' as timeago;

import '../../models/nostr_models.dart';
import '../../providers/app_providers.dart';

/// Notification filter selection.
final notificationFilterProvider = StateProvider<String>((ref) => 'all');

class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});

  static const _filters = [
    ('all', 'All'),
    ('mention', 'Mentions'),
    ('reaction', 'Reactions'),
    ('repost', 'Reposts'),
    ('zap', 'Zaps'),
  ];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final auth = ref.watch(authStateProvider);
    final notifications = ref.watch(notificationsProvider);
    final filter = ref.watch(notificationFilterProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Notifications')),
      body: Column(
        children: [
          // Filter chips
          SizedBox(
            height: 56,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              itemCount: _filters.length,
              separatorBuilder: (_, _) => const SizedBox(width: 8),
              itemBuilder: (context, i) {
                final (value, label) = _filters[i];
                final selected = filter == value;
                return FilterChip(
                  label: Text(label),
                  selected: selected,
                  onSelected: (_) =>
                      ref.read(notificationFilterProvider.notifier).state = value,
                );
              },
            ),
          ),
          const Divider(height: 1),
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
                  onRefresh: () => ref.refresh(notificationsProvider.future),
                  child: ListView.separated(
                    physics: const AlwaysScrollableScrollPhysics(),
                    itemCount: filtered.length,
                    separatorBuilder: (_, _) => const Divider(height: 1),
                    itemBuilder: (context, i) =>
                        _NotificationTile(event: filtered[i]),
                  ),
                );
              },
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (e, _) => Center(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Text('Failed to load notifications: $e'),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildEmpty(ThemeData theme, bool loggedIn) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.notifications_none,
            size: 64,
            color: theme.colorScheme.onSurface.withValues(alpha: 0.3),
          ),
          const SizedBox(height: 16),
          Text(
            loggedIn ? 'No notifications yet' : 'Log in to see notifications',
            style: theme.textTheme.bodyLarge?.copyWith(
              color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
            ),
          ),
        ],
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
    final type = _typeFor(event);
    final profile = ref.watch(profileProvider(event.pubkey)).value;
    final name = profile?.displayNameOrName ??
        '${event.pubkey.substring(0, 8)}…';
    final time = DateTime.fromMillisecondsSinceEpoch(event.createdAt * 1000);

    final (icon, color, action) = switch (type) {
      'reaction' => (
          Icons.favorite,
          Colors.red,
          'liked your note',
        ),
      'repost' => (
          Icons.repeat,
          Colors.green,
          'reposted your note',
        ),
      'zap' => (
          Icons.bolt,
          Colors.amber.shade700,
          'zapped you',
        ),
      _ => (
          Icons.alternate_email,
          theme.colorScheme.primary,
          'mentioned you',
        ),
    };

    return ListTile(
      leading: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(
            width: 28,
            child: Icon(icon, color: color, size: 22),
          ),
          _Avatar(imageUrl: profile?.picture, name: name),
        ],
      ),
      title: RichText(
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
        text: TextSpan(
          style: theme.textTheme.bodyMedium,
          children: [
            TextSpan(
              text: name,
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
            TextSpan(text: ' $action'),
          ],
        ),
      ),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (event.content.isNotEmpty)
            Text(
              event.content,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
              ),
            ),
          Text(
            timeago.format(time),
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
            ),
          ),
        ],
      ),
      onTap: () => _open(context, ref, event),
    );
  }

  void _open(BuildContext context, WidgetRef ref, NostrEvent event) {
    // Navigate to the referenced event's author profile, or the actor's profile
    final target = event.getTag('p') ?? event.pubkey;
    context.push('/profile/$target');
  }
}

class _Avatar extends StatelessWidget {
  final String? imageUrl;
  final String name;
  const _Avatar({this.imageUrl, required this.name});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final initial = name.isNotEmpty ? name[0].toUpperCase() : '?';
    final url = imageUrl;
    if (url != null && url.isNotEmpty) {
      return CircleAvatar(
        backgroundImage: CachedNetworkImageProvider(url),
        onBackgroundImageError: (_, _) {},
      );
    }
    return CircleAvatar(
      backgroundColor: theme.colorScheme.primaryContainer,
      child: Text(
        initial,
        style: TextStyle(color: theme.colorScheme.onPrimaryContainer),
      ),
    );
  }
}
