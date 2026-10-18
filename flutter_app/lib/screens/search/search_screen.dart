import 'dart:convert';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:timeago/timeago.dart' as timeago;

import '../../models/nostr_models.dart';
import '../../providers/app_providers.dart';

/// Provider holding the current search query text.
final searchQueryProvider = StateProvider<String>((ref) => '');

class SearchScreen extends ConsumerStatefulWidget {
  const SearchScreen({super.key});

  @override
  ConsumerState<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends ConsumerState<SearchScreen>
    with SingleTickerProviderStateMixin {
  final _searchController = TextEditingController();
  late final TabController _tabController;
  List<String> _recentSearches = [];

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
    _searchController.dispose();
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

  void _onQueryChanged(String value) {
    ref.read(searchQueryProvider.notifier).state = value.trim();
  }

  void _onSubmitted(String value) {
    final q = value.trim();
    if (q.isEmpty) return;
    _saveRecentSearch(q);
    ref.read(searchQueryProvider.notifier).state = q;
  }

  void _useRecentSearch(String query) {
    _searchController.text = query;
    _onSubmitted(query);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final query = ref.watch(searchQueryProvider);
    final hasQuery = query.isNotEmpty;

    return Scaffold(
      appBar: AppBar(
        title: TextField(
          controller: _searchController,
          textInputAction: TextInputAction.search,
          decoration: InputDecoration(
            hintText: 'Search Nostr…',
            border: InputBorder.none,
            filled: false,
            prefixIcon: const Icon(Icons.search),
            suffixIcon: _searchController.text.isNotEmpty
                ? IconButton(
                    icon: const Icon(Icons.clear),
                    onPressed: () {
                      _searchController.clear();
                      _onQueryChanged('');
                    },
                  )
                : null,
          ),
          onChanged: _onQueryChanged,
          onSubmitted: _onSubmitted,
        ),
        bottom: hasQuery
            ? TabBar(
                controller: _tabController,
                tabs: const [
                  Tab(text: 'Posts'),
                  Tab(text: 'People'),
                  Tab(text: 'Hashtags'),
                ],
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
    if (_recentSearches.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.search,
              size: 64,
              color: theme.colorScheme.onSurface.withValues(alpha: 0.3),
            ),
            const SizedBox(height: 16),
            Text(
              'Search posts, people, and hashtags',
              style: theme.textTheme.bodyLarge?.copyWith(
                color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
              ),
            ),
          ],
        ),
      );
    }

    return ListView(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 8, 8),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Recent searches',
                style: theme.textTheme.titleSmall,
              ),
              TextButton(
                onPressed: _clearRecentSearches,
                child: const Text('Clear'),
              ),
            ],
          ),
        ),
        for (final q in _recentSearches)
          ListTile(
            leading: const Icon(Icons.history),
            title: Text(q),
            onTap: () => _useRecentSearch(q),
          ),
        const Divider(height: 24),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
          child: Text(
            'Trending hashtags',
            style: theme.textTheme.titleSmall,
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final tag in _commonHashtags)
                ActionChip(
                  label: Text('#$tag'),
                  onPressed: () => _useRecentSearch('#$tag'),
                ),
            ],
          ),
        ),
        const SizedBox(height: 24),
      ],
    );
  }
}

class _PostsTab extends ConsumerWidget {
  final String query;
  const _PostsTab({required this.query});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final results = ref.watch(searchProvider(query));

