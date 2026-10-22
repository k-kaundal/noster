import 'dart:convert';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/core/widgets/async_feed_scaffold.dart';
import 'package:nostrfeed_mobile/core/widgets/empty_state.dart';
import 'package:nostrfeed_mobile/features/feed/presentation/widgets/post_card.dart';

/// Posts approved for a community (NIP-72 kind 4550 approvals, plus the
/// community's a-tagged posts as a fallback).
final communityFeedProvider = FutureProvider.autoDispose
    .family<List<NostrEvent>, NostrEvent>((ref, community) async {
  final nostr = ref.read(nostrServiceProvider);
  if (!nostr.isInitialized) await nostr.init();
  final d = community.getTag('d') ?? '';
  final coordinate = '34550:${community.pubkey}:$d';

  // Approved posts (kind 4550 wraps the original event in content)…
  final approvals = await nostr.relayPool.query([
    NostrFilter(
      kinds: [4550],
      tagFilters: {
        'a': [coordinate],
      },
      limit: 100,
    ),
  ], timeout: const Duration(seconds: 6));

  final posts = <NostrEvent>[];
  final seen = <String>{};
  for (final approval in approvals) {
    try {
      // content holds the JSON-encoded approved post per NIP-72.
      final inner = NostrEvent.fromJson(
        jsonDecode(approval.content) as Map<String, dynamic>,
      );
      if (seen.add(inner.id)) posts.add(inner);
    } catch (_) {
      // Some approvals don't embed the post — skip them.
    }
  }

  // …plus direct a-tagged posts (kind 1 + 1111) as fallback.
  final tagged = await nostr.relayPool.query([
    NostrFilter(
      kinds: [1, 1111],
      tagFilters: {
        'a': [coordinate],
      },
      limit: 100,
    ),
  ], timeout: const Duration(seconds: 6));
  for (final e in tagged) {
    if (seen.add(e.id)) posts.add(e);
  }

  posts.sort((a, b) => b.createdAt.compareTo(a.createdAt));
  return posts;
});

/// Whether the current user joined this community (kind 10004 list).
final joinedCommunityCoordsProvider =
    FutureProvider.autoDispose<Set<String>>((ref) async {
  final auth = ref.watch(authStateProvider);
  if (!auth.isLoggedIn || auth.pubkey == null) return {};
  final nostr = ref.read(nostrServiceProvider);
  if (!nostr.isInitialized) await nostr.init();
  final events = await nostr.relayPool.query([
    NostrFilter(kinds: [10004], authors: [auth.pubkey!], limit: 5),
  ], timeout: const Duration(seconds: 6));
  final joined = <String>{};
  for (final e in events) {
    for (final tag in e.tags) {
      if (tag.isNotEmpty && tag[0] == 'a' && tag.length > 1) {
        joined.add(tag[1]);
      }
    }
  }
  return joined;
});

/// Community detail: cover, info, join button, approved posts feed,
/// and post-to-community action.
class CommunityDetailScreen extends ConsumerWidget {
  final NostrEvent community;
  const CommunityDetailScreen({super.key, required this.community});

