import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/moderation/content_filter.dart';
import 'package:nostrfeed_mobile/core/moderation/moderation_providers.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/theme/app_shapes.dart';
import 'package:nostrfeed_mobile/core/theme/app_spacing.dart';
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';
import 'package:nostrfeed_mobile/core/widgets/empty_state.dart';
import 'package:nostrfeed_mobile/core/widgets/error_view.dart';
import 'package:nostrfeed_mobile/core/widgets/safe_image.dart';
import 'package:nostrfeed_mobile/core/widgets/skeleton.dart';
import 'package:nostrfeed_mobile/features/ai/application/ai_providers.dart';
import 'package:nostrfeed_mobile/features/feed/presentation/widgets/post_card.dart';

class ExploreScreen extends ConsumerWidget {
  const ExploreScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final hashtagsAsync = ref.watch(trendingHashtagsProvider);
    // Default to 24h for explore page trending posts
    final trending = ref.watch(trendingProvider(24));

    // Explore is a TAB inside the shell (Refined v2.1) — the shell owns the
    // AppBar (title "Explore" + search/bell/overflow), so this screen renders
    // NO internal AppBar (that would double the bar).
    return Scaffold(
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(trendingHashtagsProvider);
          ref.invalidate(trendingProvider(24));
        },
        child: CustomScrollView(
          slivers: [
            // Ask NostrFeed AI — discovery intent lives here, so the AI
            // entry does too. Hidden when no provider key is configured.
            if (ref.watch(aiAvailableProvider))
              const SliverToBoxAdapter(child: _AskAiCard()),

            // Browse — the discovery & community features that used to live
            // in the drawer (killed). One chip row, no second home.
            const SliverToBoxAdapter(
              child: _SectionHeader('Browse'),
            ),
            SliverToBoxAdapter(
              child: SizedBox(
                height: 44,
                child: ListView(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  children: const [
                    _BrowseChip(icon: 'trending', label: 'Trending', route: '/trending'),
                    _BrowseChip(icon: 'video', label: 'Reels', route: '/reels'),
                    _BrowseChip(icon: 'article', label: 'Articles', route: '/articles'),
                    _BrowseChip(icon: 'calendar', label: 'Calendar', route: '/calendar'),
                    _BrowseChip(icon: 'group', label: 'Communities', route: '/communities'),
                    _BrowseChip(icon: 'group', label: 'Groups', route: '/groups'),
                    _BrowseChip(icon: 'live', label: 'Live', route: '/live'),
                    _BrowseChip(icon: 'shopping', label: 'Market', route: '/market'),
                    _BrowseChip(icon: 'users', label: 'Lists', route: '/lists'),
                  ],
                ),
              ),
            ),

            // Trending hashtags — NSFW tags filtered out before display.
            const SliverToBoxAdapter(
              child: _SectionHeader('Trending Hashtags'),
            ),
            SliverToBoxAdapter(
              child: hashtagsAsync.when(
                loading: () => const SizedBox(
                  height: 44,
                  child: Center(child: CircularProgressIndicator()),
                ),
                error: (_, _) => const SizedBox.shrink(),
                data: (stats) {
                  final filtered = _visibleHashtags(ref, stats);
                  if (filtered.isEmpty) {
                    return Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      child: Text(
                        'No trending hashtags right now',
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                              color: Theme.of(context)
                                  .colorScheme
                                  .onSurfaceVariant,
                            ),
                      ),
                    );
                  }
                  return SizedBox(
                    height: 44,
                    child: ListView.separated(
                      scrollDirection: Axis.horizontal,
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      itemCount: filtered.length,
                      separatorBuilder: (_, _) => const SizedBox(width: 8),
                      itemBuilder: (context, i) {
                        final stat = filtered[i];
                        return ActionChip(
                          avatar: const AppIcon('hash', size: 16),
                          label: Text('${stat.tag} (${stat.count})'),
                          onPressed: () => context.push(
                              '/hashtag/${Uri.encodeComponent(stat.tag)}'),
                        );
                      },
                    ),
                  );
                },
              ),
            ),

            // People to follow — trending authors, profiles checked.
            const SliverToBoxAdapter(
              child: _SectionHeader('People to follow', top: 20),
            ),
            const SliverToBoxAdapter(child: _PeopleToFollow()),

