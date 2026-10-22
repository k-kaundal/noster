import 'dart:convert';

import 'package:flutter/foundation.dart';

import 'package:nostrfeed_mobile/core/config/env.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/nostr/kinds.dart';
import 'package:nostrfeed_mobile/core/nostr/nostr_service.dart';
import 'package:nostrfeed_mobile/features/ai/data/ai_gateway_service.dart';
import 'package:nostrfeed_mobile/features/ai/domain/ai_gateway.dart';

import 'package:shared_preferences/shared_preferences.dart';

/// The d-tag of the operator's AI gateway config note.
const aiConfigDTag = 'nostrfeed-ai-config';

/// Fetches the AI gateway config from the operator's signed Nostr note
/// (kind 30078, d-tag [aiConfigDTag], author = `Env.operatorPubkey`) so
/// providers / model catalogs / prices / kill-switch change WITHOUT an app
/// release. Falls back to the disk cache, then the built-in defaults.
///
/// On top of that, the provider's LIVE model catalog (`GET /models`, no key
/// needed beyond the provider's own) refreshes every model's USD prices and
/// keeps the free pool in sync — new `:free` models join the picker, dead
/// ones leave — so neither the price list nor the free tier ever goes stale
/// between app releases. Live prices are cached to disk; a stale live price
/// still beats the built-in bootstrap numbers.
class AiConfigService {
  static const _cacheKey = 'ai:gateway_config_v1';
  static const _catalogTsKey = 'ai:catalog_fetched_at';

  /// Re-fetch the live catalog at most this often — the `/models` payload is
  /// large (the whole catalog), and prices don't move minute-to-minute.
  static const catalogTtl = Duration(hours: 6);

  /// Cap on auto-added free models — the picker stays curated even as the
  /// upstream free pool rotates.
  static const maxAutoFreeModels = 8;

  final NostrService _nostr;
  final AiGatewayService _gateway;

  AiConfigService(this._nostr, {AiGatewayService? gateway})
      : _gateway = gateway ?? AiGatewayService();

  /// Built-in defaults → disk cache → operator note → live catalog
  /// (each layer wins over the previous on the fields it provides).
  Future<AiGatewayConfig> load() async {
    final fallback = await _loadCached() ?? defaultAiGateway();
    AiGatewayConfig config = fallback;
    try {
      final events = await _nostr.relayPool.query([
        NostrFilter(
          kinds: [NostrKinds.appData],
          authors: [Env.operatorPubkey],
          tagFilters: {
            'd': [aiConfigDTag],
          },
          limit: 1,
        ),
      ]);
      if (events.isNotEmpty) {
        // Addressable: newest version wins.
        events.sort((a, b) => b.createdAt.compareTo(a.createdAt));
        final json = jsonDecode(events.first.content);
        if (json is Map<String, dynamic>) {
          final remote = AiGatewayConfig.fromJson(json);
          // Never let a remote note REMOVE the providers/models entirely —
          // merge onto defaults so a bad note can't brick the feature.
          config = _merge(remote, fallback);
        }
      }
    } catch (_) {
      // The note is optional — cached/default config still works.
    }

    // Live catalog: refresh USD prices + free pool (TTL-bounded, best-effort).
    config = await _refreshFromLiveCatalog(config);
    await _saveCached(config);
    return config;
  }

  /// Applies the provider's live `/models` catalog to [config] when the TTL
  /// has expired. Returns [config] unchanged on any failure (offline, key
  /// missing, bad payload) — pricing just continues from the cache.
  Future<AiGatewayConfig> _refreshFromLiveCatalog(
    AiGatewayConfig config,
  ) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final fetchedAt = prefs.getInt(_catalogTsKey) ?? 0;
      final age = Duration(
        seconds: DateTime.now().millisecondsSinceEpoch ~/ 1000 - fetchedAt,
      );
      if (age < catalogTtl) return config;

