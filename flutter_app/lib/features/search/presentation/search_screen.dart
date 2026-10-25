import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/moderation/content_filter.dart';
import 'package:nostrfeed_mobile/core/moderation/moderation_providers.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/theme/app_shapes.dart';
import 'package:nostrfeed_mobile/core/theme/app_spacing.dart';
import 'package:nostrfeed_mobile/core/widgets/empty_state.dart';
import 'package:nostrfeed_mobile/core/widgets/error_view.dart';
import 'package:nostrfeed_mobile/core/widgets/safe_image.dart';
import 'package:nostrfeed_mobile/core/widgets/skeleton.dart';
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:timeago/timeago.dart' as timeago;

/// Provider holding the current search query text.
final searchQueryProvider = StateProvider.autoDispose<String>((ref) => '');

class SearchScreen extends ConsumerStatefulWidget {
  const SearchScreen({super.key});

  @override
  ConsumerState<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends ConsumerState<SearchScreen>
    with SingleTickerProviderStateMixin {
  final _searchController = TextEditingController();
  final _searchFocusNode = FocusNode();
  late final TabController _tabController;
  List<String> _recentSearches = [];
  Timer? _debounce;

  static const _recentSearchesKey = 'recent_searches';
  static const _commonHashtags = [
    'nostr',
    'bitcoin',
    'lightning',
    'zaps',
    'gm',
    'plebchain',
    'photography',
    'art',
    'music',
    'memes',
    'technology',
    'news',
  ];

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
    _loadRecentSearches();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _searchController.dispose();
    _searchFocusNode.dispose();
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _loadRecentSearches() async {
    final prefs = await SharedPreferences.getInstance();
    setState(() {
      _recentSearches = prefs.getStringList(_recentSearchesKey) ?? [];
    });
  }

  Future<void> _saveRecentSearch(String query) async {
    if (query.trim().isEmpty) return;
    final prefs = await SharedPreferences.getInstance();
    final updated = [query, ..._recentSearches.where((q) => q != query)];
    if (updated.length > 10) updated.removeRange(10, updated.length);
    await prefs.setStringList(_recentSearchesKey, updated);
    setState(() => _recentSearches = updated);
  }

  Future<void> _clearRecentSearches() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_recentSearchesKey);
    setState(() => _recentSearches = []);
  }

  /// Debounced: only update the provider (which flips the body to the
  /// TabBarView) AFTER the user pauses typing. Updating the provider on
  /// every keystroke rebuilds the Scaffold and the TextField loses focus,
  /// which is what caused the keyboard to dismiss on first type.
  void _onQueryChanged(String value) {
    _debounce?.cancel();
    final q = value.trim();
    _debounce = Timer(const Duration(milliseconds: 400), () {
      if (!mounted) return;
      ref.read(searchQueryProvider.notifier).state = q;
    });
  }

  void _onSubmitted(String value) {
    final q = value.trim();
    if (q.isEmpty) return;
    HapticFeedback.mediumImpact();
    _debounce?.cancel();
    _saveRecentSearch(q);
    ref.read(searchQueryProvider.notifier).state = q;
  }

  void _useRecentSearch(String query) {
    HapticFeedback.lightImpact();
    _searchController.text = query;
    // Move cursor to end
    _searchController.selection = TextSelection.fromPosition(
      TextPosition(offset: _searchController.text.length),
    );
    _onSubmitted(query);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final query = ref.watch(searchQueryProvider);
    final hasQuery = query.isNotEmpty;

    return Scaffold(
      backgroundColor: colorScheme.surface,
      appBar: AppBar(
        leading: IconButton(
          icon: const AppIcon('back'),
          tooltip: 'Back',
          onPressed: () {
            HapticFeedback.lightImpact();
            context.pop();
          },
        ),
        title: TextField(
          controller: _searchController,
          focusNode: _searchFocusNode,
          textInputAction: TextInputAction.search,
          autocorrect: false,
          enableSuggestions: true,
          onChanged: (value) {
            setState(() {}); // refresh clear-button visibility
            _onQueryChanged(value);
          },
          onSubmitted: _onSubmitted,
          decoration: InputDecoration(
            hintText: 'Search posts, @people, #hashtags, npub…',
            filled: true,
            fillColor: colorScheme.surfaceContainerHighest,
            isDense: true,
            contentPadding:
                const EdgeInsets.symmetric(vertical: AppSpacing.xs),
            border: OutlineInputBorder(
              borderRadius: AppShapes.radiusFull,
              borderSide: BorderSide.none,
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: AppShapes.radiusFull,
              borderSide: BorderSide.none,
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: AppShapes.radiusFull,
              borderSide: BorderSide.none,
            ),
            prefixIcon: AppIcon('search', size: AppIconSize.md),
            suffixIcon: _searchController.text.isNotEmpty
                ? IconButton(
                    icon: const AppIcon('plus'),
                    onPressed: () {
                      _searchController.clear();
                      _debounce?.cancel();
                      ref.read(searchQueryProvider.notifier).state = '';
                      setState(() {});
                      // Keep keyboard open so the user can type a new query
                      _searchFocusNode.requestFocus();
                    },
                  )
                : null,
          ),
        ),
        bottom: hasQuery
            ? PreferredSize(
                preferredSize: const Size.fromHeight(48),
                child: Container(
                  decoration: BoxDecoration(
                    border: Border(
                      bottom: BorderSide(
                        color: colorScheme.outlineVariant.withValues(alpha: 0.3),
                      ),
                    ),
                  ),
                  child: TabBar(
                    controller: _tabController,
                    labelColor: colorScheme.primary,
                    unselectedLabelColor: colorScheme.onSurfaceVariant,
                    indicatorColor: colorScheme.primary,
                    indicatorWeight: 3,
                    labelStyle: Theme.of(context)
                        .textTheme
                        .titleSmall
                        ?.copyWith(fontWeight: FontWeight.w600),
                    tabs: const [
                      Tab(text: 'Posts'),
                      Tab(text: 'People'),
                      Tab(text: 'Hashtags'),
                    ],
                  ),
                ),
              )
            : null,
      ),
      body: hasQuery
          ? TabBarView(
              controller: _tabController,
              children: [
                _PostsTab(query: query),
                _PeopleTab(query: query),
                _HashtagsTab(
                  query: query,
                  onTagTap: (tag) {
                    HapticFeedback.lightImpact();
                    _searchController.text = '#$tag';
                    _onSubmitted('#$tag');
                    _tabController.animateTo(0);
                  },
                ),
              ],
            )
          : _buildIdleState(theme),
    );
  }

  Widget _buildIdleState(ThemeData theme) {
    final colorScheme = theme.colorScheme;

    if (_recentSearches.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                padding: const EdgeInsets.all(24),
                decoration: BoxDecoration(
                  color: colorScheme.primaryContainer.withValues(alpha: 0.3),
                  shape: BoxShape.circle,
                ),
                child: AppIcon(
                  'search',
                  size: 56,
                  color: colorScheme.primary,
                ),
              ),
              const SizedBox(height: 24),
              Text(
                'Search Nostr',
                style: theme.textTheme.titleLarge?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: AppSpacing.xs),
              Text(
                'Find posts, people, and hashtags',
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
      );
    }

    return ListView(
      padding: const EdgeInsets.symmetric(vertical: 8),
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 16, 12, 12),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'RECENT SEARCHES',
                style: theme.textTheme.labelSmall?.copyWith(
                  fontWeight: FontWeight.w700,
                  color: colorScheme.primary,
                  letterSpacing: 1.2,
                ),
              ),
              TextButton.icon(
                onPressed: () {
                  HapticFeedback.lightImpact();
                  _clearRecentSearches();
                },
                icon: const AppIcon('plus', size: 18),
                label: const Text('Clear'),
                style: TextButton.styleFrom(
                  foregroundColor: colorScheme.primary,
                ),
              ),
            ],
          ),
        ),
        for (final q in _recentSearches)
          _RecentSearchTile(
            query: q,
            onTap: () => _useRecentSearch(q),
          ),
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 24, 20, 12),
          child: Text(
            'TRENDING HASHTAGS',
            style: theme.textTheme.labelSmall?.copyWith(
              fontWeight: FontWeight.w700,
              color: colorScheme.primary,
              letterSpacing: 1.2,
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: Wrap(
            spacing: 10,
            runSpacing: 10,
            children: [
              for (final tag in _commonHashtags)
                _HashtagChip(
                  tag: tag,
                  onTap: () => _useRecentSearch('#$tag'),
                ),
            ],
          ),
        ),
        const SizedBox(height: 24),
      ],
    );
  }
}

