import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/features/market/domain/listing.dart';

/// All active NIP-99 listings (kind 30402), newest first.
final listingsProvider = FutureProvider.autoDispose<List<Listing>>((ref) async {
  final nostr = ref.read(nostrServiceProvider);
  if (!nostr.isInitialized) await nostr.init();
  final events = await nostr.fetchMarketListings(limit: 100);
  // Dedupe by d tag (addressable — newest version wins), active only.
  final byD = <String, NostrEvent>{};
  for (final e in events) {
    final d = e.getTag('d') ?? '';
    final existing = byD[d];
    if (existing == null || e.createdAt > existing.createdAt) byD[d] = e;
  }
  final listings = byD.values
      .map(Listing.fromEvent)
      .where((l) => l.isActive)
      .toList()
    ..sort((a, b) => b.publishedAt.compareTo(a.publishedAt));
  return listings;
});

/// Listings by the current user ("My listings").
final myListingsProvider = FutureProvider.autoDispose<List<Listing>>((ref) async {
  final auth = ref.watch(authStateProvider);
  if (!auth.isLoggedIn || auth.pubkey == null) return [];
  final all = await ref.watch(listingsProvider.future);
  return all.where((l) => l.sellerPubkey == auth.pubkey).toList();
});

/// P2P trade orders (NIP-69 kind 38383), pending first.
final p2pOrdersProvider =
    FutureProvider.autoDispose<List<NostrEvent>>((ref) async {
  final nostr = ref.read(nostrServiceProvider);
  if (!nostr.isInitialized) await nostr.init();
  return nostr.fetchP2POrders(limit: 100);
});

/// Controller for listing + order creation.
class MarketController {
  final Ref _ref;
  MarketController(this._ref);

  Future<void> createListing({
    required String title,
    required String description,
    String? summary,
    String? image,
    String? location,
    String? priceAmount,
    String? priceCurrency,
    String? priceFrequency,
    List<String> hashtags = const [],
  }) async {
    final nostr = _ref.read(nostrServiceProvider);
    final dTag = title
        .toLowerCase()
        .replaceAll(RegExp(r'[^a-z0-9]+'), '-')
        .replaceAll(RegExp(r'^-+|-+$'), '');
    final event = nostr.createListing(
      dTag: dTag.isEmpty ? 'listing-${DateTime.now().millisecondsSinceEpoch}' : dTag,
      title: title,
      description: description,
      summary: summary,
      image: image,
      location: location,
      priceAmount: priceAmount,
      priceCurrency: priceCurrency,
      priceFrequency: priceFrequency,
      hashtags: hashtags,
    );
    await nostr.publishEvent(event);
    _ref.invalidate(listingsProvider);
    _ref.invalidate(myListingsProvider);
  }

  Future<void> createOrder({
    required String type,
    required String currency,
    String? amountSats,
    String? fiatAmount,
    List<String> paymentMethods = const [],
    String? premium,
    String? makerName,
  }) async {
    final nostr = _ref.read(nostrServiceProvider);
    final event = nostr.createP2POrder(
      type: type,
      currency: currency,
      amountSats: amountSats,
      fiatAmount: fiatAmount,
      paymentMethods: paymentMethods,
      premium: premium,
      makerName: makerName,
    );
    await nostr.publishEvent(event);
    _ref.invalidate(p2pOrdersProvider);
  }
}

final marketControllerProvider = Provider<MarketController>(
  (ref) => MarketController(ref),
);