            // Trending posts
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Row(
                  children: [
                    const Expanded(
                      child: _SectionHeader('Trending Posts', top: 20),
                    ),
                    TextButton(
                      onPressed: () => context.push('/trending'),
                      child: const Text('See all'),
                    ),
                  ],
                ),
              ),
            ),
            trending.when(
              loading: () => const SliverToBoxAdapter(
                child: SizedBox(height: 300, child: SkeletonList(itemCount: 3)),
              ),
              error: (err, _) => SliverToBoxAdapter(
                child: ErrorView(
                  message: 'Failed to load trending posts',
                  onRetry: () => ref.invalidate(trendingProvider(24)),
                ),
              ),
              data: (events) {
                if (events.isEmpty) {
                  return const SliverToBoxAdapter(
                    child: EmptyState(
                      icon: Icons.explore_outlined,
                      title: 'Nothing trending yet',
                      subtitle: 'Check back soon for trending content.',
                    ),
                  );
                }
                return SliverList.builder(
                  itemCount: events.length > 10 ? 10 : events.length,
                  itemBuilder: (context, i) => PostCard(event: events[i]),
                );
              },
            ),
            const SliverToBoxAdapter(child: SizedBox(height: 24)),
          ],
        ),
      ),
    );
  }

  /// Trending hashtags with NSFW ones removed — an explicit tag is not a
  /// discovery surface, however many bots posted it this hour.
  static List<HashtagStat> _visibleHashtags(
      WidgetRef ref, List<HashtagStat> stats) {
    final nsfwOn = ref.watch(nsfwFilterProvider);
    if (!nsfwOn) return stats;
    final filter = ref.watch(contentFilterProvider);
    if (!filter.nsfwTermsEnabled) return stats;
    // Reuse the event-side term matching by judging a fake one-liner — the
    // hashtag is content-shaped ("#porn" vs "porn" match identically).
    return stats.where((s) {
      final fake = _tagAsEvent(s.tag);
      return filter.verdictForEvent(fake).action == FilterAction.show;
    }).toList();
  }
}

/// Build a minimal kind-1-shaped object for the filter to judge a hashtag.
/// The filter only ever reads `.content`, `.hashtags` and `.getTag` from it.
NostrEvent _tagAsEvent(String tag) => NostrEvent(
      id: '',
      pubkey: '',
      createdAt: 0,
      kind: 1,
      tags: const [],
      content: '#$tag',
      sig: '',
    );

/// The AI discovery card on top of Explore: search-shaped (users arrive
/// with intent), opens the AI chat. Shows the remaining free-trial count
/// as an honest hook — no fake scarcity.
class _AskAiCard extends ConsumerWidget {
  const _AskAiCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final trialLeft = ref.watch(aiTrialRemainingProvider);

    final textTheme = Theme.of(context).textTheme;

    // Refined: a quiet hairline card (no gradient) — the accent icon tile is
    // the only color. Discovery intent, not an ad.
    return Padding(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.md, AppSpacing.sm, AppSpacing.md, 0),
      child: InkWell(
        borderRadius: AppShapes.radiusMd,
        onTap: () => context.push('/ai'),
        child: Container(
          padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.sm + 2, vertical: AppSpacing.sm + 1),
          decoration: BoxDecoration(
            color: scheme.surfaceContainerLowest,
            border: Border.all(color: scheme.outlineVariant),
            borderRadius: AppShapes.radiusMd,
          ),
          child: Row(
            children: [
              Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(
                  color: scheme.primary,
                  borderRadius: AppShapes.radiusMd,
                ),
                child: Center(
                  child: AppIcon('sparkle', size: 18, color: scheme.onPrimary),
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Ask NostrFeed AI',
                      style: textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    Text(
                      trialLeft > 0
                          ? 'Summarize, translate, create · $trialLeft free today'
                          : 'Summarize, translate, create · from 1⚡/msg',
                      style: textTheme.labelSmall?.copyWith(
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
              AppIcon('chevron_r', size: AppIconSize.xs, color: scheme.onSurfaceVariant),
            ],
          ),
        ),
      ),
    );
  }
}

