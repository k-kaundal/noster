import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/providers/nostr_service_providers.dart';
import 'package:nostrfeed_mobile/features/ai/data/ai_chat_store.dart';
import 'package:nostrfeed_mobile/features/ai/data/ai_config_service.dart';
import 'package:nostrfeed_mobile/features/ai/data/ai_credits_service.dart';
import 'package:nostrfeed_mobile/features/ai/data/ai_gateway_service.dart';
import 'package:nostrfeed_mobile/features/ai/data/ai_trial_store.dart';
import 'package:nostrfeed_mobile/features/ai/domain/ai_credits.dart';
import 'package:nostrfeed_mobile/features/ai/domain/ai_gateway.dart';
import 'package:nostrfeed_mobile/features/wallet/application/wallet_tools_providers.dart';

// ── Services ──────────────────────────────────────────────────────────────

final aiGatewayServiceProvider = Provider<AiGatewayService>(
  (ref) => AiGatewayService(),
);

final aiConfigServiceProvider = Provider<AiConfigService>(
  (ref) => AiConfigService(ref.watch(nostrServiceProvider)),
);

final aiCreditsServiceProvider = Provider<AiCreditsService>(
  (ref) => AiCreditsService(),
);

final aiChatStoreProvider = Provider<AiChatStore>(
  (ref) => AiChatStore(),
);

final aiTrialStoreProvider = Provider<AiTrialStore>(
  (ref) => AiTrialStore(),
);

// ── Gateway config (providers + models + economics) ───────────────────────

/// Live AI gateway config: built-in defaults → disk cache → operator's
/// Nostr config note (kind 30078). KeepAlive so the picker doesn't refetch.
final aiGatewayConfigProvider = FutureProvider<AiGatewayConfig>(
  (ref) => ref.watch(aiConfigServiceProvider).load(),
);

/// True when the feature is on AND at least one provider has a key.
final aiAvailableProvider = Provider<bool>((ref) {
  final config = ref.watch(aiGatewayConfigProvider).value;
  if (config == null || !config.enabled) return false;
  final gateway = ref.watch(aiGatewayServiceProvider);
  return config.providers.any(gateway.isProviderConfigured);
});

/// The user's picked model id (null = not chosen yet → resolver picks a
/// default). Kept separate from resolution so `build()` never reads
/// `state` (illegal in Riverpod — "uninitialized provider" crash).
final aiSelectedModelIdProvider =
    NotifierProvider<AiSelectedModelIdNotifier, String?>(
  AiSelectedModelIdNotifier.new,
);

class AiSelectedModelIdNotifier extends Notifier<String?> {
  @override
  String? build() => null;

  void select(String modelId) => state = modelId;
}

/// The resolved selected model: the user's pick when it's still visible,
/// else the first trial-eligible model, else the first visible one.
final aiSelectedModelProvider = Provider<AiModelEntry?>((ref) {
  final config = ref.watch(aiGatewayConfigProvider).value;
  if (config == null) return null;
  final visible = config.visibleModels;
  if (visible.isEmpty) return null;
  final chosen = ref.watch(aiSelectedModelIdProvider);
  if (chosen != null) {
    for (final m in visible) {
      if (m.id == chosen) return m;
    }
  }
  final trial = visible.where((m) => m.trialEligible);
  return trial.isNotEmpty ? trial.first : visible.first;
});

// ── Fiat rate (sats per USD) — drives per-model sats pricing ─────────────

/// Sats per 1 USD from the wallet-tools rate API; falls back to a sane
/// constant (~$90k BTC) when the rate endpoint is unreachable.
final aiSatsPerUsdProvider = FutureProvider<double>((ref) async {
  final tools = ref.watch(walletToolsServiceProvider);
  final rate = await tools.fiatRate('USD');
  if (rate != null && rate > 0) {
    // The rate endpoint returns the PRICE of 1 BTC in fiat.
    // sats per USD = 100,000,000 / btcUsdPrice.
    return 1e8 / rate;
  }
  return 1111; // ≈ $90k/BTC fallback
});

