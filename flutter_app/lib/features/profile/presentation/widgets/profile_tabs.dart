import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/theme/app_shapes.dart';
import 'package:nostrfeed_mobile/core/theme/app_theme.dart';
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';
import 'package:nostrfeed_mobile/core/widgets/empty_state.dart';
import 'package:nostrfeed_mobile/core/widgets/skeleton.dart';
import 'package:nostrfeed_mobile/features/communities/presentation/community_detail_screen.dart';
import 'package:nostrfeed_mobile/features/feed/presentation/widgets/post_card.dart';
import 'package:nostrfeed_mobile/features/profile/application/profile_providers.dart';

/// Profile tab bodies, extracted from `profile_screen.dart` (was 1449 lines):
/// metadata block, X-style stats, tab-bar delegate, and the
/// Posts / Liked / Communities tab contents.

// ─── Metadata block (nip05 / lightning / website / key) ─────────────

class ProfileMetadata extends StatelessWidget {
  final NostrProfile? profile;
  final String pubkey;

  const ProfileMetadata({
    super.key,
    required this.profile,
    required this.pubkey,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final items = <Widget>[];

    // NIP-05 verified identifier
    if (profile?.nip05 != null && profile!.nip05!.isNotEmpty) {
      items.add(
        MetadataRow(
          icon: Icons.verified_outlined,
          text: profile!.nip05!,
          color: scheme.primary,
        ),
      );
    }

    // Lightning address
    if (profile?.lud16 != null && profile!.lud16!.isNotEmpty) {
      items.add(
        MetadataRow(
          icon: Icons.bolt_outlined,
          text: profile!.lud16!,
          color: AppActionColors.zap,
        ),
      );
    }

    // Website
    if (profile?.website != null && profile!.website!.isNotEmpty) {
      items.add(
        MetadataRow(
          icon: Icons.link_outlined,
          text: profile!.website!,
          color: scheme.primary,
        ),
      );
    }

    // Public key (shortened)
    final npub = pubkey.length > 16
        ? '${pubkey.substring(0, 8)}…${pubkey.substring(pubkey.length - 4)}'
        : pubkey;
    items.add(
      MetadataRow(
        icon: Icons.key_outlined,
        text: npub,
        color: scheme.onSurfaceVariant,
      ),
    );

    if (items.isEmpty) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: items.expand((w) => [w, const SizedBox(height: 6)]).toList()
        ..removeLast(),
    );
  }
}

class MetadataRow extends StatelessWidget {
  final IconData icon;
  final String text;
  final Color color;

  const MetadataRow({
    super.key,
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
class XStat extends StatelessWidget {
  final int count;
  final String label;

  const XStat({super.key, required this.count, required this.label});

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

// ─── Pinned tab-bar delegate ────────────────────────────────────────

class ProfileTabBarDelegate extends SliverPersistentHeaderDelegate {
  final TabBar tabBar;
  final Color color;

  ProfileTabBarDelegate({required this.tabBar, required this.color});

  @override
  double get minExtent => tabBar.preferredSize.height;

  @override
  double get maxExtent => tabBar.preferredSize.height;

  @override
  Widget build(
    BuildContext context,
    double shrinkOffset,
    bool overlapsContent,
  ) {
    return Container(color: color, child: tabBar);
  }

  @override
  bool shouldRebuild(ProfileTabBarDelegate oldDelegate) =>
      tabBar != oldDelegate.tabBar || color != oldDelegate.color;
}

// ─── Communities tab ────────────────────────────────────────────────

/// Communities the user JOINED + communities they CREATED.
class ProfileCommunitiesTab extends ConsumerWidget {
  final String pubkey;
  const ProfileCommunitiesTab({super.key, required this.pubkey});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final joinedAsync = ref.watch(joinedCommunitiesProvider(pubkey));
    final createdAsync = ref.watch(myCommunitiesProvider(pubkey));

    return ListView(
      padding: const EdgeInsets.all(12),
      children: [
        if (createdAsync.valueOrNull?.isNotEmpty == true) ...[
          const ProfileSectionHeader(title: 'Created'),
          for (final c in createdAsync.value!) ProfileCommunityTile(event: c),
          const SizedBox(height: 16),
        ],
        const ProfileSectionHeader(title: 'Joined'),
        joinedAsync.when(
          loading: () => const Padding(
            padding: EdgeInsets.all(24),
            child: SkeletonList(itemCount: 3),
          ),
          error: (_, _) => const Text('Failed to load'),
          data: (communities) => communities.isEmpty
              ? const Padding(
                  padding: EdgeInsets.all(24),
                  child: Center(child: Text('No communities joined yet')),
                )
              : Column(
                  children: [
                    for (final c in communities) ProfileCommunityTile(event: c),
                  ],
                ),
        ),
      ],
    );
  }
}

class ProfileSectionHeader extends StatelessWidget {
  final String title;
  const ProfileSectionHeader({super.key, required this.title});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 0, 4, 8),
      child: Text(
        title.toUpperCase(),
        style: Theme.of(context).textTheme.labelSmall?.copyWith(
          fontWeight: FontWeight.w700,
          letterSpacing: 1.4,
          color: Theme.of(context).colorScheme.primary,
        ),
      ),
    );
  }
}

