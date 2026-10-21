import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/features/wallet/services/wallet_tools_service.dart';

final walletToolsServiceProvider = Provider<WalletToolsService>(
  (ref) => WalletToolsService(),
);

/// Whether an optional extension is installed on the server, family-keyed by
/// ext id. null = probe failed (treat as available-but-don't-crash).
final extensionInstalledProvider =
    FutureProvider.autoDispose.family<bool?, String>((ref, extId) {
  return ref.watch(walletToolsServiceProvider).isExtensionInstalled(extId);
});

/// sats → "≈ $X" for the given currency, or null when no rate is available.
final satsAsFiatProvider =
    FutureProvider.autoDispose.family<String?, (int, String)>((ref, args) {
  return ref
      .watch(walletToolsServiceProvider)
      .describeSatsAsFiat(args.$1, args.$2);
});