/// Price estimate (sats) for a model — shown on its picker chip.
final aiModelPriceProvider =
    Provider.family<int, AiModelEntry>((ref, model) {
  final config = ref.watch(aiGatewayConfigProvider).value;
  final satsPerUsd = ref.watch(aiSatsPerUsdProvider).value ?? 1111;
  if (config == null) return 1;
  return config.estimatePriceSats(model, satsPerUsd: satsPerUsd);
});

// ── Free-pool quota (OpenRouter only, best effort) ───────────────────────

final aiFreeQuotaProvider = FutureProvider.autoDispose<AiFreeQuota?>(
  (ref) {
    final config = ref.watch(aiGatewayConfigProvider).value;
    if (config == null) return null;
    final gateway = ref.watch(aiGatewayServiceProvider);
    final provider = config.provider('openrouter');
    if (provider == null) return null;
    return gateway.fetchFreeQuota(provider);
  },
);

// ── Credits ───────────────────────────────────────────────────────────────

final aiCreditsProvider =
    AsyncNotifierProvider<AiCreditsNotifier, AiCreditsLedger>(
  AiCreditsNotifier.new,
);

class AiCreditsNotifier extends AsyncNotifier<AiCreditsLedger> {
  @override
  Future<AiCreditsLedger> build() {
    return ref.watch(aiCreditsServiceProvider).load();
  }

  Future<void> credit(int sats) async {
    final current = state.value ?? const AiCreditsLedger();
    final next = current.credit(sats);
    state = AsyncData(next);
    await ref.read(aiCreditsServiceProvider).save(next);
  }

  /// Grants credits for a confirmed payment and records its hash so
  /// reconciliation never double-credits it.
  Future<void> creditPayment(int sats, String paymentHash) async {
    await ref.read(aiCreditsServiceProvider).markCredited(paymentHash);
    await credit(sats);
  }

  /// Deducts [sats]; returns false when the balance can't cover it.
  Future<bool> debit(int sats) async {
    final current = state.value ?? const AiCreditsLedger();
    if (!current.canAfford(sats)) return false;
    final next = current.debit(sats);
    state = AsyncData(next);
    await ref.read(aiCreditsServiceProvider).save(next);
    return true;
  }

  /// Grants credits for top-ups found in the house-wallet history that
  /// this device hasn't credited yet (payments from other devices or a
  /// reinstall). Returns the granted amount, or null on lookup failure.
  Future<int?> reconcile(String pubkey) async {
    final granted =
        await ref.read(aiCreditsServiceProvider).reconcile(pubkey);
    if (granted == null || granted == 0) return granted;
    await credit(granted);
    return granted;
  }
}

// ── Trial ─────────────────────────────────────────────────────────────────

final aiTrialUsedProvider =
    AsyncNotifierProvider<AiTrialNotifier, int>(AiTrialNotifier.new);

class AiTrialNotifier extends AsyncNotifier<int> {
  @override
  Future<int> build() => ref.watch(aiTrialStoreProvider).usedToday();

  Future<void> increment() async {
    state = AsyncData(await ref.read(aiTrialStoreProvider).increment());
  }
}

/// Free trial messages remaining today.
final aiTrialRemainingProvider = Provider<int>((ref) {
  final used = ref.watch(aiTrialUsedProvider).value ?? 0;
  final config = ref.watch(aiGatewayConfigProvider).value;
  final perDay = config?.freeTrialPerDay ?? 5;
  final remaining = perDay - used;
  return remaining > 0 ? remaining : 0;
});

/// Can the user send one more message on [model] right now?
final aiCanSendProvider = Provider.family<bool, AiModelEntry>((ref, model) {
  final price = ref.watch(aiModelPriceProvider(model));
  final balance = ref.watch(aiCreditsProvider).value?.balance ?? 0;
  final trialLeft = ref.watch(aiTrialRemainingProvider);
  return balance >= price || (model.trialEligible && trialLeft > 0);
});