      var updated = config;
      var touched = false;
      for (final provider in config.providers) {
        if (!_gateway.isProviderConfigured(provider)) continue;
        final catalog = await _gateway.fetchCatalog(provider);
        if (catalog == null || catalog.isEmpty) continue;
        updated = mergeLiveCatalog(updated, provider.id, catalog);
        touched = true;
      }
      if (touched) {
        await prefs.setInt(
          _catalogTsKey,
          DateTime.now().millisecondsSinceEpoch ~/ 1000,
        );
      }
      return updated;
    } catch (_) {
      return config;
    }
  }

  /// Merges a live provider catalog into [config] (pure — testable):
  ///
  /// - Every config model present in the catalog gets the LIVE USD prices
  ///   and modalities (label / tier / trial flag stay operator-controlled).
  /// - `:free` models the catalog no longer lists are DROPPED — a departed
  ///   free model 404s on send, so keeping it would break the trial pool.
  /// - New chat-capable `:free` models are AUTO-ADDED (trial-eligible,
  ///   tier 1, catalog name as label), capped at [maxAutoFreeModels] so the
  ///   picker stays curated. Paid models never auto-join — the operator
  ///   adds those via the config note; only their prices refresh.
  /// - Fallback ids that no longer resolve to a model are removed.
  @visibleForTesting
  static AiGatewayConfig mergeLiveCatalog(
    AiGatewayConfig config,
    String providerId,
    List<AiModelEntry> catalog,
  ) {
    final byId = {for (final m in catalog) m.id: m};
    bool isFreeId(String id) => id == 'openrouter/free' || id.endsWith(':free');

    final models = <AiModelEntry>[];
    for (final model in config.models) {
      if (model.providerId != providerId) {
        models.add(model);
        continue;
      }
      final live = byId[model.id];
      if (live == null) {
        // Keep paid models (operator-curated); drop dead free ones.
        if (!isFreeId(model.id)) models.add(model);
        continue;
      }
      models.add(model.copyWith(
        promptUsdPerM: live.promptUsdPerM,
        completionUsdPerM: live.completionUsdPerM,
        modalities: live.modalities,
      ));
    }

    // Auto-add new chat-capable free models (text/vision only — image-gen,
    // audio and video pricing needs operator curation).
    final existing = models.map((m) => m.id).toSet();
    var autoAdded = 0;
    for (final live in catalog) {
      if (autoAdded >= maxAutoFreeModels) break;
      if (!isFreeId(live.id) || existing.contains(live.id)) continue;
      final chatSafe = live.modalities
          .difference({AiModality.text, AiModality.vision})
          .isEmpty;
      if (!chatSafe) continue;
      models.add(AiModelEntry(
        id: live.id,
        providerId: providerId,
        label: _shortLabel(live),
        tier: 1,
        trialEligible: true,
        modalities: live.modalities,
      ));
      existing.add(live.id);
      autoAdded++;
    }

    final ids = models.map((m) => m.id).toSet();
    return AiGatewayConfig(
      enabled: config.enabled,
      freeTrialPerDay: config.freeTrialPerDay,
      profitMargin: config.profitMargin,
      platformFee: config.platformFee,
      volatilityBuffer: config.volatilityBuffer,
      minTokensPerMessage: config.minTokensPerMessage,
      assumedPromptTokens: config.assumedPromptTokens,
      assumedCompletionTokens: config.assumedCompletionTokens,
      modalityUpliftTokens: config.modalityUpliftTokens,
      providers: config.providers,
      models: models,
      fallbackModelIds: [
        for (final id in config.fallbackModelIds)
          if (ids.contains(id)) id,
      ],
    );
  }

  /// Short picker label from a catalog name — OpenRouter names arrive as
  /// "NVIDIA: Nemotron 3 Super 120B (free)"; the picker wants the meat.
  static String _shortLabel(AiModelEntry live) {
    var name = live.label;
    final colon = name.indexOf(':');
    if (colon >= 0 && colon < name.length - 1) name = name.substring(colon + 1);
    name = name.replaceAll(RegExp(r'\s*\(free\)\s*$', caseSensitive: false), '');
    name = name.trim();
    return name.isEmpty ? live.id : name;
  }

  /// Remote wins on scalars + lists it actually provides; defaults fill
  /// anything the note omitted.
  AiGatewayConfig _merge(AiGatewayConfig remote, AiGatewayConfig fallback) {
    return AiGatewayConfig(
      enabled: remote.enabled,
      freeTrialPerDay: remote.freeTrialPerDay,
      profitMargin: remote.profitMargin,
      platformFee: remote.platformFee,
      volatilityBuffer: remote.volatilityBuffer,
      minTokensPerMessage: remote.minTokensPerMessage,
      assumedPromptTokens: remote.assumedPromptTokens,
      assumedCompletionTokens: remote.assumedCompletionTokens,
      modalityUpliftTokens: remote.modalityUpliftTokens.isNotEmpty
          ? remote.modalityUpliftTokens
          : fallback.modalityUpliftTokens,
      providers: remote.providers.isNotEmpty
          ? remote.providers
          : fallback.providers,
      models: remote.models.isNotEmpty ? remote.models : fallback.models,
      fallbackModelIds: remote.fallbackModelIds.isNotEmpty
          ? remote.fallbackModelIds
          : fallback.fallbackModelIds,
    );
  }

  Future<AiGatewayConfig?> _loadCached() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_cacheKey);
      if (raw == null) return null;
      final json = jsonDecode(raw);
      if (json is Map<String, dynamic>) {
        return AiGatewayConfig.fromJson(json);
      }
    } catch (_) {}
    return null;
  }

  Future<void> _saveCached(AiGatewayConfig config) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_cacheKey, jsonEncode(config.toJson()));
    } catch (_) {}
  }
}
