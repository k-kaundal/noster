import 'package:nostrfeed_mobile/core/config/env.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/nostr/kinds.dart';
import 'package:nostrfeed_mobile/core/nostr/nostr_service.dart';
import 'package:nostrfeed_mobile/features/boost/domain/boost.dart';
import 'package:nostrfeed_mobile/features/wallet/data/lnurl_service.dart';

/// Relay-side plumbing for boosts: who the platform is (for receipt
/// verification) and every boost receipt ever published.
///
/// The platform identity is two compile-time constants (Env):
///  * [Env.operatorPubkey] — the pubkey boosts are zapped TO. The same key
///    that signs the operator config note; boosts are value to the operator.
///  * [Env.platformLightningAddress] — the lightning address boosts are
///    paid to. Its lnurl metadata's `nostrPubkey` is the provider key that
///    signs genuine boost receipts — resolved ONCE at runtime and cached.
class BoostService {
  final NostrService _nostr;

  BoostService(this._nostr);

  BoostSource? _cachedSource;

  /// The verification pair for [readBoost]: platform pubkey + the provider
  /// key from the platform's own lnurl metadata. Null when the platform's
  /// lightning address can't be resolved (offline / misconfigured) — in
  /// which case NO boosts are honored, because the provider check is the
  /// only thing that makes a boost unforgeable.
  Future<BoostSource?> resolveSource() async {
    final cached = _cachedSource;
    if (cached != null) return cached;
    if (Env.operatorPubkey.isEmpty || Env.platformLightningAddress.isEmpty) {
      return null;
    }
    final info = await resolveLnurlPay(Env.platformLightningAddress);
    final providerKey = info?.nostrPubkey;
    if (info == null || !info.allowsNostr || providerKey == null) {
      return null;
    }
    final source = BoostSource(
      platformPubkey: Env.operatorPubkey,
      providerPubkey: providerKey,
    );
    _cachedSource = source;
    return source;
  }

  /// Fetches zap receipts addressed to the platform pubkey and reads the
  /// valid boosts out of them, strongest first.
  ///
  /// Receipts live on ordinary relays (they're ordinary 9735s) — query the
  /// user's own pool plus the public receipt relays, since boosters publish
  /// wherever their zap flow publishes.
  Future<List<Boost>> fetchBoosts({int limit = 200}) async {
    final source = await resolveSource();
    if (source == null) return const [];

    final receipts = await _nostr.relayPool.query([
      NostrFilter(
        kinds: [NostrKinds.zapReceipt],
        pTags: [Env.operatorPubkey],
        limit: limit,
      ),
    ], timeout: const Duration(seconds: 8));

    final seen = <String>{};
    final boosts = <Boost>[];
    for (final receipt in receipts) {
      // Dedup on the receipt id — the same receipt arrives from every relay
      // that holds it; reading per copy multiplies spend that happened once.
      if (!seen.add(receipt.id)) continue;
      final boost = readBoost(receipt, source);
      if (boost != null) boosts.add(boost);
    }
    return boosts;
  }

  /// Fetches the note events for a set of boosts (the notes being promoted),
  /// in boost order. Notes that can't be fetched (deleted, unknown to the
  /// user's relays) are skipped — a boost on an unfetchable note is not a
  /// placement.
  Future<List<NostrEvent>> fetchBoostedNotes(List<Boost> boosts) async {
    if (boosts.isEmpty) return const [];
    final ids = boosts.map((b) => b.noteId).toList();
    final events = await _nostr.relayPool.query([
      NostrFilter(ids: ids, limit: ids.length),
    ], timeout: const Duration(seconds: 6));
    final byId = {for (final e in events) e.id: e};
    return [
      for (final b in boosts)
        if (byId[b.noteId] != null) byId[b.noteId]!,
    ];
  }

  /// Drops boosted notes the content filter would hide — a paid slot never
  /// bypasses moderation.
  List<NostrEvent> filterBoostable(
    List<NostrEvent> notes, {
    required bool Function(NostrEvent event) isHidden,
  }) {
    return notes.where((e) => !isHidden(e)).toList();
  }
}