    return results.when(
      data: (events) {
        if (events.isEmpty) {
          return _EmptyState(
            icon: Icons.article_outlined,
            message: 'No posts found for "$query"',
          );
        }
        return ListView.separated(
          itemCount: events.length,
          separatorBuilder: (_, _) => const Divider(height: 1),
          itemBuilder: (context, i) => _PostTile(event: events[i]),
        );
      },
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => _EmptyState(
        icon: Icons.error_outline,
        message: 'Search failed: $e',
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
    final profile = ref.watch(profileProvider(event.pubkey)).value;
    final name = profile?.displayNameOrName ??
        '${event.pubkey.substring(0, 8)}…';
    final time = DateTime.fromMillisecondsSinceEpoch(event.createdAt * 1000);

    return ListTile(
      leading: _Avatar(imageUrl: profile?.picture, name: name),
      title: Text(
        name,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(fontWeight: FontWeight.w600),
      ),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            event.content,
            maxLines: 3,
            overflow: TextOverflow.ellipsis,
          ),
          const SizedBox(height: 4),
          Text(
            timeago.format(time),
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
            ),
          ),
        ],
      ),
      isThreeLine: true,
      onTap: () => context.push('/profile/${event.pubkey}'),
    );
  }
}

class _PeopleTab extends ConsumerWidget {
  final String query;
  const _PeopleTab({required this.query});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final results = ref.watch(userSearchProvider(query));

    return results.when(
      data: (events) {
        if (events.isEmpty) {
          return _EmptyState(
            icon: Icons.people_outline,
            message: 'No people found for "$query"',
          );
        }
        return ListView.separated(
          itemCount: events.length,
          separatorBuilder: (_, _) => const Divider(height: 1),
          itemBuilder: (context, i) => _PersonTile(event: events[i]),
        );
      },
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => _EmptyState(
        icon: Icons.error_outline,
        message: 'Search failed: $e',
      ),
    );
  }
}

class _PersonTile extends ConsumerWidget {
  final NostrEvent event;
  const _PersonTile({required this.event});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    NostrProfile? profile;
    try {
      final json = jsonDecode(event.content) as Map<String, dynamic>;
      profile = NostrProfile.fromJson(json);
    } catch (_) {}

    final name = profile?.displayNameOrName ??
        '${event.pubkey.substring(0, 8)}…';
    final auth = ref.watch(authStateProvider);
    final follows = ref.watch(followsProvider).value ?? [];
    final isFollowing = follows.contains(event.pubkey);
    final isSelf = auth.pubkey == event.pubkey;

    return ListTile(
      leading: _Avatar(imageUrl: profile?.picture, name: name),
      title: Text(
        name,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(fontWeight: FontWeight.w600),
      ),
      subtitle: Text(
        profile?.about ?? '',
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
      trailing: (auth.isLoggedIn && !auth.isReadOnly && !isSelf)
          ? FilledButton.tonal(
              onPressed: () {
                final nostr = ref.read(nostrServiceProvider);
                final updated = isFollowing
                    ? follows.where((p) => p != event.pubkey).toList()
                    : [...follows, event.pubkey];
                final ev = nostr.updateFollows(updated);
                nostr.publish(ev);
                ref.invalidate(followsProvider);
              },
              child: Text(isFollowing ? 'Unfollow' : 'Follow'),
            )
          : null,
      onTap: () => context.push('/profile/${event.pubkey}'),
    );
  }
}

class _HashtagsTab extends StatelessWidget {
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
  Widget build(BuildContext context) {
    final cleaned = query.replaceAll('#', '').toLowerCase();
    final filtered = cleaned.isEmpty
        ? _tags
        : _tags.where((t) => t.contains(cleaned)).toList();

    if (filtered.isEmpty) {
      return _EmptyState(
        icon: Icons.tag,
        message: 'No hashtags matching "$query"',
      );
    }

    return ListView.separated(
      itemCount: filtered.length,
      separatorBuilder: (_, _) => const Divider(height: 1),
      itemBuilder: (context, i) {
        final tag = filtered[i];
        return ListTile(
          leading: const Icon(Icons.tag),
          title: Text('#$tag'),
          subtitle: const Text('View posts with this hashtag'),
          onTap: () => onTagTap(tag),
        );
      },
    );
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
        child: null,
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

class _EmptyState extends StatelessWidget {
  final IconData icon;
  final String message;
  const _EmptyState({required this.icon, required this.message});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              icon,
              size: 64,
              color: theme.colorScheme.onSurface.withValues(alpha: 0.3),
            ),
            const SizedBox(height: 16),
            Text(
              message,
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyLarge?.copyWith(
                color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
