import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/utils/text_sanitize.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/core/widgets/detail_scaffold.dart';
import 'package:nostrfeed_mobile/core/widgets/empty_state.dart';
import 'package:nostrfeed_mobile/core/widgets/safe_image.dart';
import 'package:nostrfeed_mobile/features/compose/application/upload_providers.dart';
import 'package:nostrfeed_mobile/features/market/application/market_providers.dart';
import 'package:nostrfeed_mobile/features/market/domain/listing.dart';
import 'package:timeago/timeago.dart' as timeago;

/// Market home: browse NIP-99 classified listings + create.
class MarketScreen extends ConsumerWidget {
  const MarketScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final listingsAsync = ref.watch(listingsProvider);
    final myListingsAsync = ref.watch(myListingsProvider);
    final auth = ref.watch(authStateProvider);

    return DetailScaffold(
      title: 'Market',
      body: listingsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text('Failed to load listings'),
              TextButton(
                onPressed: () => ref.invalidate(listingsProvider),
                child: const Text('Retry'),
              ),
            ],
          ),
        ),
        data: (listings) {
          final mine = myListingsAsync.valueOrNull ?? [];
          final discover = listings
              .where((l) => !mine.any((m) => m.id == l.id))
              .toList();

          return RefreshIndicator(
            onRefresh: () async {
              ref.invalidate(listingsProvider);
              ref.invalidate(myListingsProvider);
            },
            child: ListView(
              padding: const EdgeInsets.all(12),
              children: [
                if (mine.isNotEmpty) ...[
                  _SectionHeader(title: 'My listings (${mine.length})'),
                  for (final l in mine) _ListingCard(listing: l, isMine: true),
                  const SizedBox(height: 16),
                ],
                _SectionHeader(
                  title: mine.isEmpty ? 'Listings' : 'Discover',
                ),
                if (listings.isEmpty)
                  const EmptyState(
                    icon: Icons.storefront_outlined,
                    title: 'No listings yet',
                    subtitle: 'Products and services listed on Nostr will appear here.',
                  )
                else if (discover.isEmpty && mine.isNotEmpty)
                  const Padding(
                    padding: EdgeInsets.all(24),
                    child: Center(child: Text('Nothing new to discover')),
                  )
                else
                  for (final l in discover) _ListingCard(listing: l),
              ],
            ),
          );
        },
      ),
      floatingActionButton: auth.isLoggedIn
          ? FloatingActionButton.extended(
              onPressed: () => showModalBottomSheet(
                context: context,
                isScrollControlled: true,
                showDragHandle: true,
                builder: (_) => const _CreateListingSheet(),
              ),
              icon: const Icon(Icons.add_business_rounded),
              label: const Text('Sell'),
            )
          : null,
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final String title;
  const _SectionHeader({required this.title});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 0, 4, 10),
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

