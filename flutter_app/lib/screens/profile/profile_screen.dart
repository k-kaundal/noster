import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shimmer/shimmer.dart';

import '../../models/nostr_models.dart';
import '../../providers/app_providers.dart';
import '../../widgets/post/post_card.dart';
import '../../widgets/profile/profile_avatar.dart';
import 'edit_profile_screen.dart';

class ProfileScreen extends ConsumerStatefulWidget {
  final String? pubkey;

  const ProfileScreen({super.key, this.pubkey});

  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 4, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authStateProvider);
    final targetPubkey = widget.pubkey ?? auth.pubkey;

    if (targetPubkey == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Profile')),
        body: const Center(child: Text('No user specified')),
      );
    }

    final profileAsync = ref.watch(profileProvider(targetPubkey));
    final isOwnProfile = auth.pubkey == targetPubkey;

    return Scaffold(
      body: profileAsync.when(
        data: (profile) => _buildProfile(context, targetPubkey, profile, isOwnProfile),
        loading: () => _buildSkeleton(context),
        error: (error, stack) => Scaffold(
          appBar: AppBar(title: const Text('Profile')),
          body: Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(Icons.error_outline, size: 48),
                const SizedBox(height: 16),
                Text('Failed to load profile: $error'),
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: () => ref.invalidate(profileProvider(targetPubkey)),
                  child: const Text('Retry'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildProfile(
    BuildContext context,
    String pubkey,
    NostrProfile? profile,
    bool isOwnProfile,
  ) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final followsAsync = ref.watch(followsProvider);
    final feedAsync = ref.watch(feedProvider);
    final auth = ref.watch(authStateProvider);

    final isFollowing = followsAsync.value?.contains(pubkey) ?? false;

    return NestedScrollView(
      headerSliverBuilder: (context, innerBoxIsScrolled) {
        return [
          SliverAppBar(
            expandedHeight: 200,
            pinned: true,
            flexibleSpace: FlexibleSpaceBar(
              background: Stack(
                fit: StackFit.expand,
                children: [
                  // Banner
                  if (profile?.banner != null && profile!.banner!.isNotEmpty)
                    CachedNetworkImage(
                      imageUrl: profile.banner!,
                      fit: BoxFit.cover,
                      placeholder: (context, url) => Container(
                        color: scheme.primaryContainer,
                      ),
                      errorWidget: (context, url, error) => Container(
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            begin: Alignment.topLeft,
                            end: Alignment.bottomRight,
                            colors: [scheme.primary, scheme.tertiary],
                          ),
                        ),
                      ),
                    )
                  else
                    Container(
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                          colors: [scheme.primary, scheme.tertiary],
                        ),
                      ),
                    ),
                  // Gradient overlay for readability
                  Container(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                        colors: [
                          Colors.transparent,
                          Colors.black.withValues(alpha: 0.4),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
            actions: [
              if (isOwnProfile)
                IconButton(
                  icon: const Icon(Icons.edit_outlined),
                  tooltip: 'Edit Profile',
                  onPressed: () => EditProfileScreen.show(context),
                ),
            ],
          ),
          SliverToBoxAdapter(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Avatar + follow button row
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      // Avatar overlaps banner
                      Transform.translate(
                        offset: const Offset(0, -32),
                        child: Container(
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            border: Border.all(
                              color: scheme.surface,
                              width: 4,
                            ),
                          ),
                          child: ProfileAvatar(
                            profile: profile,
                            pubkey: pubkey,
                            radius: 40,
                            showRing: true,
                          ),
                        ),
                      ),
                      // Follow / Edit button
                      Transform.translate(
                        offset: const Offset(0, -8),
                        child: isOwnProfile
                            ? OutlinedButton.icon(
                                onPressed: () => EditProfileScreen.show(context),
                                icon: const Icon(Icons.edit_outlined, size: 18),
                                label: const Text('Edit Profile'),
                              )
                            : FilledButton.icon(
                                onPressed: auth.isLoggedIn && !auth.isReadOnly
                                    ? () => _toggleFollow(pubkey, isFollowing)
                                    : null,
                                icon: Icon(
                                  isFollowing
                                      ? Icons.person_remove_outlined
                                      : Icons.person_add_outlined,
                                  size: 18,
                                ),
                                label: Text(isFollowing ? 'Unfollow' : 'Follow'),
                              ),
                      ),
                    ],
                  ),
                ),
                // Reduce the offset gap
                const SizedBox(height: 0),
                // Name & nip05
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        profile?.displayNameOrName ?? 'Anonymous',
                        style: theme.textTheme.headlineSmall?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      if (profile?.nip05 != null && profile!.nip05!.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(top: 4),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(
                                Icons.verified,
                                size: 16,
                                color: scheme.primary,
                              ),
                              const SizedBox(width: 4),
                              Text(
                                profile.nip05!,
                                style: theme.textTheme.bodySmall?.copyWith(
                                  color: scheme.primary,
                                ),
                              ),
                            ],
                          ),
                        ),
                      if (profile?.about != null && profile!.about!.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(top: 8),
                          child: Text(
                            profile.about!,
                            style: theme.textTheme.bodyMedium,
                          ),
                        ),
                      const SizedBox(height: 16),
                      // Stats row
                      _StatsRow(
                        pubkey: pubkey,
                        postsCount: feedAsync.value
                                ?.where((e) => e.pubkey == pubkey && e.kind == 1)
                                .length ??
                            0,
                        followingCount: followsAsync.value?.length ?? 0,
                      ),
                      const SizedBox(height: 8),
                    ],
                  ),
                ),
              ],
            ),
          ),
          SliverPersistentHeader(
            pinned: true,
            delegate: _TabBarDelegate(
              tabBar: TabBar(
                controller: _tabController,
                labelColor: scheme.primary,
                unselectedLabelColor: scheme.onSurface.withValues(alpha: 0.6),
                indicatorColor: scheme.primary,
                tabs: const [
                  Tab(text: 'Posts'),
                  Tab(text: 'Replies'),
                  Tab(text: 'Media'),
                  Tab(text: 'Likes'),
                ],
              ),
              color: scheme.surface,
            ),
          ),
        ];
      },
      body: TabBarView(
        controller: _tabController,
        children: [
          _PostsTab(pubkey: pubkey, filter: (e) => e.kind == 1 && !e.isReply),
          _PostsTab(pubkey: pubkey, filter: (e) => e.kind == 1 && e.isReply),
          _PostsTab(pubkey: pubkey, filter: (e) => e.kind == 1 && _hasMedia(e)),
          _PostsTab(pubkey: pubkey, filter: (e) => e.kind == 7),
        ],
      ),
    );
  }

  bool _hasMedia(NostrEvent event) {
    final content = event.content.toLowerCase();
    return content.contains('.jpg') ||
        content.contains('.jpeg') ||
        content.contains('.png') ||
        content.contains('.gif') ||
        content.contains('.webp') ||
        content.contains('.mp4') ||
        content.contains('.mov');
  }

  Future<void> _toggleFollow(String pubkey, bool isFollowing) async {
    try {
      final nostr = ref.read(nostrServiceProvider);
      final currentFollows = await ref.read(followsProvider.future);

      final updated = isFollowing
          ? currentFollows.where((pk) => pk != pubkey).toList()
          : [...currentFollows, pubkey];

      final event = nostr.updateFollows(updated);
      nostr.publish(event);
      ref.invalidate(followsProvider);

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(isFollowing ? 'Unfollowed' : 'Followed'),
            duration: const Duration(seconds: 2),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to update follow: $e'),
            backgroundColor: Theme.of(context).colorScheme.error,
          ),
        );
      }
    }
  }

  Widget _buildSkeleton(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final baseColor = scheme.surfaceContainerHighest;
    final highlightColor = scheme.surface;

    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: Shimmer.fromColors(
        baseColor: baseColor,
        highlightColor: highlightColor,
        child: ListView(
          padding: EdgeInsets.zero,
          children: [
            // Banner skeleton
            Container(height: 200, color: baseColor),
            Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      CircleAvatar(radius: 40, backgroundColor: baseColor),
                      Container(
                        width: 100,
                        height: 36,
                        decoration: BoxDecoration(
                          color: baseColor,
                          borderRadius: BorderRadius.circular(18),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  Container(
                    width: 160,
                    height: 24,
                    decoration: BoxDecoration(
                      color: baseColor,
                      borderRadius: BorderRadius.circular(4),
                    ),
                  ),
                  const SizedBox(height: 8),
                  Container(
                    width: 120,
                    height: 14,
                    decoration: BoxDecoration(
                      color: baseColor,
                      borderRadius: BorderRadius.circular(4),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Container(
                    width: double.infinity,
                    height: 14,
                    decoration: BoxDecoration(
                      color: baseColor,
                      borderRadius: BorderRadius.circular(4),
                    ),
                  ),
                  const SizedBox(height: 6),
                  Container(
                    width: MediaQuery.of(context).size.width * 0.7,
                    height: 14,
                    decoration: BoxDecoration(
                      color: baseColor,
                      borderRadius: BorderRadius.circular(4),
                    ),
                  ),
                  const SizedBox(height: 16),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceAround,
                    children: List.generate(
                      3,
                      (_) => Container(
                        width: 60,
                        height: 40,
                        decoration: BoxDecoration(
                          color: baseColor,
                          borderRadius: BorderRadius.circular(8),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            // Post skeletons
            ...List.generate(
              3,
              (_) => Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                child: Container(
                  height: 120,
                  decoration: BoxDecoration(
                    color: baseColor,
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _TabBarDelegate extends SliverPersistentHeaderDelegate {
  final TabBar tabBar;
  final Color color;

  _TabBarDelegate({required this.tabBar, required this.color});

  @override
  double get minExtent => tabBar.preferredSize.height;

  @override
  double get maxExtent => tabBar.preferredSize.height;

  @override
  Widget build(BuildContext context, double shrinkOffset, bool overlapsContent) {
    return Container(color: color, child: tabBar);
  }

  @override
  bool shouldRebuild(_TabBarDelegate oldDelegate) =>
      tabBar != oldDelegate.tabBar || color != oldDelegate.color;
}

class _StatsRow extends StatelessWidget {
  final String pubkey;
  final int postsCount;
  final int followingCount;

  const _StatsRow({
    required this.pubkey,
    required this.postsCount,
    required this.followingCount,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        _StatItem(count: postsCount, label: 'Posts'),
        const SizedBox(width: 24),
        _StatItem(count: followingCount, label: 'Following'),
        const SizedBox(width: 24),
        const _StatItem(count: 0, label: 'Followers'),
      ],
    );
  }
}

class _StatItem extends StatelessWidget {
  final int count;
  final String label;

  const _StatItem({required this.count, required this.label});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return Row(
      children: [
        Text(
          count.toString(),
          style: theme.textTheme.titleMedium?.copyWith(
            fontWeight: FontWeight.bold,
          ),
        ),
        const SizedBox(width: 4),
        Text(
          label,
          style: theme.textTheme.bodyMedium?.copyWith(
            color: scheme.onSurface.withValues(alpha: 0.6),
          ),
        ),
      ],
    );
  }
}

class _PostsTab extends ConsumerWidget {
  final String pubkey;
  final bool Function(NostrEvent) filter;

  const _PostsTab({required this.pubkey, required this.filter});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final feedAsync = ref.watch(feedProvider);

    return feedAsync.when(
      data: (events) {
        final userPosts = events
            .where((e) => e.pubkey == pubkey && filter(e))
            .toList()
          ..sort((a, b) => b.createdAt.compareTo(a.createdAt));

        if (userPosts.isEmpty) {
          return Center(
            child: Padding(
              padding: const EdgeInsets.all(32),
              child: Text(
                'No posts yet',
                style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                      color: Theme.of(context)
                          .colorScheme
                          .onSurface
                          .withValues(alpha: 0.6),
                    ),
              ),
            ),
          );
        }

        return ListView.builder(
          padding: const EdgeInsets.only(top: 8),
          itemCount: userPosts.length,
          itemBuilder: (context, index) {
            final event = userPosts[index];
            return _PostListItem(event: event);
          },
        );
      },
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, stack) => Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text('Failed to load posts: $error'),
        ),
      ),
    );
  }
}

class _PostListItem extends ConsumerWidget {
  final NostrEvent event;

  const _PostListItem({required this.event});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return PostCard(event: event);
  }
}
