import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/moderation/moderation_providers.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/theme/app_theme.dart';
import 'package:nostrfeed_mobile/core/utils/media.dart';
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/core/widgets/error_view.dart';
import 'package:nostrfeed_mobile/core/widgets/profile_avatar.dart';
import 'package:nostrfeed_mobile/core/widgets/report_dialog.dart';
import 'package:nostrfeed_mobile/core/widgets/smart_network_image.dart';
import 'package:nostrfeed_mobile/features/compose/application/upload_providers.dart';
import 'package:nostrfeed_mobile/features/premium/presentation/widgets/paid_badge.dart';
import 'package:nostrfeed_mobile/features/profile/application/profile_providers.dart';
import 'package:nostrfeed_mobile/features/profile/presentation/edit_profile_screen.dart';
import 'package:nostrfeed_mobile/features/profile/presentation/user_list_screen.dart';
import 'package:nostrfeed_mobile/features/profile/presentation/widgets/profile_tabs.dart';
import 'package:nostrfeed_mobile/features/zap/presentation/zap_sheet.dart';
import 'package:shimmer/shimmer.dart';

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

  // Primal ProfileTopCoverBar geometry: a compact cover that collapses on
  // scroll from `bannerHeight` to a slim app bar, with the avatar anchored
  // to its bottom edge. Smaller than X's tall banner — the cover is a
  // backdrop, not the content.
  static const double bannerHeight = 140;
  static const double avatarRadius = 36;
  static const double avatarOverlap = 40;

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
              leading: const AppIcon('image', size: AppIconSize.lg),
              title: const Text('Gallery'),
              onTap: () => Navigator.pop(ctx, ImageSource.gallery),
            ),
            ListTile(
              leading: const AppIcon('image', size: AppIconSize.lg),
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
        AppToast.success(context, '${isBanner ? 'Banner' : 'Profile picture'} updated');
      }
    } catch (e) {
      if (mounted) {
        AppToast.error(context, 'Upload failed: $e');
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

    // Content filter: a blocked account, or one whose name/bio is explicit,
    // gets a placeholder — never its content. Your own profile always shows.
    final filter = ref.watch(contentFilterProvider);
    final isBlocked =
        ref.watch(blockedAuthorsProvider).contains(targetPubkey);
    final profile = profileAsync.valueOrNull;
    if (!isOwnProfile &&
        (isBlocked || filter.isExplicitProfile(profile))) {
      return Scaffold(
        appBar: AppBar(title: const Text('Profile')),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                AppIcon(
                  'eye_off',
                  size: 56,
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
                const SizedBox(height: 16),
                Text(
                  isBlocked ? 'Account blocked' : 'Profile hidden',
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                ),
                const SizedBox(height: 8),
                Text(
                  isBlocked
                      ? 'You blocked this account. Their posts and profile are hidden.'
                      : 'This profile was hidden by your content filter.',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                ),
                if (isBlocked) ...[
                  const SizedBox(height: 16),
                  OutlinedButton(
                    onPressed: () => ref
                        .read(blockedAuthorsProvider.notifier)
                        .remove(targetPubkey),
                    child: const Text('Unblock'),
                  ),
                ],
              ],
            ),
          ),
        ),
      );
    }

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
    final isBlockedAuthor =
        ref.watch(blockedAuthorsProvider).contains(pubkey);

    final isFollowing = followsAsync.value?.contains(pubkey) ?? false;
    final followersCount = followersAsync.valueOrNull ?? 0;
    // Posts count = notes + picture posts (kind 20) — the displayable set.
    final postsCount = userPostsAsync.valueOrNull
            ?.where((e) => e.kind == 1 || e.kind == 20)
            .length ??
        0;

    return NestedScrollView(
      headerSliverBuilder: (context, innerBoxIsScrolled) {
        return [
          // ── Banner with avatar inside the stack ────────────────
          // Primal ProfileTopCoverBar: compact cover that collapses on
          // scroll, the avatar anchored to its bottom edge, a scrim that
          // fades in as it collapses, and the profile name fading into the
          // collapsed title slot.
          SliverAppBar(
            expandedHeight: bannerHeight + avatarOverlap + 8,
            pinned: true,
            stretch: true,
            backgroundColor: scheme.surface,
            leading: Container(
              margin: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: Colors.black.withValues(alpha: 0.4), // token-guard: allow — cover-photo scrim
                shape: BoxShape.circle,
              ),
              child: IconButton(
                icon: const AppIcon('back', size: AppIconSize.lg, color: Colors.white), // token-guard: allow — cover-photo scrim
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
            // Collapsed title: the profile name fades in only once the
            // cover has collapsed past the avatar (Primal's title fade).
            title: innerBoxIsScrolled
                ? Text(
                    profile?.displayNameOrName ?? 'Profile',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  )
                : null,
            actions: [
              if (isOwnProfile)
                Container(
                  margin: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: Colors.black.withValues(alpha: 0.4), // token-guard: allow — cover-photo scrim
                    shape: BoxShape.circle,
                  ),
                  child: IconButton(
                    icon: const AppIcon('edit', size: AppIconSize.lg, color: Colors.white), // token-guard: allow — cover-photo scrim
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
                    color: Colors.black.withValues(alpha: 0.4), // token-guard: allow — cover-photo scrim
                    shape: BoxShape.circle,
                  ),
                  child: PopupMenuButton<String>(
                    icon: const AppIcon('more', size: AppIconSize.lg,
                        color: Colors.white), // token-guard: allow — cover-photo scrim
                    tooltip: 'Profile options',
                    onSelected: (value) async {
                      if (value == 'report') {
                        showReportDialog(context, pubkey: widget.pubkey);
                      } else if (value == 'copy_npub') {
                        final npub = ref
                            .read(nostrServiceProvider)
                            .authService
                            .encodeNpub(widget.pubkey!);
                        Clipboard.setData(ClipboardData(text: npub));
                        AppToast.success(context, 'Public key copied');
                      } else if (value == 'block') {
                        final pk = widget.pubkey;
                        if (pk == null) return;
                        final notifier =
                            ref.read(blockedAuthorsProvider.notifier);
                        if (isBlockedAuthor) {
                          await notifier.remove(pk);
                          if (context.mounted) {
                            AppToast.success(context, 'Account unblocked');
                          }
                        } else {
                          await notifier.add(pk);
                          if (context.mounted) {
                            AppToast.success(
                              context,
                              'Account blocked — their posts are hidden',
                            );
                          }
                        }
                      }
                    },
                    itemBuilder: (context) => [
                      PopupMenuItem(
                        value: 'report',
                        child: Row(
                          children: [
                            AppIcon('eye_off',
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
                      PopupMenuItem(
                        value: 'block',
                        child: Row(
                          children: [
                            isBlockedAuthor
                                ? const AppIcon('plus', size: 18)
                                : const AppIcon('eye_off', size: 18),
                            const SizedBox(width: 10),
                            Text(isBlockedAuthor
                                ? 'Unblock account'
                                : 'Block account'),
                          ],
                        ),
                      ),
                      const PopupMenuItem(
                        value: 'copy_npub',
                        child: Row(
                          children: [
                            AppIcon('key', size: AppIconSize.md),
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
                fit: StackFit.expand,
                clipBehavior: Clip.none,
                children: [
                  // Banner image with the collapse scrim on top — Primal
                  // fades the cover to a 70% scrim as it collapses so the
                  // collapsed bar reads as surface, not a squashed photo.
                  Positioned(
                    top: 0,
                    left: 0,
                    right: 0,
                    height: bannerHeight,
                    child: _hasBanner(profile)
                        ? Builder(
                            builder: (context) {
                              final bannerUrl = MediaUtils.optimizedImageUrl(
                                profile!.banner!.trim(),
                                width: 1200,
                              );
                              // NOT SmartNetworkImage here: it passes BOTH
                              // memCacheWidth AND memCacheHeight (width × dpr,
                              // height × dpr). For a wide-short cover photo
                              // that dual memCache constraint distorts the
                              // decode on some Android codecs — the bitmap
                              // fails "Invalid image data" and the banner
                              // silently renders as the grey fallback while
                              // the avatar (width-only) and every feed tile
                              // (memCacheWidth-only) load fine. Width-only
                              // memCache matches every working image in the
                              // app — the cover decodes at screen width and
                              // BoxFit.cover crops the height.
                              final dpr = MediaQuery.devicePixelRatioOf(context);
                              return CachedNetworkImage(
                                // Keyed on the URL so a re-upload to the same
                                // path still re-resolves (stale-pixels guard).
                                key: ValueKey(bannerUrl),
                                imageUrl: bannerUrl,
                                width: MediaQuery.sizeOf(context).width,
                                height: bannerHeight,
                                fit: BoxFit.cover,
                                memCacheWidth:
                                    (MediaQuery.sizeOf(context).width * dpr)
                                        .round(),
                                // A real browser UA — some hosts 403 the
                                // default Dart (empty) UA on Android.
                                httpHeaders: kImageHttpHeaders,
                                placeholder: (_, _) => Container(
                                  color: scheme.surfaceContainerHighest,
                                ),
                                errorWidget: (_, _, _) => Container(
                                  color: scheme.surfaceContainerHighest,
                                ),
                              );
                            },
                          )
                        : Container(
                            // No-banner fallback — a quiet surface tint
                            // (Refined: no gradient). The avatar + name
                            // carry the identity, not a colored banner.
                            color: scheme.surfaceContainerHigh,
                          ),
                  ),

                  // Collapse scrim: black fades in over the cover as the
                  // app bar collapses (Primal's MAX_COVER_TRANSPARENCY).
                  Positioned(
                    top: 0,
                    left: 0,
                    right: 0,
                    height: bannerHeight,
                    child: IgnorePointer(
                      child: Container(
                        color: Colors.black.withValues( // token-guard: allow — cover-photo scrim
                          alpha: innerBoxIsScrolled ? 0.7 : 0.0,
                        ),
                      ),
                    ),
                  ),

                  // Surface-colored fill below the banner so the avatar's
                  // border has something to contrast against
                  Positioned(
                    top: bannerHeight,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    child: Container(color: scheme.surface),
                  ),

                  // Camera overlay for banner on own profile
                  if (isOwnProfile)
                    Positioned(
                      right: 12,
                      top: bannerHeight - 12 - 24, // 12 margin + 24 button
                      child: Material(
                        color: Colors.black.withValues(alpha: 0.5), // token-guard: allow — cover-photo scrim
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
                                              Colors.white), // token-guard: allow — cover-photo scrim
                                    ),
                                  )
                                : const AppIcon('image',
                                    color: Colors.white, // token-guard: allow — cover-photo scrim
                                    size: 18,
                                  ),
                          ),
                        ),
                      ),
                    ),

                  // Avatar — bottom of banner, overlapping below.
                  // Rendered inside the banner's Stack so it doesn't get
                  // clipped by sliver boundaries.
                  Positioned(
                    left: 16,
                    top: bannerHeight - avatarOverlap,
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
                            radius: avatarRadius,
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
                                                    Color>(Colors.white), // token-guard: allow — cover-photo scrim
                                          ),
                                        )
                                      : const AppIcon('image',
                                          color: Colors.white, // token-guard: allow — cover-photo scrim
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
                    top: bannerHeight + 8,
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
                                    backgroundColor: AppActionColors.zap
                                        .withValues(alpha: 0.15),
                                    shape: RoundedRectangleBorder(
                                      borderRadius: BorderRadius.circular(20),
                                    ),
                                  ),
                                  icon: const AppIcon('zap', size: 20, color: AppActionColors.zap),
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
                                  icon: AppIcon('chat', size: 20, color: scheme.primary),
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
                            AppIcon('verified',
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
                      ProfileMetadata(profile: profile, pubkey: pubkey),

                      const SizedBox(height: 12),

                      // Stats — X style: bold count + label, horizontal.
                      // Following/Followers are TAPPABLE → user list screens.
                      Row(
                        children: [
                          XStat(
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
                            child: XStat(
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
                            child: XStat(
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
            delegate: ProfileTabBarDelegate(
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
          // Posts: notes + picture posts (kind 20), not replies. Picture-
          // first accounts post kind 20 — filtering kind==1 alone hid them.
          ProfilePostsTab(
            pubkey: pubkey,
            filter: (e) =>
                (e.kind == 1 && !e.isReply) || e.kind == 20 || e.kind == 6,
          ),
          ProfilePostsTab(pubkey: pubkey, filter: (e) => e.kind == 1 && e.isReply),
          // NIP-23 long-form articles are kind 30023
          ProfilePostsTab(pubkey: pubkey, filter: (e) => e.kind == 30023),
          // Media: picture/video kinds + notes that carry media URLs.
          ProfilePostsTab(
            pubkey: pubkey,
            filter: (e) =>
                e.kind == 20 ||
                e.kind == 21 ||
                e.kind == 22 ||
                (e.kind == 1 && _hasMedia(e)),
          ),
          // Likes = posts the USER liked (their kind-7 targets), not kind-7
          // in their own feed (which is always empty).
          ProfileLikedPostsTab(pubkey: pubkey),
          ProfileCommunitiesTab(pubkey: pubkey),
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
        AppToast.success(
          context,
          isFollowing ? 'Unfollowed' : 'Followed',
        );
      }
    } catch (e) {
      if (mounted) {
        AppToast.error(context, 'Failed to update follow: $e');
      }
    }
  }


/// Whether the profile has a usable banner URL (non-empty after trim and a
/// parseable http(s) URI) — guards against whitespace/garbage URLs that
/// would hand the loader a raw invalid string.
bool _hasBanner(NostrProfile? profile) {
  final banner = profile?.banner?.trim();
  if (banner == null || banner.isEmpty) return false;
  final uri = Uri.tryParse(banner);
  return uri != null && (uri.isScheme('http') || uri.isScheme('https'));
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
            // Banner skeleton — Primal compact cover with avatar overlap
            SliverAppBar(
              expandedHeight: bannerHeight + avatarOverlap + 8,
              pinned: true,
              flexibleSpace: Stack(
                children: [
                  Positioned(
                    top: 0,
                    left: 0,
                    right: 0,
                    height: bannerHeight,
                    child: Container(color: baseColor),
                  ),
                  Positioned(
                    top: bannerHeight,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    child: Container(color: scheme.surface),
                  ),
                  Positioned(
                    left: 16,
                    top: bannerHeight - avatarOverlap,
                    child: CircleAvatar(
                      radius: avatarRadius,
                      backgroundColor: baseColor,
                    ),
                  ),
                  Positioned(
                    right: 16,
                    top: bannerHeight + 8,
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

