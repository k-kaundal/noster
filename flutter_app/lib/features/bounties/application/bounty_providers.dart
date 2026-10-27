import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';

/// Bounties — NIP-99 classified listings (kind 30402) that carry a `t:
/// bounty` tag, newest first. A bounty is a classified listing whose price
/// is the reward; the `bounty` hashtag keeps them out of the general market.
///
/// Delegates to the core keepAlive+TTL+store-first `marketProvider` (the
/// same kind-30402 dataset, already warm) — the old autoDispose provider
/// re-fetched the whole market listing set on every visit just to filter it.
final bountiesProvider = FutureProvider<List<NostrEvent>>((ref) async {
  final events = await ref.watch(marketProvider.future);
  // Dedupe by d tag (addressable — newest version wins), active + bounty-
  // tagged only.
  final byD = <String, NostrEvent>{};
  for (final e in events) {
    final d = e.getTag('d') ?? '';
    final existing = byD[d];
    if (existing == null || e.createdAt > existing.createdAt) byD[d] = e;
  }
  final bounties =
      byD.values
          .where(
            (e) =>
                e.getTag('status') != 'sold' &&
                e.getTags('t').any((t) => t.toLowerCase() == 'bounty'),
          )
          .toList()
        ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
  return bounties;
});

/// Publishes a bounty as a NIP-99 listing tagged `bounty`, with the reward
/// as its price in sats.
class BountyController {
  final Ref _ref;
  BountyController(this._ref);

  Future<void> createBounty({
    required String title,
    required String description,
    required int rewardSats,
  }) async {
    final nostr = _ref.read(nostrServiceProvider);
    final slug = title
        .toLowerCase()
        .replaceAll(RegExp(r'[^a-z0-9]+'), '-')
        .replaceAll(RegExp(r'^-+|-+$'), '');
    final event = nostr.createListing(
      dTag: slug.isEmpty
          ? 'bounty-${DateTime.now().millisecondsSinceEpoch}'
          : 'bounty-$slug',
      title: title,
      description: description,
      priceAmount: '$rewardSats',
      priceCurrency: 'SATS',
      hashtags: const ['bounty'],
    );
    await nostr.publishEvent(event);
    _ref.invalidate(marketProvider);
    _ref.invalidate(bountiesProvider);
  }
}

final bountyControllerProvider = Provider<BountyController>(
  (ref) => BountyController(ref),
);
