import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/config/env.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/features/memberships/data/membership_service.dart';
import 'package:nostrfeed_mobile/features/premium/application/premium_providers.dart';
import 'package:nostrfeed_mobile/features/studio/domain/subscription.dart';

final membershipServiceProvider = Provider<MembershipService>(
  (ref) => MembershipService(ref.watch(nostrServiceProvider)),
);

/// Whether the signed-in user may sell subscriptions. Studio features are
/// premium-only: a paid (non-generated, ACTIVE) name or lightning address.
final canSellMembershipsProvider = FutureProvider.autoDispose<bool>(
  (ref) => ref.watch(isPremiumProvider.future),
);

/// The tiers a creator offers, cheapest first.
final tiersProvider =
    FutureProvider.autoDispose.family<List<Tier>, String>((ref, creator) {
  return ref.watch(membershipServiceProvider).fetchTiers(creator);
});

/// The signed-in user's own tiers.
final myTiersProvider = FutureProvider.autoDispose<List<Tier>>((ref) {
  final auth = ref.watch(authStateProvider);
  final pubkey = auth.pubkey;
  if (pubkey == null) return const <Tier>[];
  return ref.watch(tiersProvider(pubkey).future);
});

/// Everyone on a tier and what it is worth, from validated receipts.
final tierStandingProvider =
    FutureProvider.autoDispose.family<TierStanding, Tier>((ref, tier) {
  return ref.watch(membershipServiceProvider).fetchTierStanding(tier);
});

/// Where the signed-in user stands on one tier.
final mySubscriptionProvider =
    FutureProvider.autoDispose.family<SubscriptionStatus, Tier>((ref, tier) {
  final auth = ref.watch(authStateProvider);
  final pubkey = auth.pubkey;
  if (pubkey == null) return SubscriptionStatus.none;
  return ref.watch(membershipServiceProvider).fetchSubscriptionStatus(tier, pubkey);
});

/// The creator's whole memberships dashboard: standings per tier + the
/// catalogue-wide summary.
final myMembershipsProvider =
    FutureProvider.autoDispose<({List<TierStanding> standings, MembershipSummary summary})>(
        (ref) async {
  final tiers = await ref.watch(myTiersProvider.future);
  final standings = await Future.wait(
    tiers.map((tier) => ref.watch(tierStandingProvider(tier).future)),
  );
  return (standings: standings, summary: summarizeMemberships(standings));
});

/// Publish (or replace) a tier. The `d` tag is the identity — the same slug
/// replaces, which is also how a tier is edited.
final publishTierProvider = Provider<
    Future<bool> Function({
      required String slug,
      required String title,
      required int amount,
      required Cadence cadence,
      String description,
      String? image,
      List<String> perks,
    })>((ref) {
  return ({
    required slug,
    required title,
    required amount,
    required cadence,
    description = '',
    image,
    perks = const [],
  }) async {
    final ok = await ref.read(membershipServiceProvider).publishTier(
          slug: slug,
          title: title,
          amount: amount,
          cadence: cadence,
          description: description,
          image: image,
          perks: perks,
        );
    final auth = ref.read(authStateProvider);
    final me = auth.pubkey;
    if (me != null) ref.invalidate(tiersProvider(me));
    return ok;
  };
});

/// Retire a tier: a NIP-09 deletion request for every revision of it.
final retireTierProvider =
    Provider<Future<bool> Function(Tier)>((ref) {
  return (tier) async {
    final ok = await ref.read(membershipServiceProvider).retireTier(tier);
    final auth = ref.read(authStateProvider);
    final me = auth.pubkey;
    if (me != null) ref.invalidate(tiersProvider(me));
    return ok;
  };
});

/// Subscribe: mint the zap invoice for a tier. The caller pays it
/// (`payWithAnyWallet`, QR fallback) — the receipt the creator's lightning
/// server publishes *is* the subscription.
final subscribeInvoiceProvider =
    Provider<Future<String?> Function(Tier)>((ref) {
  return (tier) async {
    final nostr = ref.read(nostrServiceProvider);
    if (!nostr.isInitialized) await nostr.init();
    // Receipts must land where the app actually reads: the connected relays,
    // falling back to the configured defaults.
    final connected = nostr.relayPool.connectedUrls;
    final relays = connected.isNotEmpty ? connected : Env.defaultRelays;
    return ref.read(membershipServiceProvider).buildSubscriptionInvoice(
          tier: tier,
          writeRelays: relays.take(8).toList(),
        );
  };
});
