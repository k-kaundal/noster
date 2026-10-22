import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/moderation/content_filter.dart';
import 'package:nostrfeed_mobile/core/moderation/moderation_providers.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
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

    return Scaffold(
      appBar: AppBar(
        title: const Text('Explore'),
        actions: [
          IconButton(
            icon: const Icon(Icons.search),
            onPressed: () => context.push('/search'),
            tooltip: 'Search',
          ),
        ],
      ),
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

            // Trending hashtags — NSFW tags filtered out before display.
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                child: Text(
                  'Trending Hashtags',
                  style: Theme.of(context)
                      .textTheme
                      .titleSmall
                      ?.copyWith(fontWeight: FontWeight.bold),
                ),
              ),
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
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.onSurfaceVariant,
                          fontSize: 13,
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
                          avatar: const Icon(Icons.tag, size: 16),
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
              child: Padding(
                padding: EdgeInsets.fromLTRB(16, 20, 16, 4),
                child: _PeopleToFollowHeader(),
              ),
            ),
            const SliverToBoxAdapter(child: _PeopleToFollow()),

            // Trending posts
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 20, 16, 8),
                child: Row(
                  children: [
                    Text(
                      'Trending Posts',
                      style: Theme.of(context)
                          .textTheme
                          .titleSmall
                          ?.copyWith(fontWeight: FontWeight.bold),
                    ),
                    const Spacer(),
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

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: () => context.push('/ai'),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: [
                scheme.primaryContainer.withValues(alpha: 0.55),
                scheme.tertiaryContainer.withValues(alpha: 0.35),
              ],
            ),
            borderRadius: BorderRadius.circular(14),
          ),
          child: Row(
            children: [
              Icon(Icons.auto_awesome_rounded,
                  size: 20, color: scheme.primary),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Ask NostrFeed AI',
                      style: TextStyle(
                        fontWeight: FontWeight.w700,
                        fontSize: 14,
                      ),
                    ),
                    Text(
                      trialLeft > 0
                          ? 'Summarize, translate, create · $trialLeft free today'
                          : 'Summarize, translate, create · from 1⚡/msg',
                      style: TextStyle(
                        fontSize: 11.5,
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
              Icon(Icons.arrow_forward_ios_rounded,
                  size: 14, color: scheme.onSurfaceVariant),
            ],
          ),
        ),
      ),
    );
  }
}

class _PeopleToFollowHeader extends StatelessWidget {
  const _PeopleToFollowHeader();

  @override
  Widget build(BuildContext context) {
    return Text(
      'People to follow',
      style: Theme.of(context)
          .textTheme
          .titleSmall
          ?.copyWith(fontWeight: FontWeight.bold),
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

    return Container(
      width: 132,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(14),
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
          const SizedBox(height: 8),
          Text(
            name,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
          ),
          if (profile?.nip05 != null && profile!.nip05!.isNotEmpty)
            Text(
              profile.nip05!,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 10, color: scheme.primary),
            ),
          const Spacer(),
          SizedBox(
            width: double.infinity,
            child: FilledButton.tonal(
              onPressed: () => context.push('/profile/$pubkey'),
              style: FilledButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 4),
                minimumSize: const Size(0, 30),
              ),
              child: const Text('View', style: TextStyle(fontSize: 12)),
            ),
          ),
        ],
      ),
    );
  }
}