class ProfileCommunityTile extends StatelessWidget {
  final NostrEvent event;
  const ProfileCommunityTile({super.key, required this.event});

  @override
  Widget build(BuildContext context) {
    final name = event.getTag('name') ?? 'Unnamed';
    final desc = event.getTag('description') ?? '';
    final scheme = Theme.of(context).colorScheme;
    // Refined hairline row (was Card+ListTile — the only old-style row left
    // in the profile tabs, inconsistent with every other screen).
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLowest,
        border: Border.all(color: scheme.outlineVariant),
        borderRadius: AppShapes.radiusMd,
      ),
      child: InkWell(
        borderRadius: AppShapes.radiusMd,
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => CommunityDetailScreen(community: event),
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          child: Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: scheme.primaryContainer,
                  shape: BoxShape.circle,
                ),
                child: Center(
                  child: AppIcon(
                    'group',
                    size: 20,
                    color: scheme.onPrimaryContainer,
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.titleSmall
                          ?.copyWith(fontWeight: FontWeight.w600),
                    ),
                    if (desc.isNotEmpty)
                      Text(
                        desc,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.bodySmall
                            ?.copyWith(color: scheme.onSurfaceVariant),
                      ),
                  ],
                ),
              ),
              AppIcon('chevron_r', size: 18, color: scheme.onSurfaceVariant),
            ],
          ),
        ),
      ),
    );
  }
}

// ─── Likes tab ──────────────────────────────────────────────────────

/// Posts the USER liked (their kind-7 reaction targets).
class ProfileLikedPostsTab extends ConsumerWidget {
  final String pubkey;
  const ProfileLikedPostsTab({super.key, required this.pubkey});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final likedAsync = ref.watch(userLikedPostsProvider(pubkey));

    return likedAsync.when(
      loading: () => const SkeletonList(itemCount: 4),
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
          itemBuilder: (context, index) => PostCard(event: posts[index]),
        );
      },
    );
  }
}

// ─── Posts tab ──────────────────────────────────────────────────────

class ProfilePostsTab extends ConsumerWidget {
  final String pubkey;
  final bool Function(NostrEvent) filter;

  const ProfilePostsTab({
    super.key,
    required this.pubkey,
    required this.filter,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final postsAsync = ref.watch(userPostsProvider(pubkey));

    // Pull-to-refresh: profile tabs had NO refresh gesture (the "profile is
    // stale until restart" complaint) — a pull invalidates the posts provider
    // and re-fetches from relays, same as the feed.
    Future<void> onRefresh() async {
      HapticFeedback.mediumImpact();
      ref.invalidate(userPostsProvider(pubkey));
      ref.invalidate(profileProvider(pubkey));
      await ref.read(userPostsProvider(pubkey).future);
    }

    return postsAsync.when(
      data: (events) {
        final userPosts = events.where(filter).toList()
          ..sort((a, b) => b.createdAt.compareTo(a.createdAt));

        if (userPosts.isEmpty) {
          // Empty state must still be pullable (RefreshIndicator needs a
          // scrollable child) — a user can pull to retry a failed fetch.
          return RefreshIndicator(
            onRefresh: onRefresh,
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              children: const [
                SizedBox(height: 300),
                EmptyState(
                  icon: Icons.article_outlined,
                  title: 'No posts yet',
                  subtitle: 'Posts will appear here — pull to refresh',
                ),
              ],
            ),
          );
        }

        return RefreshIndicator(
          onRefresh: onRefresh,
          child: ListView.builder(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.only(top: 8, bottom: 180),
            itemCount: userPosts.length,
            itemBuilder: (context, index) {
              final event = userPosts[index];
              return PostCard(event: event);
            },
          ),
        );
      },
      loading: () => const SkeletonList(itemCount: 4),
      error: (error, stack) => RefreshIndicator(
        onRefresh: onRefresh,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            Padding(
              padding: const EdgeInsets.all(24),
              child: Text('Failed to load posts: $error'),
            ),
          ],
        ),
      ),
    );
  }
}
