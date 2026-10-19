import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:go_router/go_router.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/widgets/error_view.dart';
import 'package:nostrfeed_mobile/core/widgets/empty_state.dart';
import 'package:nostrfeed_mobile/core/widgets/skeleton.dart';

class MarketScreen extends ConsumerStatefulWidget {
  const MarketScreen({super.key});

  @override
  ConsumerState<MarketScreen> createState() => _MarketScreenState();
}

class _MarketScreenState extends ConsumerState<MarketScreen> {
  String _selectedCategory = 'All';
  String _query = '';

  static const _categories = [
    'All', 'Electronics', 'Art', 'Books', 'Clothing', 'Services', 'Digital'
  ];

  @override
  Widget build(BuildContext context) {
    // Reuse communities provider as placeholder until a market provider exists
    final listings = ref.watch(communitiesProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Marketplace'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(108),
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                child: SearchBar(
                  hintText: 'Search products…',
                  leading: const Icon(Icons.search),
                  elevation: const WidgetStatePropertyAll(0),
                  backgroundColor: WidgetStatePropertyAll(
                    Theme.of(context).colorScheme.surfaceContainerHighest,
                  ),
                  onChanged: (v) => setState(() => _query = v.toLowerCase()),
                ),
              ),
              SizedBox(
                height: 42,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  itemCount: _categories.length,
                  separatorBuilder: (_, _) => const SizedBox(width: 8),
                  itemBuilder: (context, i) {
                    final cat = _categories[i];
                    return ChoiceChip(
                      label: Text(cat),
                      selected: _selectedCategory == cat,
                      onSelected: (_) =>
                          setState(() => _selectedCategory = cat),
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ),
      body: listings.when(
        loading: () => const _MarketSkeletonGrid(),
        error: (err, _) => ErrorView(
          message: 'Failed to load marketplace',
          onRetry: () => ref.invalidate(communitiesProvider),
        ),
        data: (events) {
          final items = _query.isEmpty
              ? events
              : events.where((e) {
                  final title = e.getTag('title')?.toLowerCase() ??
                      e.content.toLowerCase();
                  return title.contains(_query);
                }).toList();

          if (items.isEmpty) {
            return const EmptyState(
              icon: Icons.storefront,
              title: 'No listings found',
              subtitle: 'Products listed on Nostr will appear here.',
            );
          }

          return GridView.builder(
            padding: const EdgeInsets.all(12),
            gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
              maxCrossAxisExtent: 240,
              mainAxisExtent: 260,
              crossAxisSpacing: 10,
              mainAxisSpacing: 10,
            ),
            itemCount: items.length,
            itemBuilder: (context, index) =>
                _ProductCard(event: items[index]),
          );
        },
      ),
    );
  }
}

class _ProductCard extends ConsumerWidget {
  final NostrEvent event;
  const _ProductCard({required this.event});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final title = event.getTag('title') ?? 'Product';
    final price = event.getTag('price') ?? '21000';
    final image = event.getTag('image');
    final profileAsync = ref.watch(profileProvider(event.pubkey));

    return Card(
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: InkWell(
        onTap: () => context.push('/thread', extra: event),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Product image
            Expanded(
              child: image != null
                  ? CachedNetworkImage(
                      imageUrl: image,
                      width: double.infinity,
                      fit: BoxFit.cover,
                      placeholder: (_, _) =>
                          Container(color: scheme.surfaceContainerHighest),
                      errorWidget: (_, _, _) => _ImageFallback(),
                    )
                  : _ImageFallback(),
            ),
            Padding(
              padding: const EdgeInsets.all(10),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: const TextStyle(
                        fontWeight: FontWeight.w600, fontSize: 13),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 6),
                  Row(
                    children: [
                      Icon(Icons.bolt, size: 15, color: scheme.primary),
                      Text(
                        '$price sats',
                        style: TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 13,
                          color: scheme.primary,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Row(
                    children: [
                      profileAsync.when(
                        data: (profile) => CircleAvatar(
                          radius: 9,
                          backgroundImage: profile?.picture != null
                              ? CachedNetworkImageProvider(profile!.picture!)
                              : null,
                          child: profile?.picture == null
                              ? const Icon(Icons.person, size: 9)
                              : null,
                        ),
                        loading: () => const CircleAvatar(radius: 9),
                        error: (_, _) =>
                            const CircleAvatar(radius: 9),
                      ),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          profileAsync.value?.displayNameOrName ??
                              '${event.pubkey.substring(0, 8)}…',
                          style: TextStyle(
                              fontSize: 11, color: scheme.onSurfaceVariant),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ImageFallback extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      color: scheme.surfaceContainerHighest,
      child: Center(
        child: Icon(Icons.storefront, size: 40, color: scheme.onSurfaceVariant),
      ),
    );
  }
}

/// Grid-shaped loading skeleton for the marketplace grid.
/// Rebuilt from the shared [SkeletonTheme] + [SkeletonBox] primitives so it
/// works in both light and dark mode.
class _MarketSkeletonGrid extends StatelessWidget {
  const _MarketSkeletonGrid();

  @override
  Widget build(BuildContext context) {
    return SkeletonTheme(
      child: GridView.builder(
        padding: const EdgeInsets.all(12),
        gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
          maxCrossAxisExtent: 240,
          mainAxisExtent: 260,
          crossAxisSpacing: 10,
          mainAxisSpacing: 10,
        ),
        itemCount: 8,
        itemBuilder: (context, _) => Card(
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          child: const Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: SkeletonBox(
                  borderRadius:
                      BorderRadius.vertical(top: Radius.circular(14)),
                ),
              ),
              Padding(
                padding: EdgeInsets.all(10),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SkeletonLine(height: 12),
                    SizedBox(height: 8),
                    SkeletonLine(height: 12, width: 80),
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