  String get _coordinate {
    final d = community.getTag('d') ?? '';
    return '34550:${community.pubkey}:$d';
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final name = sanitizeText(community.getTag('name')).isEmpty
        ? 'Unnamed Community'
        : sanitizeText(community.getTag('name'));
    final description = sanitizeText(community.getTag('description'));
    final image = community.getTag('image');
    final feedAsync = ref.watch(communityFeedProvider(community));
    final joinedAsync = ref.watch(joinedCommunityCoordsProvider);
    final isJoined = joinedAsync.valueOrNull?.contains(_coordinate) ?? false;
    final auth = ref.watch(authStateProvider);

    return Scaffold(
      body: CustomScrollView(
        slivers: [
          // Cover + title
          SliverAppBar(
            expandedHeight: 160,
            pinned: true,
            flexibleSpace: FlexibleSpaceBar(
              title: Text(
                name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 16),
              ),
              background: image != null
                  ? CachedNetworkImage(
                      imageUrl: image,
                      fit: BoxFit.cover,
                      errorWidget: (_, _, _) => _CoverFallback(scheme: scheme),
                    )
                  : _CoverFallback(scheme: scheme),
            ),
          ),

          // Info + join
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (description.isNotEmpty)
                    Text(
                      description,
                      style: TextStyle(
                        fontSize: 14,
                        height: 1.4,
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          'Moderated community (NIP-72)',
                          style: TextStyle(
                            fontSize: 12,
                            color: scheme.onSurfaceVariant,
                          ),
                        ),
                      ),
                      if (auth.isLoggedIn && !auth.isReadOnly)
                        FilledButton.tonalIcon(
                          onPressed: () =>
                              _toggleJoin(context, ref, isJoined),
                          icon: Icon(
                            isJoined
                                ? Icons.check_rounded
                                : Icons.add_rounded,
                            size: 18,
                          ),
                          label: Text(isJoined ? 'Joined' : 'Join'),
                        ),
                    ],
                  ),
                ],
              ),
            ),
          ),

          // Posts feed
          SliverFillRemaining(
            child: AsyncFeedList<NostrEvent>(
              value: feedAsync,
              onRefresh: () =>
                  ref.refresh(communityFeedProvider(community).future),
              emptyState: const EmptyState(
                icon: Icons.forum_outlined,
                title: 'No posts yet',
                subtitle: 'Approved posts will appear here.',
              ),
              padding: const EdgeInsets.symmetric(horizontal: 8),
              itemBuilder: (context, event) => PostCard(event: event),
            ),
          ),
        ],
      ),
      floatingActionButton: auth.isLoggedIn && !auth.isReadOnly
          ? FloatingActionButton.extended(
              onPressed: () => _composePost(context, ref),
              icon: const Icon(Icons.edit_rounded),
              label: const Text('Post'),
            )
          : null,
    );
  }

  Future<void> _toggleJoin(
      BuildContext context, WidgetRef ref, bool isJoined) async {
    try {
      final nostr = ref.read(nostrServiceProvider);
      final auth = ref.read(authStateProvider);
      // kind 10004 communities list — add/remove the a tag.
      final existing = await nostr.relayPool.query([
        NostrFilter(kinds: [10004], authors: [auth.pubkey!], limit: 1),
      ], timeout: const Duration(seconds: 6));
      final current = <List<String>>[];
      if (existing.isNotEmpty) {
        current.addAll(existing.first.tags.where(
          (t) => t.isNotEmpty && (t[0] == 'a' || t[0] == 'client'),
        ));
      }
      if (isJoined) {
        current.removeWhere((t) => t.length > 1 && t[1] == _coordinate);
      } else {
        current.add(['a', _coordinate]);
      }
      final event = nostr.authService.signEvent(
        privateKey: auth.privateKey!,
        kind: 10004,
        content: '',
        tags: current,
      );
      await nostr.publishEvent(event);
      ref.invalidate(joinedCommunityCoordsProvider);
      if (context.mounted) {
        AppToast.success(
            context, isJoined ? 'Left community' : 'Joined community');
      }
    } catch (e) {
      if (context.mounted) AppToast.error(context, 'Failed: $e');
    }
  }

  void _composePost(BuildContext context, WidgetRef ref) {
    final controller = TextEditingController();
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(
          left: 20,
          right: 20,
          top: 8,
          bottom: MediaQuery.of(ctx).viewInsets.bottom + 20,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Post to community',
              style: Theme.of(ctx)
                  .textTheme
                  .titleLarge
                  ?.copyWith(fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: controller,
              maxLines: 4,
              autofocus: true,
              decoration: const InputDecoration(
                hintText: 'Share with this community…',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            Text(
              'Posts go to moderators for approval (NIP-72).',
              style: TextStyle(
                fontSize: 12,
                color: Theme.of(ctx).colorScheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: () async {
                final text = controller.text.trim();
                if (text.isEmpty) return;
                Navigator.pop(ctx);
                try {
                  final nostr = ref.read(nostrServiceProvider);
                  final auth = ref.read(authStateProvider);
                  // NIP-72: kind 1 with the community a tag (moderators approve).
                  final event = nostr.authService.signEvent(
                    privateKey: auth.privateKey!,
                    kind: 1,
                    content: text,
                    tags: [
                      ['a', _coordinate],
                      ['client', 'nostrfeed'],
                    ],
                  );
                  await nostr.publishEvent(event);
                  if (context.mounted) {
                    AppToast.success(
                      context,
                      'Posted — pending moderator approval',
                    );
                  }
                } catch (e) {
                  if (context.mounted) {
                    AppToast.error(context, 'Post failed: $e');
                  }
                }
              },
              icon: const Icon(Icons.send_rounded),
              label: const Text('Post'),
            ),
          ],
        ),
      ),
    );
  }
}

class _CoverFallback extends StatelessWidget {
  final ColorScheme scheme;
  const _CoverFallback({required this.scheme});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [scheme.primary, scheme.tertiary],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
    );
  }
}
