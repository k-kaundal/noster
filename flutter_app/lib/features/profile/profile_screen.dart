import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:shimmer/shimmer.dart';

import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/core/widgets/report_dialog.dart';
import 'package:nostrfeed_mobile/features/compose/providers/upload_providers.dart';
import 'package:nostrfeed_mobile/core/widgets/empty_state.dart';
import 'package:nostrfeed_mobile/core/widgets/error_view.dart';
import 'package:nostrfeed_mobile/features/communities/community_detail_screen.dart';
import 'package:nostrfeed_mobile/features/profile/providers/profile_providers.dart';
import 'package:nostrfeed_mobile/features/profile/user_list_screen.dart';
import 'package:nostrfeed_mobile/features/feed/widgets/post_card.dart';
import 'package:nostrfeed_mobile/core/widgets/profile_avatar.dart';
import 'package:nostrfeed_mobile/features/premium/widgets/paid_badge.dart';
import 'package:nostrfeed_mobile/features/zap/zap_sheet.dart';
import 'package:nostrfeed_mobile/features/profile/edit_profile_screen.dart';

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
    _tabController = TabController(length: 6, vsync: this);
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
          body: ErrorView(
            message: 'Failed to load profile',
            onRetry: () => ref.invalidate(profileProvider(targetPubkey)),
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
    final followersAsync = ref.watch(followersProvider(pubkey));
    final userPostsAsync = ref.watch(userPostsProvider(pubkey));
    final auth = ref.watch(authStateProvider);

    final isFollowing = followsAsync.value?.contains(pubkey) ?? false;
    final followersCount = followersAsync.valueOrNull ?? 0;
    final postsCount = userPostsAsync.valueOrNull
            ?.where((e) => e.kind == 1)
            .length ??
        0;

    return NestedScrollView(
      headerSliverBuilder: (context, innerBoxIsScrolled) {
        return [
          // ── Banner with avatar inside the stack ────────────────
          SliverAppBar(
            // Banner is 200 tall; avatar extends 40 below that, so we add
            // space for the overlap inside the AppBar itself. The avatar
            // renders as part of the banner stack so it isn't clipped.
            expandedHeight: 200 + 44,
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
                  child: PopupMenuButton<String>(
                    icon: const Icon(Icons.more_vert_rounded,
                        color: Colors.white),
                    tooltip: 'Profile options',
                    onSelected: (value) {
                      if (value == 'report') {
                        showReportDialog(context, pubkey: widget.pubkey);
                      } else if (value == 'copy_npub') {
                        final npub = ref
                            .read(nostrServiceProvider)
                            .authService
                            .encodeNpub(widget.pubkey!);
                        Clipboard.setData(ClipboardData(text: npub));
                        AppToast.success(context, 'Public key copied');
                      }
                    },
                    itemBuilder: (context) => [
                      PopupMenuItem(
                        value: 'report',
                        child: Row(
                          children: [
                            Icon(
                              Icons.flag_outlined,
                              size: 18,
                              color: Theme.of(context).colorScheme.error,
                            ),
                            const SizedBox(width: 10),
                            Text(
                              'Report profile',
                              style: TextStyle(
                                color: Theme.of(context).colorScheme.error,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const PopupMenuItem(
                        value: 'copy_npub',
                        child: Row(
                          children: [
                            Icon(Icons.key_rounded, size: 18),
                            SizedBox(width: 10),
                            Text('Copy public key'),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
            ],
            flexibleSpace: FlexibleSpaceBar(
              stretchModes: const [
                StretchMode.zoomBackground,
                StretchMode.blurBackground,
              ],
              background: Stack(
                clipBehavior: Clip.none,
                children: [
                  // Banner image — top 200 only
                  Positioned(
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 200,
                    child: profile?.banner != null && profile!.banner!.isNotEmpty
                        ? CachedNetworkImage(
                            imageUrl: profile.banner!,
                            fit: BoxFit.cover,
                            placeholder: (_, _) => Container(color: scheme.surfaceContainerHighest),
                            errorWidget: (_, _, _) => Container(color: scheme.surfaceContainerHighest),
                          )
                        : Container(
                            decoration: BoxDecoration(
                              gradient: LinearGradient(
                                begin: Alignment.topLeft,
                                end: Alignment.bottomRight,
                                colors: [scheme.primary, scheme.tertiary],
                              ),
                            ),
                          ),
                  ),

                  // Surface-colored fill below the banner so the avatar's
                  // border has something to contrast against
                  Positioned(
                    top: 200,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    child: Container(color: scheme.surface),
                  ),

                  // Camera overlay for banner on own profile
                  if (isOwnProfile)
                    Positioned(
                      right: 12,
                      top: 164, // 200 - 12 - 24 (button height)
                      child: Material(
                        color: Colors.black.withValues(alpha: 0.5),
                        shape: const CircleBorder(),
                        clipBehavior: Clip.antiAlias,
                        child: InkWell(
                          onTap: _isUploadingBanner
                              ? null
                              : () => _quickUpdateImage(isBanner: true),
                          child: Padding(
                            padding: const EdgeInsets.all(8),
                            child: _isUploadingBanner
                                ? const SizedBox(
                                    width: 18,
                                    height: 18,
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
                                    size: 18,
                                  ),
                          ),
                        ),
                      ),
                    ),

                  // Avatar — bottom of banner, overlapping 40px below.
                  // Rendered inside the banner's Stack so it doesn't get
                  // clipped by sliver boundaries.
                  Positioned(
                    left: 16,
                    top: 200 - 40, // avatar center sits on banner bottom edge
                    child: Stack(
                      children: [
                        Container(
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
                            radius: 36,
                          ),
                        ),
                        if (isOwnProfile)
                          Positioned(
                            right: 0,
                            bottom: 0,
                            child: Material(
                              color: scheme.primary,
                              shape: const CircleBorder(),
                              elevation: 2,
                              child: InkWell(
                                onTap: _isUploadingAvatar
                                    ? null
                                    : () => _quickUpdateImage(
                                        isBanner: false),
                                customBorder: const CircleBorder(),
                                child: Padding(
                                  padding: const EdgeInsets.all(6),
                                  child: _isUploadingAvatar
                                      ? const SizedBox(
                                          width: 14,
                                          height: 14,
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
                                          size: 14,
                                        ),
                                ),
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),

                  // Action buttons — sits to the right, vertically centered
                  // in the overlap zone like X
                  Positioned(
                    right: 16,
                    top: 200 + 8,
                    child: isOwnProfile
                        ? OutlinedButton(
                            onPressed: () {
                              HapticFeedback.lightImpact();
                              EditProfileScreen.show(context);
                            },
                            style: OutlinedButton.styleFrom(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 16,
                                vertical: 8,
                              ),
                              side: BorderSide(color: scheme.outline),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(20),
                              ),
                            ),
                            child: const Text('Edit profile',
                                style: TextStyle(fontSize: 13)),
                          )
                        : Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              // Zap button
                              if (profile?.lud16 != null &&
                                  profile!.lud16!.isNotEmpty)
                                IconButton(
                                  onPressed: auth.isLoggedIn
                                      ? () {
                                          HapticFeedback.lightImpact();
                                          showZapDialog(
                                            context: context,
                                            targetEvent: NostrEvent(
                                              id: '',
                                              pubkey: pubkey,
                                              createdAt: DateTime.now()
                                                      .millisecondsSinceEpoch ~/
                                                  1000,
                                              kind: 0,
                                              tags: [],
                                              content: '',
                                              sig: '',
                                            ),
                                            targetPubkey: pubkey,
                                            eventKind: 0,
                                          );
                                        }
                                      : null,
                                  style: IconButton.styleFrom(
                                    backgroundColor:
                                        Colors.amber.withValues(alpha: 0.15),
                                    shape: RoundedRectangleBorder(
                                      borderRadius: BorderRadius.circular(20),
                                    ),
                                  ),
                                  icon: Icon(Icons.bolt_rounded,
                                      color: Colors.amber.shade700, size: 20),
                                ),
                              if (profile?.lud16 != null &&
                                  profile!.lud16!.isNotEmpty)
                                const SizedBox(width: 8),

                              // Message button
                              if (auth.isLoggedIn && !auth.isReadOnly)
                                IconButton(
                                  onPressed: () {
                                    HapticFeedback.lightImpact();
                                    context.push('/chat/$pubkey');
                                  },
                                  style: IconButton.styleFrom(
                                    backgroundColor:
                                        scheme.primary.withValues(alpha: 0.1),
                                    shape: RoundedRectangleBorder(
                                      borderRadius: BorderRadius.circular(20),
                                    ),
                                  ),
                                  icon: Icon(Icons.chat_bubble_outline_rounded,
                                      color: scheme.primary, size: 20),
                                ),
                              if (auth.isLoggedIn && !auth.isReadOnly)
                                const SizedBox(width: 8),

                              // Follow button
                              FilledButton(
                                onPressed: auth.isLoggedIn && !auth.isReadOnly
                                    ? () {
                                        HapticFeedback.mediumImpact();
                                        _toggleFollow(pubkey, isFollowing);
                                      }
                                    : null,
                                style: FilledButton.styleFrom(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 16,
                                    vertical: 8,
                                  ),
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(20),
                                  ),
                                ),
                                child: Text(
                                  isFollowing ? 'Following' : 'Follow',
                                  style: const TextStyle(fontSize: 13),
                                ),
                              ),
                            ],
                          ),
                  ),
                ],
              ),
            ),
          ),

          // ── Profile info ──────────────────────────────────────
          SliverToBoxAdapter(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [

                // Name, handle, bio, stats — X layout
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Name + verified badge
                      Row(
                        children: [
                          Flexible(
                            child: Text(
                              profile?.displayNameOrName ?? 'Anonymous',
                              style: theme.textTheme.titleLarge?.copyWith(
                                fontWeight: FontWeight.bold,
                                letterSpacing: -0.3,
                              ),
                            ),
                          ),
                          if (profile?.nip05 != null &&
                              profile!.nip05!.isNotEmpty) ...[
                            const SizedBox(width: 4),
                            Icon(
                              Icons.verified_rounded,
                              size: 18,
                              color: scheme.primary,
                            ),
                          ],
                          // Paid relay member mark (web RelayMark) — only
                          // renders when the relay confirms admission.
                          PaidRelayMark(pubkey: pubkey, size: 18),
                        ],
                      ),

                      // Handle
                      if (profile?.nip05 != null && profile!.nip05!.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(top: 2),
                          child: Text(
                            profile.nip05!,
                            style: theme.textTheme.bodyMedium?.copyWith(
                              color: scheme.onSurfaceVariant,
                            ),
                          ),
                        ),

                      // Paid member chip (renders nothing unless the relay
                      // confirms this key paid admission).
                      Padding(
                        padding: const EdgeInsets.only(top: 6),
                        child: PaidRelayBadge(pubkey: pubkey),
                      ),

                      // Bio
                      if (profile?.about != null && profile!.about!.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(top: 8),
                          child: Text(
                            profile.about!,
                            style: theme.textTheme.bodyMedium?.copyWith(
                              height: 1.4,
                            ),
                          ),
                        ),

                      const SizedBox(height: 12),

                      // ── Metadata details — X style icon + text rows ──
                      _ProfileMetadata(profile: profile, pubkey: pubkey),

                      const SizedBox(height: 12),

                      // Stats — X style: bold count + label, horizontal.
                      // Following/Followers are TAPPABLE → user list screens.
                      Row(
                        children: [
                          _XStat(
                            count: postsCount,
                            label: 'Posts',
                          ),
                          const SizedBox(width: 16),
                          GestureDetector(
                            onTap: () => _openUserList(
                              context,
                              ref,
                              title: 'Following',
                              provider: followingListProvider(pubkey),
                            ),
                            child: _XStat(
                              count: followsAsync.value?.length ?? 0,
                              label: 'Following',
                            ),
                          ),
                          const SizedBox(width: 16),
                          GestureDetector(
                            onTap: () => _openUserList(
                              context,
                              ref,
                              title: 'Followers',
                              provider: followersListProvider(pubkey),
                            ),
                            child: _XStat(
                              count: followersCount,
                              label: 'Followers',
                            ),
                          ),
                        ],
                      ),

                      const SizedBox(height: 12),
                    ],
                  ),
                ),
              ],
            ),
          ),

          // ── Tab bar ───────────────────────────────────────────
          SliverPersistentHeader(
            pinned: true,
            delegate: _TabBarDelegate(
              tabBar: TabBar(
                controller: _tabController,
                labelColor: scheme.primary,
                unselectedLabelColor: scheme.onSurfaceVariant,
                indicatorColor: scheme.primary,
                indicatorWeight: 3,
                indicatorSize: TabBarIndicatorSize.tab,
                labelStyle: const TextStyle(
                  fontWeight: FontWeight.w600,
                  fontSize: 13,
                ),
                unselectedLabelStyle: const TextStyle(
                  fontWeight: FontWeight.w500,
                  fontSize: 13,
                ),
                tabs: const [
                  Tab(text: 'Posts'),
                  Tab(text: 'Replies'),
                  Tab(text: 'Articles'),
                  Tab(text: 'Media'),
                  Tab(text: 'Likes'),
                  Tab(text: 'Communities'),
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
          // NIP-23 long-form articles are kind 30023
          _PostsTab(pubkey: pubkey, filter: (e) => e.kind == 30023),
          _PostsTab(
              pubkey: pubkey, filter: (e) => e.kind == 1 && _hasMedia(e)),
          // Likes = posts the USER liked (their kind-7 targets), not kind-7
          // in their own feed (which is always empty).
          _LikedPostsTab(pubkey: pubkey),
          _CommunitiesTab(pubkey: pubkey),
        ],
      ),
    );
  }

  /// Open a user-list screen (followers / following) with a resolved list.
  void _openUserList(
    BuildContext context,
    WidgetRef ref, {
    required String title,
    required AutoDisposeFutureProvider<List<String>> provider,
  }) async {
    // Resolve the pubkeys, then push the list screen with the data.
    final pubkeys = await ref.read(provider.future);
    if (!context.mounted) return;
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => UserListScreen(title: title, pubkeys: pubkeys),
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

      // The service's followsCache was already updated inside updateFollows
      // with the new list, so this invalidate refetches and returns the fresh
      // data immediately (rather than racing relay propagation, which is what
      // made the button flip back to "Follow").
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
    final scheme = Theme.of(context).colorScheme;
    final baseColor = scheme.surfaceContainerHighest;
    final highlightColor = scheme.surface;

    return Scaffold(
      body: Shimmer.fromColors(
        baseColor: baseColor,
        highlightColor: highlightColor,
        child: CustomScrollView(
          slivers: [
            // Banner skeleton — X height with avatar overlap
            SliverAppBar(
              expandedHeight: 200 + 44,
              pinned: true,
              flexibleSpace: Stack(
                children: [
                  Positioned(
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 200,
                    child: Container(color: baseColor),
                  ),
                  Positioned(
                    top: 200,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    child: Container(color: scheme.surface),
                  ),
                  Positioned(
                    left: 16,
                    top: 200 - 40,
                    child: CircleAvatar(radius: 36, backgroundColor: baseColor),
                  ),
                  Positioned(
                    right: 16,
                    top: 200 + 8,
                    child: Container(
                      width: 100,
                      height: 32,
                      decoration: BoxDecoration(
                        color: baseColor,
                        borderRadius: BorderRadius.circular(20),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Name
                    Container(
                      width: 160,
                      height: 22,
                      decoration: BoxDecoration(
                        color: baseColor,
                        borderRadius: BorderRadius.circular(4),
                      ),
                    ),
                    const SizedBox(height: 6),
                    // Handle
                    Container(
                      width: 120,
                      height: 14,
                      decoration: BoxDecoration(
                        color: baseColor,
                        borderRadius: BorderRadius.circular(4),
                      ),
                    ),
                    const SizedBox(height: 10),
                    // Bio lines
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
                      width: MediaQuery.of(context).size.width * 0.6,
                      height: 14,
                      decoration: BoxDecoration(
                        color: baseColor,
                        borderRadius: BorderRadius.circular(4),
                      ),
                    ),
                    const SizedBox(height: 10),
                    // Metadata rows (NIP-05, lightning, etc.)
                    Container(
                      width: 200,
                      height: 14,
                      decoration: BoxDecoration(
                        color: baseColor,
                        borderRadius: BorderRadius.circular(4),
                      ),
                    ),
                    const SizedBox(height: 6),
                    Container(
                      width: 180,
                      height: 14,
                      decoration: BoxDecoration(
                        color: baseColor,
                        borderRadius: BorderRadius.circular(4),
                      ),
                    ),
                    const SizedBox(height: 14),
                    // Stats
                    Row(
                      children: List.generate(
                        3,
                        (i) => Padding(
                          padding: EdgeInsets.only(right: i < 2 ? 16 : 0),
                          child: Container(
                            width: 70,
                            height: 14,
                            decoration: BoxDecoration(
                              color: baseColor,
                              borderRadius: BorderRadius.circular(4),
                            ),
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 14),
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

// ─── Profile metadata details ───────────────────────────────────────

/// NIP-05, lightning address, website, join date — X style icon + text rows.
class _ProfileMetadata extends StatelessWidget {
  final NostrProfile? profile;
  final String pubkey;

  const _ProfileMetadata({required this.profile, required this.pubkey});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final items = <Widget>[];

    // NIP-05 verified identifier
    if (profile?.nip05 != null && profile!.nip05!.isNotEmpty) {
      items.add(_MetadataRow(
        icon: Icons.verified_outlined,
        text: profile!.nip05!,
        color: scheme.primary,
      ));
    }

    // Lightning address
    if (profile?.lud16 != null && profile!.lud16!.isNotEmpty) {
      items.add(_MetadataRow(
        icon: Icons.bolt_outlined,
        text: profile!.lud16!,
        color: Colors.amber.shade700,
      ));
    }

    // Website
    if (profile?.website != null && profile!.website!.isNotEmpty) {
      items.add(_MetadataRow(
        icon: Icons.link_outlined,
        text: profile!.website!,
        color: scheme.primary,
      ));
    }

    // Public key (shortened)
    final npub = pubkey.length > 16
        ? '${pubkey.substring(0, 8)}…${pubkey.substring(pubkey.length - 4)}'
        : pubkey;
    items.add(_MetadataRow(
      icon: Icons.key_outlined,
      text: npub,
      color: scheme.onSurfaceVariant,
    ));

    // Join date (from earliest event or profile creation)
    // We don't have a reliable join date from Nostr, so show first seen
    // This would ideally come from the user's kind 0 event timestamp
    // For now, show nothing if we don't have a date

    if (items.isEmpty) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: items
          .expand((w) => [w, const SizedBox(height: 6)])
          .toList()
          ..removeLast(),
    );
  }
}

class _MetadataRow extends StatelessWidget {
  final IconData icon;
  final String text;
  final Color color;

  const _MetadataRow({
    required this.icon,
    required this.text,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Row(
      children: [
        Icon(icon, size: 16, color: color),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            text,
            style: theme.textTheme.bodyMedium?.copyWith(
              color: scheme.onSurfaceVariant,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }
}

// ─── X-style stat ───────────────────────────────────────────────────

/// Bold number + muted label, inline. X shows "1,234 Posts" not a card.
class _XStat extends StatelessWidget {
  final int count;
  final String label;

  const _XStat({required this.count, required this.label});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          _formatCount(count),
          style: theme.textTheme.bodyMedium?.copyWith(
            fontWeight: FontWeight.bold,
          ),
        ),
        const SizedBox(width: 4),
        Text(
          label,
          style: theme.textTheme.bodyMedium?.copyWith(
            color: scheme.onSurfaceVariant,
          ),
        ),
      ],
    );
  }

  String _formatCount(int n) {
    if (n >= 1000000) return '${(n / 1000000).toStringAsFixed(1)}M';
    if (n >= 1000) return '${(n / 1000).toStringAsFixed(1)}K';
    return '$n';
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

/// Communities tab: communities the user JOINED + communities they CREATED.
class _CommunitiesTab extends ConsumerWidget {
  final String pubkey;
  const _CommunitiesTab({required this.pubkey});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final joinedAsync = ref.watch(joinedCommunitiesProvider(pubkey));
    final createdAsync = ref.watch(myCommunitiesProvider(pubkey));

    return ListView(
      padding: const EdgeInsets.all(12),
      children: [
        if (createdAsync.valueOrNull?.isNotEmpty == true) ...[
          _SectionHeader(title: 'Created'),
          for (final c in createdAsync.value!) _CommunityTile(event: c),
          const SizedBox(height: 16),
        ],
        _SectionHeader(title: 'Joined'),
        joinedAsync.when(
          loading: () => const Padding(
            padding: EdgeInsets.all(24),
            child: Center(child: CircularProgressIndicator()),
          ),
          error: (_, _) => const Text('Failed to load'),
          data: (communities) => communities.isEmpty
              ? const Padding(
                  padding: EdgeInsets.all(24),
                  child: Center(
                    child: Text('No communities joined yet'),
                  ),
                )
              : Column(
                  children: [
                    for (final c in communities) _CommunityTile(event: c),
                  ],
                ),
        ),
      ],
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final String title;
  const _SectionHeader({required this.title});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 0, 4, 8),
      child: Text(
        title.toUpperCase(),
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w700,
          letterSpacing: 1.4,
          color: Theme.of(context).colorScheme.primary,
        ),
      ),
    );
  }
}

class _CommunityTile extends StatelessWidget {
  final NostrEvent event;
  const _CommunityTile({required this.event});

  @override
  Widget build(BuildContext context) {
    final name = event.getTag('name') ?? 'Unnamed';
    final desc = event.getTag('description') ?? '';
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: Theme.of(context).colorScheme.primaryContainer,
          child: Icon(
            Icons.groups_rounded,
            color: Theme.of(context).colorScheme.onPrimaryContainer,
          ),
        ),
        title: Text(name, maxLines: 1, overflow: TextOverflow.ellipsis),
        subtitle: desc.isNotEmpty
            ? Text(desc, maxLines: 1, overflow: TextOverflow.ellipsis)
            : null,
        trailing: const Icon(Icons.chevron_right_rounded),
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => CommunityDetailScreen(community: event),
          ),
        ),
      ),
    );
  }
}

/// Likes tab: posts the USER liked (their kind-7 reaction targets).
class _LikedPostsTab extends ConsumerWidget {
  final String pubkey;
  const _LikedPostsTab({required this.pubkey});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final likedAsync = ref.watch(userLikedPostsProvider(pubkey));

    return likedAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (_, _) => const Center(child: Text('Failed to load likes')),
      data: (posts) {
        if (posts.isEmpty) {
          return const EmptyState(
            icon: Icons.favorite_outline_rounded,
            title: 'No likes yet',
            subtitle: 'Posts you like will appear here',
          );
        }
        return ListView.builder(
          padding: const EdgeInsets.only(top: 8, bottom: 180),
          itemCount: posts.length,
          itemBuilder: (context, index) =>
              _PostListItem(event: posts[index]),
        );
      },
    );
  }
}

class _PostsTab extends ConsumerWidget {
  final String pubkey;
  final bool Function(NostrEvent) filter;

  const _PostsTab({required this.pubkey, required this.filter});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final postsAsync = ref.watch(userPostsProvider(pubkey));

    return postsAsync.when(
      data: (events) {
        final userPosts = events.where(filter).toList()
          ..sort((a, b) => b.createdAt.compareTo(a.createdAt));

        if (userPosts.isEmpty) {
          return const EmptyState(
            icon: Icons.article_outlined,
            title: 'No posts yet',
            subtitle: 'Posts will appear here',
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
