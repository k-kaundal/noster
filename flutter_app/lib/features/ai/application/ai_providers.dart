import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/providers/auth_providers.dart';
import 'package:nostrfeed_mobile/core/providers/nostr_service_providers.dart';
import 'package:nostrfeed_mobile/features/ai/data/ai_chat_store.dart';
import 'package:nostrfeed_mobile/features/ai/data/ai_config_service.dart';
import 'package:nostrfeed_mobile/features/ai/data/ai_context_service.dart';
import 'package:nostrfeed_mobile/features/ai/data/ai_credits_backup_service.dart';
import 'package:nostrfeed_mobile/features/ai/data/ai_credits_service.dart';
import 'package:nostrfeed_mobile/features/ai/data/ai_exchange_rate_service.dart';
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

/// Fetches Nostr context (notes, threads, hashtags, profiles) from relays
/// so the assistant can actually summarize/discuss relay content.
final aiContextServiceProvider = Provider<AiContextService>(
  (ref) => AiContextService(ref.watch(nostrServiceProvider)),
);

final aiCreditsServiceProvider = Provider<AiCreditsService>(
  (ref) => AiCreditsService(),
);

/// The relay backup mirror — credits follow the user's key across devices
/// (NIP-44 self-encrypted kind-30078). Best-effort: every mutation also
/// publishes a backup, every build merges the remote copy in.
final aiCreditsBackupServiceProvider = Provider<AiCreditsBackupService>(
  (ref) => AiCreditsBackupService(ref.watch(nostrServiceProvider)),
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

final aiExchangeRateServiceProvider = Provider<AiExchangeRateService>(
  (ref) => AiExchangeRateService(ref.watch(walletToolsServiceProvider)),
);

/// Offline fallback when no live rate has EVER been fetched (first launch,
/// no network). Intentionally on the HIGH side of the recent range — a low
/// fallback sells sats below cost on a BTC pump (the operator loses), a high
/// one just quotes a slightly conservative price until the first fetch.
/// After any successful fetch the disk cache replaces this.
const kFallbackSatsPerUsd = 1250.0; // ≈ $80k/BTC

/// The LIVE sats-per-USD rate, re-fetched every 10 minutes while watched.
/// Chain: live (house LNbits rate → mempool.space) → disk cache → constant.
/// Every chip price, reserve and settlement flows through this, so AI prices
/// track the real exchange rate instead of a hardcoded one.
final aiSatsPerUsdProvider = FutureProvider<double>((ref) async {
  // Auto-refresh: re-run the fetch chain 10 min after each evaluation.
  final timer = Timer(
    const Duration(minutes: 10),
    () => ref.invalidateSelf(),
  );
  ref.onDispose(timer.cancel);

  final service = ref.watch(aiExchangeRateServiceProvider);
  final live = await service.fetchSatsPerUsd();
  if (live != null && live > 0) return live;
  final cached = await service.loadCached();
  if (cached != null && cached > 0) return cached;
  return kFallbackSatsPerUsd;
});

/// Price estimate (TOKENS) for a model — shown on its picker chip.
/// Dollar-pegged: no exchange rate involved, the price is stable.
final aiModelPriceProvider =
    Provider.family<int, AiModelEntry>((ref, model) {
  final config = ref.watch(aiGatewayConfigProvider).value;
  if (config == null) return 1;
  return config.estimatePriceTokens(model);
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
    // Startup reconcile (the "credits 0 after restart" fix): credits bought
    // on another device, or granted while this device was offline, land
    // without a restart. The SERVICE credits the ledger atomically with the
    // payment-hash recording — crediting here would double-grant (and the
    // old version recorded the hashes but discarded the grant, which was
    // the "payment done, credits still 0" bug).
    final pubkey = ref.read(authStateProvider).pubkey;
    if (pubkey != null && pubkey.isNotEmpty) {
      // Awaited: the first build returns the RECONCILED balance, so the
      // wallet/AI screens never flash the stale local one. The live rate is
      // passed so a recovered top-up grants its true current dollar value.
      return ref
          .read(aiCreditsServiceProvider)
          .reconcile(pubkey, satsPerUsd: ref.read(aiSatsPerUsdProvider).value)
          .then((_) => _mergedWithBackup())
          .catchError((_) => ref.read(aiCreditsServiceProvider).load());
    }
    return _mergedWithBackup()
        .catchError((_) => ref.read(aiCreditsServiceProvider).load());
  }

  /// Local ledger merged with the relay backup (union semantics — a merge
  /// can never lose a purchase or resurrect a spend). If the remote copy
  /// wins (this device is fresh / behind), it's persisted locally too.
  Future<AiCreditsLedger> _mergedWithBackup() async {
    final service = ref.read(aiCreditsServiceProvider);
    final local = await service.load();
    final backup = ref.read(aiCreditsBackupServiceProvider);
    if (!backup.canBackup) return local;
    final remote = await backup.restore();
    if (remote == null) return local;
    final merged = local.mergeWith(remote);
    // Persist whenever the merge moved the ledger forward (fresh device
    // restoring from relay, or a remote spend caught up locally).
    if (merged.totalPurchased != local.totalPurchased ||
        merged.totalSpent != local.totalSpent ||
        merged.balance != local.balance) {
      await service.save(merged);
    }
    return merged;
  }

  /// Mirrors the current ledger to the relay backup. Fire-and-forget —
  /// credits must keep working offline; the backup catches up next time.
  void _publishBackup(AiCreditsLedger ledger) {
    ref.read(aiCreditsBackupServiceProvider).backup(ledger).ignore();
  }

  /// The current ledger, awaiting any in-flight build/reconcile so a
  /// mutation never reads a null (mid-build) state and gets overwritten
  /// by the build completing later — that race swallowed bought credits.
  Future<AiCreditsLedger> _current() async {
    try {
      return await future;
    } catch (_) {
      return const AiCreditsLedger();
    }
  }

  Future<void> credit(int sats) async {
    final current = await _current();
    final next = current.credit(sats);
    state = AsyncData(next);
    await ref.read(aiCreditsServiceProvider).save(next);
    _publishBackup(next);
  }

  /// Grants credits for a confirmed payment and records its hash so
  /// reconciliation never double-credits it.
  Future<void> creditPayment(int sats, String paymentHash) async {
    await ref.read(aiCreditsServiceProvider).markCredited(paymentHash);
    await credit(sats);
  }

  /// Deducts [sats]; returns false when the balance can't cover it.
  Future<bool> debit(int sats) async {
    final current = await _current();
    if (!current.canAfford(sats)) return false;
    final next = current.debit(sats);
    state = AsyncData(next);
    await ref.read(aiCreditsServiceProvider).save(next);
    _publishBackup(next);
    return true;
  }

  /// Pulls top-ups found in the house-wallet history that this device
  /// hasn't credited yet (payments from other devices or a reinstall)
  /// into the on-disk ledger, then reloads state from it. Returns the
  /// granted amount, or null on lookup failure.
  Future<int?> reconcile(String pubkey) async {
    final granted = await ref
        .read(aiCreditsServiceProvider)
        .reconcile(pubkey, satsPerUsd: ref.read(aiSatsPerUsdProvider).value);
    if (granted == null || granted == 0) return granted;
    // The service already credited the disk ledger — reflect it + back up.
    final ledger = await ref.read(aiCreditsServiceProvider).load();
    state = AsyncData(ledger);
    _publishBackup(ledger);
    return granted;
  }

  /// Full refresh for the manual "Restore" path: reconcile the house-wallet
  /// history (finds un-credited payments) AND merge the relay backup (finds
  /// purchases+spends from other devices), then reflect the result.
  Future<void> refresh(String pubkey) async {
    await ref
        .read(aiCreditsServiceProvider)
        .reconcile(pubkey, satsPerUsd: ref.read(aiSatsPerUsdProvider).value);
    final merged = await _mergedWithBackup();
    state = AsyncData(merged);
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