class _ListingCard extends ConsumerWidget {
  final Listing listing;
  final bool isMine;
  const _ListingCard({required this.listing, this.isMine = false});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final sellerAsync = ref.watch(profileProvider(listing.sellerPubkey));
    final seller = sellerAsync.valueOrNull;

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: InkWell(
        onTap: () => _showDetail(context, ref),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Image + price badge
            Stack(
              children: [
                SizedBox(
                  height: 140,
                  width: double.infinity,
                  child: listing.image != null
                      ? CachedNetworkImage(
                          imageUrl: listing.image!,
                          fit: BoxFit.cover,
                          errorWidget: (_, _, _) =>
                              _ImageFallback(scheme: scheme),
                        )
                      : _ImageFallback(scheme: scheme),
                ),
                if (listing.price != null)
                  Positioned(
                    top: 10,
                    right: 10,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 10, vertical: 5),
                      decoration: BoxDecoration(
                        color: scheme.primary,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        listing.price!.display,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 12,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                  ),
                if (isMine)
                  Positioned(
                    top: 10,
                    left: 10,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                        color: Colors.black54,
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: const Text(
                        'YOURS',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 10,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
            Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    listing.title,
                    style: const TextStyle(
                        fontWeight: FontWeight.bold, fontSize: 15),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  if (listing.summary.isNotEmpty) ...[
                    const SizedBox(height: 3),
                    Text(
                      listing.summary,
                      style: TextStyle(
                          fontSize: 12, color: scheme.onSurfaceVariant),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      SafeAvatar(
                        imageUrl: seller?.picture,
                        radius: 12,
                        fallback: const Icon(Icons.person, size: 12),
                      ),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          [
                            seller?.displayNameOrName ??
                                '${listing.sellerPubkey.substring(0, 8)}…',
                            if (listing.location != null) listing.location!,
                            timeago.format(
                              DateTime.fromMillisecondsSinceEpoch(
                                  listing.publishedAt * 1000),
                              locale: 'en_short',
                            ),
                          ].join(' · '),
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

  void _showDetail(BuildContext context, WidgetRef ref) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (ctx) => _ListingDetailSheet(listing: listing),
    );
  }
}

class _ListingDetailSheet extends ConsumerWidget {
  final Listing listing;
  const _ListingDetailSheet({required this.listing});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final sellerAsync = ref.watch(profileProvider(listing.sellerPubkey));
    final seller = sellerAsync.valueOrNull;

    return DraggableScrollableSheet(
      initialChildSize: 0.75,
      minChildSize: 0.5,
      maxChildSize: 0.95,
      expand: false,
      builder: (context, scrollController) => ListView(
        controller: scrollController,
        padding: const EdgeInsets.all(20),
        children: [
          if (listing.image != null)
            ClipRRect(
              borderRadius: BorderRadius.circular(14),
              child: CachedNetworkImage(
                imageUrl: listing.image!,
                height: 200,
                width: double.infinity,
                fit: BoxFit.cover,
                errorWidget: (_, _, _) => const SizedBox.shrink(),
              ),
            ),
          const SizedBox(height: 14),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(
                  listing.title,
                  style: const TextStyle(
                      fontSize: 20, fontWeight: FontWeight.bold),
                ),
              ),
              if (listing.price != null)
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(
                    color: scheme.primary,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    listing.price!.display,
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.bold,
                      fontSize: 15,
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              SafeAvatar(
                imageUrl: seller?.picture,
                radius: 16,
                fallback: const Icon(Icons.person, size: 16),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  seller?.displayNameOrName ??
                      '${listing.sellerPubkey.substring(0, 8)}…',
                  style: const TextStyle(fontWeight: FontWeight.w600),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              if (listing.location != null)
                Row(
                  children: [
                    Icon(Icons.location_on_outlined,
                        size: 14, color: scheme.onSurfaceVariant),
                    const SizedBox(width: 3),
                    Text(
                      listing.location!,
                      style: TextStyle(
                          fontSize: 12, color: scheme.onSurfaceVariant),
                    ),
                  ],
                ),
            ],
          ),
          const SizedBox(height: 16),
          if (listing.description.isNotEmpty)
            Text(
              sanitizeText(listing.description),
              style: const TextStyle(fontSize: 14, height: 1.5),
            ),
          if (listing.hashtags.isNotEmpty) ...[
            const SizedBox(height: 14),
            Wrap(
              spacing: 6,
              children: [
                for (final t in listing.hashtags)
                  Text(
                    '#$t',
                    style: TextStyle(
                      fontSize: 12,
                      color: scheme.primary,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
              ],
            ),
          ],
          const SizedBox(height: 20),
          // Contact seller (DM)
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: () {
                Navigator.pop(context);
                context.push('/chat/${listing.sellerPubkey}');
              },
              icon: const Icon(Icons.chat_bubble_outline_rounded),
              label: const Text('Message seller'),
            ),
          ),
        ],
      ),
    );
  }
}

class _ImageFallback extends StatelessWidget {
  final ColorScheme scheme;
  const _ImageFallback({required this.scheme});

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
      child: Center(
        child: Icon(Icons.storefront_rounded,
            color: Colors.white.withValues(alpha: 0.5), size: 40),
      ),
    );
  }
}

/// Create-listing sheet (NIP-99).
class _CreateListingSheet extends ConsumerStatefulWidget {
  const _CreateListingSheet();

  @override
  ConsumerState<_CreateListingSheet> createState() =>
      _CreateListingSheetState();
}

class _CreateListingSheetState extends ConsumerState<_CreateListingSheet> {
  final _titleCtrl = TextEditingController();
  final _summaryCtrl = TextEditingController();
  final _descCtrl = TextEditingController();
  final _imageCtrl = TextEditingController();
  final _locationCtrl = TextEditingController();
  final _priceCtrl = TextEditingController();
  final _currencyCtrl = TextEditingController(text: 'SAT');
  final _tagsCtrl = TextEditingController();
  bool _uploading = false;
  bool _publishing = false;

  @override
  void dispose() {
    _titleCtrl.dispose();
    _summaryCtrl.dispose();
    _descCtrl.dispose();
    _imageCtrl.dispose();
    _locationCtrl.dispose();
    _priceCtrl.dispose();
    _currencyCtrl.dispose();
    _tagsCtrl.dispose();
    super.dispose();
  }