/// A browse chip — the discovery/community features that used to live in
/// the drawer. Hairline chip with a stroke icon, taps to the feature route.
class _BrowseChip extends StatelessWidget {
  final String icon;
  final String label;
  final String route;
  const _BrowseChip({required this.icon, required this.label, required this.route});

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: InkWell(
        onTap: () => context.push(route),
        borderRadius: AppShapes.radiusFull,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
          decoration: BoxDecoration(
            color: colorScheme.surfaceContainerLowest,
            border: Border.all(color: colorScheme.outlineVariant),
            borderRadius: AppShapes.radiusFull,
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              AppIcon(icon, size: AppIconSize.sm, color: colorScheme.primary),
              const SizedBox(width: 6),
              Text(
                label,
                style: Theme.of(context).textTheme.labelLarge?.copyWith(
                      fontWeight: FontWeight.w600,
                    ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The Refined section header — uppercase accent label, consistent across
/// every Explore section (hashtags / people / posts).
class _SectionHeader extends StatelessWidget {
  final String title;
  final double top;
  const _SectionHeader(this.title, {this.top = 12});

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Padding(
      padding: EdgeInsets.fromLTRB(16, top, 16, 6),
      child: Text(
        title.toUpperCase(),
        style: Theme.of(context).textTheme.labelSmall?.copyWith(
              fontWeight: FontWeight.w700,
              color: colorScheme.primary,
              letterSpacing: 1.2,
            ),
      ),
    );
  }
}

/// Trending authors worth following: the authors of trending posts,
/// deduplicated, profiles checked against the content filter.
class _PeopleToFollow extends ConsumerWidget {
  const _PeopleToFollow();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final trending = ref.watch(trendingProvider(24)).valueOrNull ?? [];
    final follows = ref.watch(followsProvider).valueOrNull ?? [];
    final auth = ref.watch(authStateProvider);

    // Authors of trending posts, most-posting first, excluding self/follows.
    final counts = <String, int>{};
    for (final e in trending) {
      counts[e.pubkey] = (counts[e.pubkey] ?? 0) + 1;
    }
    final candidates = counts.entries.toList()
      ..sort((a, b) => b.value.compareTo(a.value));
    final pubkeys = candidates
        .map((e) => e.key)
        .where((pk) => pk != auth.pubkey && !follows.contains(pk))
        .take(8)
        .toList();

    if (pubkeys.isEmpty) return const SizedBox.shrink();

    return SizedBox(
      height: 176,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        itemCount: pubkeys.length,
        separatorBuilder: (_, _) => const SizedBox(width: 10),
        itemBuilder: (context, i) => _PersonCard(pubkey: pubkeys[i]),
      ),
    );
  }
}

class _PersonCard extends ConsumerWidget {
  final String pubkey;
  const _PersonCard({required this.pubkey});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final profileAsync = ref.watch(profileProvider(pubkey));
    final profile = profileAsync.valueOrNull;

    // Filtered profiles don't get recommended.
    final filter = ref.watch(contentFilterProvider);
    if (filter.verdictForProfile(profile, pubkey).action !=
        FilterAction.show) {
      return const SizedBox.shrink();
    }

    final name = profile?.displayNameOrName ??
        '${pubkey.substring(0, 8)}…';

    final textTheme = Theme.of(context).textTheme;

    return Container(
      width: 132,
      padding: AppSpacing.paddingSm,
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLowest,
        border: Border.all(color: scheme.outlineVariant),
        borderRadius: AppShapes.radiusMd,
      ),
      child: Column(
        children: [
          SafeAvatar(
            imageUrl: profile?.picture,
            radius: 26,
            fallback: Text(
              firstGrapheme(name),
              style: const TextStyle(fontWeight: FontWeight.bold),
            ),
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            name,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w600),
          ),
          if (profile?.nip05 != null && profile!.nip05!.isNotEmpty)
            Text(
              profile.nip05!,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: textTheme.labelSmall?.copyWith(color: scheme.primary),
            ),
          const Spacer(),
          SizedBox(
            width: double.infinity,
            child: FilledButton.tonal(
              onPressed: () => context.push('/profile/$pubkey'),
              style: FilledButton.styleFrom(
                padding: const EdgeInsets.symmetric(
                    vertical: AppSpacing.xxs),
                minimumSize: const Size(0, 30),
              ),
              child: Text('View', style: textTheme.labelMedium),
            ),
          ),
        ],
      ),
    );
  }
}
