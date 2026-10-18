import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:shimmer/shimmer.dart';

import '../../models/nostr_models.dart';
import '../../providers/app_providers.dart';
import '../../providers/upload_providers.dart';
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
  final _imagePicker = ImagePicker();
  bool _isUploadingBanner = false;
  bool _isUploadingAvatar = false;

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

  // ── Quick image update (camera icon overlays on banner/avatar) ────────

  Future<void> _quickUpdateImage({required bool isBanner}) async {
    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.photo_library),
              title: const Text('Gallery'),
              onTap: () => Navigator.pop(ctx, ImageSource.gallery),
            ),
            ListTile(
              leading: const Icon(Icons.photo_camera),
              title: const Text('Camera'),
              onTap: () => Navigator.pop(ctx, ImageSource.camera),
            ),
          ],
        ),
      ),
    );
    if (source == null) return;

    final picked = await _imagePicker.pickImage(
      source: source,
      maxWidth: isBanner ? 2048 : 1024,
      maxHeight: isBanner ? 2048 : 1024,
      imageQuality: 85,
    );
    if (picked == null) return;

    setState(() {
      if (isBanner) {
        _isUploadingBanner = true;
      } else {
        _isUploadingAvatar = true;
      }
    });

    try {
      final url = await ref.read(uploadProvider.notifier).uploadImage(picked);

      // Update profile with new image URL
      final auth = ref.read(authStateProvider);
      final current = auth.profile;
      final updated = (current ?? const NostrProfile()).copyWith(
        banner: isBanner ? url : current?.banner,
        picture: !isBanner ? url : current?.picture,
      );
      await ref.read(authStateProvider.notifier).updateProfile(updated);

      // Invalidate the profile provider so the UI refreshes
      if (auth.pubkey != null) {
        ref.invalidate(profileProvider(auth.pubkey!));
      }

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
                '${isBanner ? 'Banner' : 'Profile picture'} updated'),
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Upload failed: $e'),
            backgroundColor: Theme.of(context).colorScheme.error,
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          if (isBanner) {
            _isUploadingBanner = false;
          } else {
            _isUploadingAvatar = false;
          }
        });
      }
    }
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
            child: Padding(
              padding: const EdgeInsets.all(32),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Container(
                    padding: const EdgeInsets.all(20),
                    decoration: BoxDecoration(
                      color: Theme.of(context).colorScheme.errorContainer.withValues(alpha: 0.3),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(
                      Icons.error_outline_rounded,
                      size: 48,
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                  const SizedBox(height: 24),
                  Text(
                    'Failed to load profile',
                    style: Theme.of(context).textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    error.toString(),
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: Theme.of(context).colorScheme.onSurfaceVariant,
                        ),
                  ),
                  const SizedBox(height: 24),
                  FilledButton.icon(
                    onPressed: () => ref.invalidate(profileProvider(targetPubkey)),
                    icon: const Icon(Icons.refresh_rounded),
                    label: const Text('Try Again'),
                  ),
                ],
              ),
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
          // Banner with app bar
          SliverAppBar(
            expandedHeight: 200,
            pinned: true,
            stretch: true,
            backgroundColor: scheme.surface,
            leading: Container(
              margin: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: Colors.black.withValues(alpha: 0.4),
                shape: BoxShape.circle,
              ),
              child: IconButton(
                icon: const Icon(Icons.arrow_back_rounded, color: Colors.white),
                onPressed: () {
                  HapticFeedback.lightImpact();
                  // If we can pop, go back. Otherwise go to feed
                  // (handles bottom nav Profile tab case)
                  if (Navigator.of(context).canPop()) {
                    Navigator.pop(context);
                  } else {
                    context.go('/feed');
                  }
                },
              ),
            ),
            actions: [
              if (isOwnProfile)
                Container(
                  margin: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: Colors.black.withValues(alpha: 0.4),
                    shape: BoxShape.circle,
                  ),
                  child: IconButton(
                    icon: const Icon(Icons.edit_outlined, color: Colors.white),
                    tooltip: 'Edit Profile',
                    onPressed: () {
                      HapticFeedback.lightImpact();
                      EditProfileScreen.show(context);
                    },
                  ),
                )
              else
                Container(
                  margin: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: Colors.black.withValues(alpha: 0.4),
                    shape: BoxShape.circle,
                  ),
                  child: IconButton(
                    icon: const Icon(Icons.more_vert_rounded,
                        color: Colors.white),
                    onPressed: () {
                      HapticFeedback.lightImpact();
                    },
                  ),
                ),
            ],
            flexibleSpace: FlexibleSpaceBar(
              stretchModes: const [
                StretchMode.zoomBackground,
                StretchMode.blurBackground,
              ],
              background: Stack(
                fit: StackFit.expand,
                children: [
                  // Banner image
                  if (profile?.banner != null &&
                      profile!.banner!.isNotEmpty)
                    CachedNetworkImage(
                      imageUrl: profile.banner!,
                      fit: BoxFit.cover,
                      placeholder: (context, url) => Container(
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            begin: Alignment.topLeft,
                            end: Alignment.bottomRight,
                            colors: [scheme.primary, scheme.tertiary],
                          ),
                        ),
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

                  // Subtle gradient at bottom for readability
                  Container(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                        colors: [
                          Colors.transparent,
                          Colors.black.withValues(alpha: 0.4),
                        ],
                        stops: const [0.5, 1.0],
                      ),
                    ),
                  ),

                  // Camera overlay for own profile — tap to change banner
                  if (isOwnProfile)
                    Positioned(
                      right: 16,
                      bottom: 12,
                      child: Material(
                        color: Colors.black.withValues(alpha: 0.5),
                        shape: const CircleBorder(),
                        clipBehavior: Clip.antiAlias,
                        child: InkWell(
                          onTap: _isUploadingBanner
                              ? null
                              : () => _quickUpdateImage(isBanner: true),
                          child: Padding(
                            padding: const EdgeInsets.all(10),
                            child: _isUploadingBanner
                                ? const SizedBox(
                                    width: 20,
                                    height: 20,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                      valueColor:
                                          AlwaysStoppedAnimation<Color>(
                                              Colors.white),
                                    ),
                                  )
                                : const Icon(
                                    Icons.photo_camera,
                                    color: Colors.white,
                                    size: 20,
                                  ),
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),

          // Profile info section
          SliverToBoxAdapter(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Avatar + Action buttons row
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      // Avatar with camera overlay on own profile
                      Transform.translate(
                        offset: const Offset(0, -44),
                        child: Stack(
                          children: [
                            Hero(
                              tag: 'profile-avatar-$pubkey',
                              child: Container(
                                decoration: BoxDecoration(
                                  shape: BoxShape.circle,
                                  border: Border.all(
                                    color: scheme.surface,
                                    width: 5,
                                  ),
                                  boxShadow: [
                                    BoxShadow(
                                      color: scheme.shadow
                                          .withValues(alpha: 0.2),
                                      blurRadius: 20,
                                      offset: const Offset(0, 8),
                                    ),
                                  ],
                                ),
                                child: ProfileAvatar(
                                  profile: profile,
                                  pubkey: pubkey,
                                  radius: 44,
                                  showRing: true,
                                ),
                              ),
                            ),
                            // Camera badge on own profile
                            if (isOwnProfile)
                              Positioned(
                                right: 0,
                                bottom: 0,
                                child: Material(
                                  color: scheme.primary,
                                  shape: const CircleBorder(),
                                  elevation: 4,
                                  child: InkWell(
                                    onTap: _isUploadingAvatar
                                        ? null
                                        : () => _quickUpdateImage(
                                            isBanner: false),
                                    customBorder: const CircleBorder(),
                                    child: Padding(
                                      padding: const EdgeInsets.all(8),
                                      child: _isUploadingAvatar
                                          ? const SizedBox(
                                              width: 16,
                                              height: 16,
                                              child:
                                                  CircularProgressIndicator(
                                                strokeWidth: 2,
                                                valueColor:
                                                    AlwaysStoppedAnimation<
                                                        Color>(Colors.white),
                                              ),
                                            )
                                          : const Icon(
                                              Icons.photo_camera,
                                              color: Colors.white,
                                              size: 16,
                                            ),
                                    ),
                                  ),
                                ),
                              ),
                          ],
                        ),
                      ),

                      // Action buttons
                      Transform.translate(
                        offset: const Offset(0, -12),
                        child: isOwnProfile
                            ? FilledButton.tonalIcon(
                                onPressed: () {
                                  HapticFeedback.mediumImpact();
                                  EditProfileScreen.show(context);
                                },
                                icon: const Icon(Icons.edit_outlined,
                                    size: 18),
                                label: const Text('Edit Profile'),
                                style: FilledButton.styleFrom(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 20,
                                    vertical: 12,
                                  ),
                                ),
                              )
                            : FilledButton.icon(
                                onPressed: auth.isLoggedIn &&
                                        !auth.isReadOnly
                                    ? () {
                                        HapticFeedback.mediumImpact();
                                        _toggleFollow(pubkey, isFollowing);
                                      }
                                    : null,
                                icon: Icon(
                                  isFollowing
                                      ? Icons.person_remove_outlined
                                      : Icons.person_add_outlined,
                                  size: 18,
                                ),
                                label: Text(
                                    isFollowing ? 'Unfollow' : 'Follow'),
                                style: FilledButton.styleFrom(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 20,
                                    vertical: 12,
                                  ),
                                ),
                              ),
                      ),
                    ],
                  ),
                ),

                // Profile details
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Name with verified badge
                      Row(
                        children: [
                          Flexible(
                            child: Text(
                              profile?.displayNameOrName ?? 'Anonymous',
                              style:
                                  theme.textTheme.headlineMedium?.copyWith(
                                fontWeight: FontWeight.bold,
                                letterSpacing: -0.5,
                              ),
                            ),
                          ),
                          if (profile?.nip05 != null &&
                              profile!.nip05!.isNotEmpty) ...[
                            const SizedBox(width: 6),
                            Container(
                              padding: const EdgeInsets.all(4),
                              decoration: BoxDecoration(
                                color: scheme.primaryContainer,
                                shape: BoxShape.circle,
                              ),
                              child: Icon(
                                Icons.verified_rounded,
                                size: 18,
                                color: scheme.primary,
                              ),
                            ),
                          ],
                        ],
                      ),

                      // NIP-05 identifier
                      if (profile?.nip05 != null &&
                          profile!.nip05!.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(top: 4),
                          child: Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 10,
                              vertical: 4,
                            ),
                            decoration: BoxDecoration(
                              color: scheme.primaryContainer
                                  .withValues(alpha: 0.5),
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: Text(
                              profile.nip05!,
                              style: theme.textTheme.bodySmall?.copyWith(
                                color: scheme.primary,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                        ),

                      // Bio
                      if (profile?.about != null &&
                          profile!.about!.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(top: 12),
                          child: Text(
                            profile.about!,
                            style: theme.textTheme.bodyLarge?.copyWith(
                              height: 1.5,
                              color: scheme.onSurface.withValues(alpha: 0.9),
                            ),
                          ),
                        ),

                      const SizedBox(height: 20),

                      // Stats row
                      _EnhancedStatsRow(
                        pubkey: pubkey,
                        postsCount: feedAsync.value
                                ?.where((e) =>
                                    e.pubkey == pubkey && e.kind == 1)
                                .length ??
                            0,
                        followingCount: followsAsync.value?.length ?? 0,
                      ),

                      const SizedBox(height: 16),
                    ],
                  ),
                ),
              ],
            ),
          ),

          // Tab bar
          SliverPersistentHeader(
            pinned: true,
            delegate: _TabBarDelegate(
              tabBar: TabBar(
                controller: _tabController,
                labelColor: scheme.primary,
                unselectedLabelColor: scheme.onSurfaceVariant,
                indicatorColor: scheme.primary,
                indicatorWeight: 3,
                labelStyle: const TextStyle(
                  fontWeight: FontWeight.w600,
                  fontSize: 14,
                ),
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
          _PostsTab(
              pubkey: pubkey, filter: (e) => e.kind == 1 && _hasMedia(e)),
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
        content.contains('.svg') ||
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
            content: Row(
              children: [
                Icon(
                  isFollowing ? Icons.person_remove_rounded : Icons.person_add_rounded,
                  color: Colors.white,
                  size: 20,
                ),
                const SizedBox(width: 12),
                Text(isFollowing ? 'Unfollowed' : 'Followed'),
              ],
            ),
            behavior: SnackBarBehavior.floating,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
            ),
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
            behavior: SnackBarBehavior.floating,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
            ),
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
      body: Shimmer.fromColors(
        baseColor: baseColor,
        highlightColor: highlightColor,
        child: CustomScrollView(
          slivers: [
            // Banner skeleton
            SliverAppBar(
              expandedHeight: 240,
              pinned: true,
              flexibleSpace: Container(color: baseColor),
            ),
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Transform.translate(
                          offset: const Offset(0, -40),
                          child: CircleAvatar(radius: 44, backgroundColor: baseColor),
                        ),
                        Container(
                          width: 120,
                          height: 40,
                          decoration: BoxDecoration(
                            color: baseColor,
                            borderRadius: BorderRadius.circular(20),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    Container(
                      width: 180,
                      height: 28,
                      decoration: BoxDecoration(
                        color: baseColor,
                        borderRadius: BorderRadius.circular(6),
                      ),
                    ),
                    const SizedBox(height: 12),
                    Container(
                      width: 140,
                      height: 16,
                      decoration: BoxDecoration(
                        color: baseColor,
                        borderRadius: BorderRadius.circular(4),
                      ),
                    ),
                    const SizedBox(height: 16),
                    Container(
                      width: double.infinity,
                      height: 16,
                      decoration: BoxDecoration(
                        color: baseColor,
                        borderRadius: BorderRadius.circular(4),
                      ),
                    ),
                    const SizedBox(height: 8),
                    Container(
                      width: MediaQuery.of(context).size.width * 0.7,
                      height: 16,
                      decoration: BoxDecoration(
                        color: baseColor,
                        borderRadius: BorderRadius.circular(4),
                      ),
                    ),
                    const SizedBox(height: 24),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceAround,
                      children: List.generate(
                        3,
                        (_) => Container(
                          width: 80,
                          height: 50,
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
            ),
          ],
        ),
      ),
    );
  }
}

// ─── Enhanced Stats Row ─────────────────────────────────────────────

class _EnhancedStatsRow extends StatelessWidget {
  final String pubkey;
  final int postsCount;
  final int followingCount;

  const _EnhancedStatsRow({
    required this.pubkey,
    required this.postsCount,
    required this.followingCount,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: scheme.outlineVariant.withValues(alpha: 0.3),
          width: 1,
        ),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceAround,
        children: [
          _StatItem(count: postsCount, label: 'Posts', icon: Icons.article_rounded),
          Container(
            width: 1,
            height: 40,
            color: scheme.outlineVariant.withValues(alpha: 0.3),
          ),
          _StatItem(count: followingCount, label: 'Following', icon: Icons.person_add_rounded),
          Container(
            width: 1,
            height: 40,
            color: scheme.outlineVariant.withValues(alpha: 0.3),
          ),
          _StatItem(count: 0, label: 'Followers', icon: Icons.people_rounded),
        ],
      ),
    );
  }
}

