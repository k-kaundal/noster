import 'dart:convert';

import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/nostr/nostr_service.dart';
import 'package:nostrfeed_mobile/core/nostr/usecases/zap_receipts.dart';
import 'package:nostrfeed_mobile/features/studio/domain/subscription.dart';
import 'package:nostrfeed_mobile/features/wallet/data/lnurl_service.dart';

/// The relay queries and payments behind memberships. Port of the web's
/// `hooks/useSubscriptions.ts` behaviour: a subscription is a *zap to a
/// tier* — the receipt is the subscription, so everything here either
/// fetches receipts or produces one.
class MembershipService {
  final NostrService nostr;
  const MembershipService(this.nostr);

  /// Every tier a creator offers (kind 37001, newest revision per slug).
  Future<List<Tier>> fetchTiers(String creator) async {
    final events = await nostr.relayPool.query(
      [
        NostrFilter(kinds: [tierKind], authors: [creator], limit: 50),
      ],
      timeout: const Duration(seconds: 8),
    );
    return rankTiers(events);
  }

  /// Receipts naming a tier, deduplicated on the receipt id. A subscriber's
  /// client chooses the relays, so no single relay holds them all — the pool
  /// asks every connected one.
  Future<List<NostrEvent>> fetchTierReceipts(Tier tier) async {
    final receipts = await nostr.relayPool.query(
      [
        NostrFilter(kinds: [zapReceiptKind], aTags: [tierAddress(tier)], limit: 200),
      ],
      timeout: const Duration(seconds: 8),
    );

    final seen = <String>{};
    return receipts.where((r) => seen.add(r.id)).toList();
  }

  /// Who is on a tier and what it is worth, from one validation pass over
  /// the receipts. `providerPolicy: 'require'` matches the web: a receipt
  /// the creator's own lightning server did not sign is refused outright,
  /// because these figures gate real perks.
  Future<TierStanding> fetchTierStanding(Tier tier) async {
    final receipts = await fetchTierReceipts(tier);
    final summary = summarizeZaps(
      receipts,
      check: ReceiptCheck(
        address: [tierAddress(tier)],
        recipientPubkey: [tier.creator],
      ),
      providerPolicy: 'require',
    );
    return tierStanding(tier, summary.zappers);
  }

  /// The signed-in user's standing on one tier.
  Future<SubscriptionStatus> fetchSubscriptionStatus(
    Tier tier,
    String subscriber,
  ) async {
    final standing = await fetchTierStanding(tier);
    final member = standing.members.where((m) => m.pubkey == subscriber);
    if (member.isEmpty) return SubscriptionStatus.none;
    return member.first.status;
  }

  /// Publish (or replace) a tier. The `d` tag is the identity — same slug
  /// replaces, which is also how a tier is edited.
  Future<bool> publishTier({
    required String slug,
    required String title,
    required int amount,
    required Cadence cadence,
    String description = '',
    String? image,
    List<String> perks = const [],
  }) {
    final event = nostr.createEvent(
      kind: tierKind,
      content: description,
      tags: buildTierTags(
        slug: slug,
        title: title,
        amount: amount,
        cadence: cadence,
        description: description,
        image: image,
        perks: perks,
      ),
    );
    return nostr.publishEvent(event);
  }

  /// Retire a tier: a NIP-09 deletion request for every revision of it.
  Future<bool> retireTier(Tier tier) {
    final event = nostr.createEvent(
      kind: 5,
      content: 'Tier retired',
      tags: [
        ['a', tierAddress(tier)],
      ],
    );
    return nostr.publishEvent(event);
  }

  /// Subscribe: a NIP-57 zap whose request `a`-tags the tier.
  ///
  /// The receipt the creator's lightning server publishes is the
  /// subscription — anyone can later read standing from it. Returns the
  /// bolt11 invoice to pay, or null when the creator cannot be zapped
  /// (no lightning address, or their server refuses Nostr zaps).
  Future<String?> buildSubscriptionInvoice({
    required Tier tier,
    required List<String> writeRelays,
  }) async {
    final profile = await nostr.fetchProfile(tier.creator);
    final address = profile?.lud16 ?? profile?.lud06;
    if (address == null || !address.contains('@')) return null;

    final info = await resolveLnurlPay(address);
    if (info == null || !info.allowsNostr) return null;

    // Whole sats only — the tier price already is one, and the period is
    // bought by a single payment covering it (smaller payments are tips).
    final amountMsat = tier.amount * 1000;

    final request = nostr.createEvent(
      kind: zapRequestKind,
      content: 'Subscribe to ${tier.title}',
      tags: [
        ['relays', ...writeRelays],
        ['amount', '$amountMsat'],
        ['p', tier.creator],
        ['a', tierAddress(tier)],
      ],
    );

    return fetchInvoice(
      info: info,
      sats: tier.amount,
      comment: 'Subscribe to ${tier.title}',
      zapRequestJson: jsonEncode(request.toJson()),
    );
  }
}
