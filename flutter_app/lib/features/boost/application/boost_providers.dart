import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/moderation/content_filter.dart';
import 'package:nostrfeed_mobile/core/moderation/moderation_providers.dart';
import 'package:nostrfeed_mobile/core/providers/nostr_service_providers.dart';
import 'package:nostrfeed_mobile/features/boost/application/boost_purchase.dart';
import 'package:nostrfeed_mobile/features/boost/data/boost_service.dart';
import 'package:nostrfeed_mobile/features/boost/domain/boost.dart';

final boostServiceProvider = Provider<BoostService>(
  (ref) => BoostService(ref.watch(nostrServiceProvider)),
);

/// The verification pair (platform + provider pubkeys), resolved once.
final boostSourceProvider = FutureProvider<BoostSource?>(
  (ref) => ref.watch(boostServiceProvider).resolveSource(),
);

/// Whether paid boosts are configured in this build at all (the feature
/// hides itself entirely when the platform has no zap-enabled address).
final boostAvailableProvider = FutureProvider<bool>((ref) async {
  final source = await ref.watch(boostSourceProvider.future);
  return source != null;
});

/// All valid boosts read from relays (validated receipts only), newest
/// first by receipt time. KeepAlive — the explore screen refreshes it on
/// pull-to-refresh; individual screens shouldn't refetch per scroll.
final boostReceiptsProvider = FutureProvider<List<Boost>>(
  (ref) => ref.watch(boostServiceProvider).fetchBoosts(),
);

/// The boosts currently in force — one per note, strongest first.
final activeBoostsProvider = Provider<AsyncValue<List<Boost>>>((ref) {
  return ref.watch(boostReceiptsProvider).whenData(activeBoosts);
});

/// Is this note boosted right now? Drives the "⚡ Boosted" chip on cards.
final isBoostedProvider = Provider.family<bool, String>((ref, noteId) {
  final boosts = ref.watch(activeBoostsProvider).valueOrNull ?? const [];
  return boosts.any((b) => b.noteId == noteId);
});

/// Places promoted notes into an organic timeline per the placement rules
/// (10% max share, 1-per-8 spacing, no stacking, move-not-duplicate).
///
/// Fetches the boosted note events the relays know about, then slots them
/// into the organic list. Notes that can't be fetched or that fail the
/// content filter are dropped — a paid slot never bypasses moderation.
final boostedFeedProvider = FutureProvider.autoDispose
    .family<PlacedFeed, List<NostrEvent>>((ref, organic) async {
      final boosts = ref.watch(activeBoostsProvider).valueOrNull;
      if (boosts == null || boosts.isEmpty) {
        return PlacedFeed(organic, const {});
      }
      final service = ref.watch(boostServiceProvider);
      final notes = await service.fetchBoostedNotes(boosts);
      if (notes.isEmpty) return PlacedFeed(organic, const {});

      // Moderation: a boosted note that would be hidden organically loses
      // its slot. Payment buys eligible reach, never unfiltered reach.
      // (contentFilterProvider directly — filteredEventVerdict's WidgetRef
      // signature is widget-side; this provider is not.)
      final filter = ref.watch(contentFilterProvider);
      final visible = service.filterBoostable(
        notes,
        isHidden: (e) =>
            filter.verdictForEvent(e).action == FilterAction.hide,
      );
      if (visible.isEmpty) return PlacedFeed(organic, const {});
      return placeBoosted(organic, visible);
    });

final boostPurchaseProvider =
    NotifierProvider<BoostPurchaseNotifier, BoostPurchaseState>(
  BoostPurchaseNotifier.new,
);
