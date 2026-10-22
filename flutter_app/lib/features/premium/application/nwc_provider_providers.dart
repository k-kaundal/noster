import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/features/premium/application/premium_providers.dart';
import 'package:nostrfeed_mobile/features/premium/data/nwc_provider_service.dart';
import 'package:nostrfeed_mobile/features/wallet/application/lnbits_providers.dart';
import 'package:nostrfeed_mobile/features/wallet/application/wallet_tools_providers.dart';

final nwcProviderServiceProvider = Provider<NwcProviderService>(
  (ref) => NwcProviderService(),
);

/// Whether the nwcprovider extension is installed on the server.
final nwcProviderAvailableProvider = FutureProvider.autoDispose<bool>((ref) {
  return ref
          .watch(extensionInstalledProvider(NwcProviderService.extId).future)
          .then((v) => v ?? false);
});

/// Whether the signed-in user may use the NWC provider (premium + installed).
final canUseNwcProviderProvider = FutureProvider.autoDispose<bool>((ref) async {
  final premium = await ref.watch(isPremiumProvider.future);
  if (!premium) return false;
  return ref.watch(nwcProviderAvailableProvider.future);
});

/// The connections the user has registered.
final nwcConnectionsProvider =
    FutureProvider.autoDispose<List<NwcProviderConnection>>((ref) async {
  final canUse = await ref.watch(canUseNwcProviderProvider.future);
  if (!canUse) return [];
  final token = ref.watch(lnbitsAuthProvider).token;
  if (token == null) return [];
  return ref.watch(nwcProviderServiceProvider).listConnections(token: token);
});
