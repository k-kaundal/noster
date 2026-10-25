import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/theme/app_shapes.dart';
import 'package:nostrfeed_mobile/core/widgets/app_badge.dart';
import 'package:nostrfeed_mobile/core/widgets/detail_scaffold.dart';
import 'package:nostrfeed_mobile/core/widgets/empty_state.dart';
import 'package:nostrfeed_mobile/core/widgets/safe_image.dart';
import 'package:nostrfeed_mobile/core/widgets/smart_network_image.dart';
import 'package:nostrfeed_mobile/features/live/application/live_providers.dart';
import 'package:nostrfeed_mobile/features/live/domain/live_event.dart';
import 'package:nostrfeed_mobile/features/live/go_live_sheet.dart';
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';

/// Live home: currently-live + upcoming NIP-53 activities.
class LiveScreen extends ConsumerWidget {
  const LiveScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final eventsAsync = ref.watch(liveEventsProvider);
    final auth = ref.watch(authStateProvider);

    return DetailScaffold(
      title: 'Live',
      body: eventsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text('Failed to load live streams'),
              TextButton(
                onPressed: () => ref.invalidate(liveEventsProvider),
                child: const Text('Retry'),
              ),
            ],
          ),
        ),
        data: (events) {
          final live = events.where((e) => e.isLive).toList();
          final planned = events.where((e) => e.isPlanned).toList();
          final ended = events.where((e) => e.isEnded).toList();

          if (events.isEmpty) {
            return const EmptyState(
              icon: Icons.live_tv_outlined,
              title: 'No live streams right now',
              subtitle: 'When someone goes live on Nostr, they\'ll appear here.',
            );
          }

          return RefreshIndicator(
            onRefresh: () async => ref.invalidate(liveEventsProvider),
            child: ListView(
              padding: const EdgeInsets.all(12),
              children: [
                if (live.isNotEmpty) ...[
                  _SectionHeader(title: 'Live Now (${live.length})'),
                  for (final e in live) _LiveCard(event: e),
                  const SizedBox(height: 16),
                ],
                if (planned.isNotEmpty) ...[
                  _SectionHeader(title: 'Upcoming (${planned.length})'),
                  for (final e in planned) _LiveCard(event: e),
                  const SizedBox(height: 16),
                ],
                if (ended.isNotEmpty) ...[
                  const _SectionHeader(title: 'Recent'),
                  for (final e in ended.take(10)) _LiveCard(event: e),
                ],
              ],
            ),
          );
        },
      ),
      floatingActionButton: auth.isLoggedIn
          ? FloatingActionButton.extended(
              onPressed: () => showModalBottomSheet(
                context: context,
                isScrollControlled: true,
                showDragHandle: true,
                builder: (_) => const GoLiveSheet(),
              ),
              icon: const AppIcon('live'),
              label: const Text('Go Live'),
            )
          : null,
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final String title;
  const _SectionHeader({required this.title});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 0, 4, 10),
      child: Text(
        title.toUpperCase(),
        style: Theme.of(context).textTheme.labelSmall?.copyWith(
              fontWeight: FontWeight.w700,
              letterSpacing: 1.2,
              color: Theme.of(context).colorScheme.primary,
            ),
      ),
    );
  }
}

class _LiveCard extends ConsumerWidget {
  final LiveEvent event;
  const _LiveCard({required this.event});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final hostAsync = ref.watch(profileProvider(event.hostPubkey));
    final host = hostAsync.valueOrNull;

    final card = Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLowest,
        borderRadius: AppShapes.radiusLg,
        border: Border.all(color: scheme.outlineVariant),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => context.push('/live/room', extra: event),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Thumbnail + status badge
            Stack(
              children: [
                SizedBox(
                  height: 150,
                  width: double.infinity,
                  child: event.image != null
                      ? CachedNetworkImage(
                          httpHeaders: kImageHttpHeaders,
                          imageUrl: event.image!,
                          fit: BoxFit.cover,
                          errorWidget: (_, _, _) =>
                              _ThumbFallback(scheme: scheme),
                        )
                      : _ThumbFallback(scheme: scheme),
                ),
                Positioned(
                  top: 10,
                  left: 10,
                  child: _StatusBadge(status: event.status),
                ),
                if (event.isLive && event.currentParticipants != null)
                  Positioned(
                    top: 10,
                    right: 10,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                        color: Colors.black54, // token-guard: allow — scrim over cover media
                        borderRadius: AppShapes.radiusSm,
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const AppIcon('eye',
                              color: Colors.white, // token-guard: allow — on dark scrim
                              size: AppIconSize.xs),
                          const SizedBox(width: 4),
                          Text(
                            '${event.currentParticipants}',
                            style: Theme.of(context)
                                .textTheme
                                .labelSmall
                                ?.copyWith(color: Colors.white), // token-guard: allow — on dark scrim
                          ),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
            Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                children: [
                  SafeAvatar(
                    imageUrl: host?.picture,
                    radius: 18,
                    fallback: const AppIcon('users', size: AppIconSize.md),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          event.title,
                          style: Theme.of(context)
                              .textTheme
                              .titleSmall
                              ?.copyWith(fontWeight: FontWeight.bold),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 2),
                        Text(
                          [
                            host?.displayNameOrName ??
                                '${event.hostPubkey.substring(0, 8)}…',
                            if (event.isPlanned && event.starts != null)
                              DateFormat('MMM d, h:mm a').format(
                                DateTime.fromMillisecondsSinceEpoch(
                                    event.starts! * 1000),
                              ),
                          ].join(' · '),
                          style: Theme.of(context)
                              .textTheme
                              .bodySmall
                              ?.copyWith(color: scheme.onSurfaceVariant),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),
                  if (event.isLive)
                    AppIcon('play',
                        color: scheme.primary, size: AppIconSize.xl),
                ],
              ),
            ),
          ],
        ),
      ),
    );

    // Ended streams read as dimmed/archived (status-first hierarchy).
    if (event.isEnded) {
      return Opacity(opacity: 0.55, child: card);
    }
    return card;
  }
}

class _StatusBadge extends StatelessWidget {
  final LiveStatus status;
  const _StatusBadge({required this.status});

  @override
  Widget build(BuildContext context) {
    return switch (status) {
      LiveStatus.live => const StatusBadge.error('LIVE'),
      LiveStatus.planned => const StatusBadge.info('UPCOMING'),
      LiveStatus.ended => const StatusBadge.info('ENDED'),
    };
  }
}

class _ThumbFallback extends StatelessWidget {
  final ColorScheme scheme;
  const _ThumbFallback({required this.scheme});

  @override
  Widget build(BuildContext context) {
    return Container(
      color: scheme.surfaceContainerHigh,
      child: Center(
        child: AppIcon('live', color: scheme.onSurfaceVariant,
          size: AppIconSize.xl,
        ),
      ),
    );
  }
}
