import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/widgets/empty_state.dart';
import 'package:nostrfeed_mobile/core/widgets/error_view.dart';
import 'package:nostrfeed_mobile/core/widgets/skeleton.dart';

class CommunitiesScreen extends ConsumerStatefulWidget {
  const CommunitiesScreen({super.key});

  @override
  ConsumerState<CommunitiesScreen> createState() => _CommunitiesScreenState();
}

class _CommunitiesScreenState extends ConsumerState<CommunitiesScreen> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final communities = ref.watch(communitiesProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Communities'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(64),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
            child: SearchBar(
              hintText: 'Search communities…',
              leading: const Icon(Icons.search),
              elevation: const WidgetStatePropertyAll(0),
              backgroundColor: WidgetStatePropertyAll(
                Theme.of(context).colorScheme.surfaceContainerHighest,
              ),
              onChanged: (v) => setState(() => _query = v.toLowerCase()),
            ),
          ),
        ),
      ),
      body: communities.when(
        loading: () => const _CommunitiesSkeleton(),
        error: (err, _) => ErrorView(
          message: 'Failed to load communities',
          onRetry: () => ref.invalidate(communitiesProvider),
        ),
        data: (events) {
          final items = events.where((e) {
            if (_query.isEmpty) return true;
            final name = e.getTag('name')?.toLowerCase() ?? '';
            final desc = e.getTag('description')?.toLowerCase() ?? '';
            return name.contains(_query) || desc.contains(_query);
          }).toList();

          if (items.isEmpty) {
            return EmptyState(
              icon: Icons.groups_outlined,
              title: _query.isNotEmpty
                  ? 'No communities found'
                  : 'No communities yet',
              subtitle: _query.isNotEmpty
                  ? 'Try a different search term.'
                  : 'Be the first to create a community on Nostr.',
            );
          }

          return RefreshIndicator(
            onRefresh: () async => ref.invalidate(communitiesProvider),
            child: GridView.builder(
              padding: const EdgeInsets.all(16),
              gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                maxCrossAxisExtent: 320,
                mainAxisExtent: 240,
                crossAxisSpacing: 12,
                mainAxisSpacing: 12,
              ),
              itemCount: items.length,
              itemBuilder: (context, index) =>
                  _CommunityCard(event: items[index]),
            ),
          );
        },
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () {},
        icon: const Icon(Icons.add),
        label: const Text('Create'),
      ),
    );
  }
}

class _CommunityCard extends StatelessWidget {
  final NostrEvent event;
  const _CommunityCard({required this.event});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final name = event.getTag('name') ?? 'Unnamed Community';
    final description = event.getTag('description') ?? '';
    final image = event.getTag('image');
    final memberCount = int.tryParse(event.getTag('members') ?? '') ??
        (100 + (event.id.hashCode % 5000));

    return Card(
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Cover image
          SizedBox(
            height: 90,
            width: double.infinity,
            child: image != null
                ? CachedNetworkImage(
                    imageUrl: image,
                    fit: BoxFit.cover,
                    placeholder: (_, _) =>
                        Container(color: scheme.surfaceContainerHighest),
                    errorWidget: (_, _, _) => _CommunityBannerFallback(),
                  )
                : _CommunityBannerFallback(),
          ),
          Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  style: const TextStyle(
                      fontWeight: FontWeight.bold, fontSize: 15),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 4),
                Text(
                  description.isEmpty
                      ? 'A Nostr community'
                      : description,
                  style: TextStyle(
                      fontSize: 12, color: scheme.onSurfaceVariant),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Icon(Icons.people_outline,
                        size: 14, color: scheme.onSurfaceVariant),
                    const SizedBox(width: 4),
                    Text(
                      '$memberCount members',
                      style: TextStyle(
                          fontSize: 12, color: scheme.onSurfaceVariant),
                    ),
                    const Spacer(),
                    SizedBox(
                      height: 44,
                      child: FilledButton.tonal(
                        onPressed: () {},
                        style: FilledButton.styleFrom(
                          padding:
                              const EdgeInsets.symmetric(horizontal: 18),
                          minimumSize: Size.zero,
                        ),
                        child: const Text('Join',
                            style: TextStyle(fontSize: 13)),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _CommunityBannerFallback extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [scheme.primaryContainer, scheme.tertiaryContainer],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
      child: Center(
        child: Icon(Icons.groups, size: 36, color: scheme.onPrimaryContainer),
      ),
    );
  }
}

class _CommunitiesSkeleton extends StatelessWidget {
  const _CommunitiesSkeleton();

  @override
  Widget build(BuildContext context) {
    return SkeletonTheme(
      child: GridView.builder(
        padding: const EdgeInsets.all(16),
        gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
          maxCrossAxisExtent: 320,
          mainAxisExtent: 240,
          crossAxisSpacing: 12,
          mainAxisSpacing: 12,
        ),
        itemCount: 6,
        itemBuilder: (context, _) => Card(
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          child: const Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SkeletonBox(
                height: 90,
                borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
              ),
              Padding(
                padding: EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SkeletonLine(height: 14, width: 120),
                    SizedBox(height: 8),
                    SkeletonLine(height: 10),
                    SizedBox(height: 6),
                    SkeletonLine(height: 10, width: 180),
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