class _StatItem extends StatelessWidget {
  final int count;
  final String label;
  final IconData icon;

  const _StatItem({
    required this.count,
    required this.label,
    required this.icon,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Column(
      children: [
        Icon(icon, size: 20, color: scheme.primary),
        const SizedBox(height: 8),
        Text(
          count.toString(),
          style: theme.textTheme.titleLarge?.copyWith(
            fontWeight: FontWeight.bold,
            color: scheme.onSurface,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          label,
          style: theme.textTheme.bodySmall?.copyWith(
            color: scheme.onSurfaceVariant,
            fontWeight: FontWeight.w500,
          ),
        ),
      ],
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
    return Container(
      color: color,
      child: tabBar,
    );
  }

  @override
  bool shouldRebuild(_TabBarDelegate oldDelegate) =>
      tabBar != oldDelegate.tabBar || color != oldDelegate.color;
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
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    padding: const EdgeInsets.all(20),
                    decoration: BoxDecoration(
                      color: Theme.of(context).colorScheme.primaryContainer.withValues(alpha: 0.3),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(
                      Icons.article_outlined,
                      size: 48,
                      color: Theme.of(context).colorScheme.primary,
                    ),
                  ),
                  const SizedBox(height: 24),
                  Text(
                    'No posts yet',
                    style: Theme.of(context).textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Posts will appear here',
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: Theme.of(context).colorScheme.onSurfaceVariant,
                        ),
                  ),
                ],
              ),
            ),
          );
        }

        return ListView.builder(
          padding: const EdgeInsets.only(top: 8, bottom: 180),
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