  Future<void> _pickImage() async {
    final picker = ImagePicker();
    final file = await picker.pickImage(source: ImageSource.gallery, maxWidth: 2048);
    if (file == null || !mounted) return;
    setState(() => _uploading = true);
    try {
      final url = await ref.read(uploadProvider.notifier).uploadImage(file);
      if (!mounted) return;
      _imageCtrl.text = url;
      AppToast.success(context, 'Image uploaded');
    } catch (e) {
      if (mounted) AppToast.error(context, 'Upload failed: $e');
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  Future<void> _publish() async {
    final title = _titleCtrl.text.trim();
    if (title.isEmpty) {
      AppToast.warning(context, 'Enter a title');
      return;
    }
    setState(() => _publishing = true);
    try {
      final tags = _tagsCtrl.text
          .split(RegExp(r'[,\s]+'))
          .map((t) => t.trim().replaceAll(RegExp(r'^#'), ''))
          .where((t) => t.isNotEmpty)
          .toList();
      await ref.read(marketControllerProvider).createListing(
            title: title,
            description: _descCtrl.text.trim(),
            summary: _summaryCtrl.text.trim().isEmpty
                ? null
                : _summaryCtrl.text.trim(),
            image: _imageCtrl.text.trim().isEmpty
                ? null
                : _imageCtrl.text.trim(),
            location: _locationCtrl.text.trim().isEmpty
                ? null
                : _locationCtrl.text.trim(),
            priceAmount: _priceCtrl.text.trim().isEmpty
                ? null
                : _priceCtrl.text.trim(),
            priceCurrency: _currencyCtrl.text.trim().isEmpty
                ? 'SAT'
                : _currencyCtrl.text.trim().toUpperCase(),
            hashtags: tags,
          );
      if (!mounted) return;
      Navigator.pop(context);
      AppToast.success(context, 'Listing published');
    } catch (e) {
      if (mounted) AppToast.error(context, 'Publish failed: $e');
    } finally {
      if (mounted) setState(() => _publishing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Padding(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 8,
        bottom: MediaQuery.of(context).viewInsets.bottom + 20,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    'New Listing',
                    style: Theme.of(context)
                        .textTheme
                        .titleLarge
                        ?.copyWith(fontWeight: FontWeight.bold),
                  ),
                ),
                // Close button — bottom sheets must always be dismissible.
                IconButton(
                  icon: const Icon(Icons.close_rounded),
                  tooltip: 'Close',
                  onPressed: () => Navigator.pop(context),
                ),
              ],
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _titleCtrl,
              autofocus: true,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(
                labelText: 'Title',
                hintText: 'What are you selling?',
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _summaryCtrl,
              decoration: const InputDecoration(
                labelText: 'Summary (optional)',
                hintText: 'Short tagline',
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _descCtrl,
              maxLines: 3,
              decoration: const InputDecoration(
                labelText: 'Description',
                hintText: 'Details, condition, shipping…',
              ),
            ),
            const SizedBox(height: 12),
            // Price row
            Row(
              children: [
                Expanded(
                  flex: 2,
                  child: TextField(
                    controller: _priceCtrl,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(labelText: 'Price'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: TextField(
                    controller: _currencyCtrl,
                    textCapitalization: TextCapitalization.characters,
                    decoration: const InputDecoration(labelText: 'Currency'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            // Image: upload OR URL
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: TextField(
                    controller: _imageCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Image URL (optional)',
                    ),
                    keyboardType: TextInputType.url,
                    onChanged: (_) => setState(() {}),
                  ),
                ),
                _uploading
                    ? const Padding(
                        padding: EdgeInsets.all(10),
                        child: SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                      )
                    : IconButton(
                        icon: const Icon(Icons.add_photo_alternate_outlined),
                        tooltip: 'Upload image',
                        onPressed: _pickImage,
                      ),
              ],
            ),
            if (_imageCtrl.text.trim().isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(10),
                  child: Image.network(
                    _imageCtrl.text.trim(),
                    height: 90,
                    width: double.infinity,
                    fit: BoxFit.cover,
                    errorBuilder: (_, _, _) => const SizedBox.shrink(),
                  ),
                ),
              ),
            const SizedBox(height: 12),
            TextField(
              controller: _locationCtrl,
              decoration: const InputDecoration(
                labelText: 'Location (optional)',
                hintText: 'City, country',
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _tagsCtrl,
              decoration: const InputDecoration(
                labelText: 'Hashtags, comma separated (optional)',
              ),
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: _publishing ? null : _publish,
                icon: _publishing
                    ? SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: colorScheme.onPrimary,
                        ),
                      )
                    : const Icon(Icons.publish_rounded),
                label: const Text('Publish listing'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
