import 'package:nostrfeed_mobile/core/models/nostr_models.dart';

/// NIP-99 classified listing (kind 30402, addressable).
class Listing {
  final String id;
  final String dTag;
  final String title;
  final String summary;
  final String description; // markdown content
  final String? image;
  final String? location;
  final ListingPrice? price;
  final String status; // 'active' | 'sold' | 'draft'
  final List<String> hashtags;
  final String sellerPubkey;
  final int publishedAt;

  const Listing({
    required this.id,
    required this.dTag,
    required this.title,
    this.summary = '',
    this.description = '',
    this.image,
    this.location,
    this.price,
    this.status = 'active',
    this.hashtags = const [],
    required this.sellerPubkey,
    required this.publishedAt,
  });

  factory Listing.fromEvent(NostrEvent event) {
    ListingPrice? price;
    for (final tag in event.tags) {
      if (tag.isNotEmpty && tag[0] == 'price' && tag.length >= 3) {
        price = ListingPrice(
          amount: tag[1],
          currency: tag[2],
          frequency: tag.length > 3 ? tag[3] : null,
        );
        break;
      }
    }
    String? image;
    for (final tag in event.tags) {
      if (tag.isNotEmpty && tag[0] == 'image' && tag.length > 1) {
        image = tag[1];
        break;
      }
    }
    return Listing(
      id: event.id,
      dTag: event.getTag('d') ?? '',
      title: sanitizeText(event.getTag('title')).isEmpty
          ? 'Untitled'
          : sanitizeText(event.getTag('title')),
      summary: sanitizeText(event.getTag('summary')),
      description: event.content,
      image: image,
      location: event.getTag('location'),
      price: price,
      status: event.getTag('status') ??
          (event.kind == 30403 ? 'draft' : 'active'),
      hashtags: event.hashtags,
      sellerPubkey: event.pubkey,
      publishedAt: int.tryParse(event.getTag('published_at') ?? '') ??
          event.createdAt,
    );
  }

  String get coordinate => '30402:$sellerPubkey:$dTag';
  bool get isActive => status == 'active';
}

class ListingPrice {
  final String amount;
  final String currency; // ISO 4217 or 'SAT'/'btc'
  final String? frequency; // 'month', 'year', etc.

  const ListingPrice({
    required this.amount,
    required this.currency,
    this.frequency,
  });

  String get display {
    final cur = currency.toUpperCase() == 'SAT' || currency.toLowerCase() == 'btc'
        ? 'sats'
        : currency.toUpperCase();
    final freq = frequency != null ? '/$frequency' : '';
    return '$amount $cur$freq';
  }
}
