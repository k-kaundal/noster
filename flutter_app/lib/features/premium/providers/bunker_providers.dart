import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/features/premium/providers/premium_providers.dart';
import 'package:nostrfeed_mobile/features/premium/services/bunker_service.dart';
import 'package:nostrfeed_mobile/features/wallet/providers/lnbits_providers.dart';
import 'package:nostrfeed_mobile/features/wallet/providers/wallet_tools_providers.dart';

final bunkerServiceProvider = Provider<BunkerService>(
  (ref) => BunkerService(),
);

/// Whether the nostr_bunker extension is installed on the server.
final bunkerAvailableProvider = FutureProvider.autoDispose<bool>((ref) {
  return ref
          .watch(extensionInstalledProvider(BunkerService.extId).future)
          .then((v) => v ?? false);
});

/// Whether the signed-in user may use the bunker: it is a PREMIUM feature
/// (gated on the same entitlement as the paid relay) on an enabled server.
final canUseBunkerProvider = FutureProvider.autoDispose<bool>((ref) async {
  final premium = await ref.watch(isPremiumProvider.future);
  if (!premium) return false;
  return ref.watch(bunkerAvailableProvider.future);
});

/// The user's stored bunker keys + their connection URLs.
final bunkerKeysProvider =
    FutureProvider.autoDispose<List<BunkerKey>>((ref) async {
  final canUse = await ref.watch(canUseBunkerProvider.future);
  if (!canUse) return [];
  final token = ref.watch(lnbitsAuthProvider).token;
  if (token == null) return [];
  return ref.watch(bunkerServiceProvider).listKeys(token: token);
});