// ─── Recent Search Tile ─────────────────────────────────────────────

class _RecentSearchTile extends StatelessWidget {
  final String query;
  final VoidCallback onTap;

  const _RecentSearchTile({required this.query, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;

    return Material(
      type: MaterialType.transparency,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.lg,
            vertical: AppSpacing.sm,
          ),
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: colorScheme.surfaceContainerHighest,
                  shape: BoxShape.circle,
                ),
                child: AppIcon(
                  'clock',
                  size: AppIconSize.lg,
                  color: colorScheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Text(
                  query,
                  style: Theme.of(context)
                      .textTheme
                      .titleSmall
                      ?.copyWith(fontWeight: FontWeight.w500),
                ),
              ),
              AppIcon('chevron_r', size: 14, color: colorScheme.onSurfaceVariant.withValues(alpha: 0.5),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ─── Hashtag Chip ───────────────────────────────────────────────────

class _HashtagChip extends StatelessWidget {
  final String tag;
  final VoidCallback onTap;

  const _HashtagChip({required this.tag, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;

    return Material(
      type: MaterialType.transparency,
      child: InkWell(
        onTap: onTap,
        borderRadius: AppShapes.radiusXl,
        child: Container(
          padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.md, vertical: AppSpacing.sm - 2),
          decoration: BoxDecoration(
            color: colorScheme.primaryContainer.withValues(alpha: 0.5),
            borderRadius: AppShapes.radiusXl,
            border: Border.all(
              color: colorScheme.primary.withValues(alpha: 0.3),
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              AppIcon(
                'hash',
                size: AppIconSize.sm,
                color: colorScheme.primary,
              ),
              const SizedBox(width: AppSpacing.xxs),
              Text(
                tag,
                style: Theme.of(context).textTheme.labelLarge?.copyWith(
                      fontWeight: FontWeight.w600,
                      color: colorScheme.primary,
                    ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ─── Posts Tab ──────────────────────────────────────────────────────

class _PostsTab extends ConsumerWidget {
  final String query;
  const _PostsTab({required this.query});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final results = ref.watch(searchProvider(query));

    return results.when(
      data: (events) {
        if (events.isEmpty) {
          return EmptyState(
            icon: Icons.article_outlined,
            title: 'No posts found for "$query"',
          );
        }
        return ListView.separated(
          padding: const EdgeInsets.symmetric(vertical: 8),
          itemCount: events.length,
          separatorBuilder: (_, _) => Divider(
            height: 1,
            indent: 80,
            color: Theme.of(context).colorScheme.outlineVariant.withValues(alpha: 0.3),
          ),
          itemBuilder: (context, i) => _PostTile(event: events[i]),
        );
      },
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => EmptyState(
        icon: Icons.error_outline_rounded,
        title: 'Search failed: $e',
      ),
    );
  }
}

class _PostTile extends ConsumerWidget {
  final NostrEvent event;
  const _PostTile({required this.event});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final profile = ref.watch(profileProvider(event.pubkey)).value;

    // Content filter: spam/NSFW/blocked posts do not appear in search.
    final verdict =
        filteredEventVerdict(ref, event, authorProfile: profile);
    if (verdict.action == FilterAction.hide) {
      return const SizedBox.shrink();
    }

    final name = profile?.displayNameOrName ??
        '${event.pubkey.substring(0, 8)}…';
    final time = DateTime.fromMillisecondsSinceEpoch(event.createdAt * 1000);

    return Material(
      type: MaterialType.transparency,
      child: InkWell(
        onTap: () {
          HapticFeedback.lightImpact();
          context.push('/profile/${event.pubkey}');
        },
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.lg,
            vertical: AppSpacing.sm,
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _Avatar(imageUrl: profile?.picture, name: name),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context)
                          .textTheme
                          .titleSmall
                          ?.copyWith(fontWeight: FontWeight.w700),
                    ),
                    const SizedBox(height: AppSpacing.xxs),
                    Text(
                      event.content,
                      maxLines: 3,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        height: 1.4,
                        color: colorScheme.onSurface.withValues(alpha: 0.9),
                      ),
                    ),
                    const SizedBox(height: AppSpacing.xs - 2),
                    Text(
                      timeago.format(time),
                      style: theme.textTheme.labelSmall?.copyWith(
                        color: colorScheme.onSurfaceVariant,
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
}

// ─── People Tab ─────────────────────────────────────────────────────

class _PeopleTab extends ConsumerWidget {
  final String query;
  const _PeopleTab({required this.query});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final results = ref.watch(userSearchProvider(query));

    return results.when(
      data: (events) {
        if (events.isEmpty) {
          return EmptyState(
            icon: Icons.people_outline_rounded,
            title: 'No people found for "$query"',
          );
        }
        return ListView.separated(
          padding: const EdgeInsets.symmetric(vertical: 8),
          itemCount: events.length,
          separatorBuilder: (_, _) => Divider(
            height: 1,
            indent: 80,
            color: Theme.of(context).colorScheme.outlineVariant.withValues(alpha: 0.3),
          ),
          itemBuilder: (context, i) => _PersonTile(event: events[i]),
        );
      },
      loading: () => const SkeletonList(itemCount: 5),
      error: (e, _) => ErrorView.fromError(
        e,
        onRetry: () => ref.invalidate(userSearchProvider(query)),
      ),
    );
  }
}

class _PersonTile extends ConsumerWidget {
  final NostrEvent event;
  const _PersonTile({required this.event});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colorScheme = Theme.of(context).colorScheme;
    NostrProfile? profile;
    try {
      final json = jsonDecode(event.content) as Map<String, dynamic>;
      profile = NostrProfile.fromJson(json);
    } catch (_) {}

    // Content filter: explicit or blocked profiles do not appear in search.
    final filter = ref.watch(contentFilterProvider);
    if (filter.verdictForProfile(profile, event.pubkey).action !=
        FilterAction.show) {
      return const SizedBox.shrink();
    }

    final name = profile?.displayNameOrName ??
        '${event.pubkey.substring(0, 8)}…';
    final auth = ref.watch(authStateProvider);
    final follows = ref.watch(followsProvider).value ?? [];
    final isFollowing = follows.contains(event.pubkey);
    final isSelf = auth.pubkey == event.pubkey;

    return Material(
      type: MaterialType.transparency,
      child: InkWell(
        onTap: () {
          HapticFeedback.lightImpact();
          context.push('/profile/${event.pubkey}');
        },
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.lg,
            vertical: AppSpacing.sm,
          ),
          child: Row(
            children: [
              _Avatar(imageUrl: profile?.picture, name: name),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Flexible(
                          child: Text(
                            name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: Theme.of(context)
                                .textTheme
                                .titleSmall
                                ?.copyWith(fontWeight: FontWeight.w700),
                          ),
                        ),
                        if (profile?.nip05 != null &&
                            profile!.nip05!.isNotEmpty) ...[
                          const SizedBox(width: 4),
                          AppIcon(
                            'verified',
                            size: AppIconSize.sm,
                            color: colorScheme.primary,
                          ),
                        ],
                      ],
                    ),
                    if (profile?.nip05 != null &&
                        profile!.nip05!.isNotEmpty) ...[
                      const SizedBox(height: 1),
                      Text(
                        profile.nip05!,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context)
                            .textTheme
                            .labelMedium
                            ?.copyWith(
                              color: colorScheme.primary,
                              fontWeight: FontWeight.w500,
                            ),
                      ),
                    ],
                    if (profile?.about != null &&
                        profile!.about!.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(
                        profile.about!,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context)
                            .textTheme
                            .bodySmall
                            ?.copyWith(color: colorScheme.onSurfaceVariant),
                      ),
                    ],
                  ],
                ),
              ),
              if (auth.isLoggedIn && !auth.isReadOnly && !isSelf) ...[
                const SizedBox(width: AppSpacing.sm),
                FilledButton.tonal(
                  onPressed: () {
                    HapticFeedback.mediumImpact();
                    final nostr = ref.read(nostrServiceProvider);
                    final updated = isFollowing
                        ? follows.where((p) => p != event.pubkey).toList()
                        : [...follows, event.pubkey];
                    final ev = nostr.updateFollows(updated);
                    nostr.publishEvent(ev);
                    ref.invalidate(followsProvider);
                  },
                  style: FilledButton.styleFrom(
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppSpacing.md,
                      vertical: AppSpacing.xs,
                    ),
                  ),
                  child: Text(
                    isFollowing ? 'Unfollow' : 'Follow',
                    style: Theme.of(context).textTheme.labelLarge,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

// ─── Hashtags Tab ───────────────────────────────────────────────────

class _HashtagsTab extends ConsumerWidget {
  final String query;
  final void Function(String tag) onTagTap;
  const _HashtagsTab({required this.query, required this.onTagTap});

  static const _tags = [
    'nostr',
    'bitcoin',
    'lightning',
    'zaps',
    'gm',
    'plebchain',
    'photography',
    'art',
    'music',
    'memes',
    'technology',
    'news',
  ];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final cleaned = query.replaceAll('#', '').toLowerCase();

    // Merge live trending hashtags from the relay with the static list,
    // then filter by the query. Live tags come first (sorted by usage).
    final trendingAsync = ref.watch(trendingHashtagsProvider);
    final liveTags = trendingAsync.valueOrNull
            ?.map((s) => s.tag)
            .where((t) => cleaned.isEmpty || t.contains(cleaned))
            .toList() ??
        [];
    final staticMatches = _tags
        .where((t) => cleaned.isEmpty || t.contains(cleaned))
        .toList();
    final seen = <String>{};
    final merged = <String>[
      for (final t in [...liveTags, ...staticMatches])
        if (seen.add(t)) t,
    ];

    if (merged.isEmpty) {
      return EmptyState(
        icon: Icons.tag_rounded,
        title: 'No hashtags matching "$query"',
      );
    }

    final counts = {
      for (final s in trendingAsync.valueOrNull ?? <HashtagStat>[]) s.tag: s.count,
    };

    return ListView.separated(
      padding: const EdgeInsets.symmetric(vertical: 8),
      itemCount: merged.length,
      separatorBuilder: (_, _) => Divider(
        height: 1,
        indent: 60,
        color: Theme.of(context).colorScheme.outlineVariant.withValues(alpha: 0.3),
      ),
      itemBuilder: (context, i) {
        final tag = merged[i];
        final count = counts[tag];
        return Material(
          type: MaterialType.transparency,
          child: InkWell(
            onTap: () => onTagTap(tag),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
              child: Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: Theme.of(context).colorScheme.primaryContainer.withValues(alpha: 0.5),
                      shape: BoxShape.circle,
                    ),
                    child: AppIcon('hash', size: 20, color: Theme.of(context).colorScheme.primary,
                    ),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '#$tag',
                          style: Theme.of(context)
                              .textTheme
                              .titleSmall
                              ?.copyWith(fontWeight: FontWeight.w600),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          count != null && count > 0
                              ? '$count recent post${count == 1 ? '' : 's'}'
                              : 'View posts with this hashtag',
                          style: Theme.of(context)
                              .textTheme
                              .bodySmall
                              ?.copyWith(
                                color: Theme.of(context)
                                    .colorScheme
                                    .onSurfaceVariant,
                              ),
                        ),
                      ],
                    ),
                  ),
                  AppIcon('chevron_r', size: 14, color: Theme.of(context).colorScheme.onSurfaceVariant.withValues(alpha: 0.5),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

// ─── Avatar ─────────────────────────────────────────────────────────

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
      radius: 24,
      backgroundColor: colorScheme.primaryContainer,
      fallback: Text(
        initial,
        style: Theme.of(context).textTheme.titleMedium?.copyWith(
              color: colorScheme.onPrimaryContainer,
              fontWeight: FontWeight.w600,
            ),
      ),
    );
  }
}

