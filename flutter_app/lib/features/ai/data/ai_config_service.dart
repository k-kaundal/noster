import 'dart:convert';

import 'package:nostrfeed_mobile/core/config/env.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/nostr/kinds.dart';
import 'package:nostrfeed_mobile/core/nostr/nostr_service.dart';
import 'package:nostrfeed_mobile/features/ai/domain/ai_gateway.dart';

import 'package:shared_preferences/shared_preferences.dart';

/// The d-tag of the operator's AI gateway config note.
const aiConfigDTag = 'nostrfeed-ai-config';

/// Fetches the AI gateway config from the operator's signed Nostr note
/// (kind 30078, d-tag [aiConfigDTag], author = `Env.operatorPubkey`) so
/// providers / model catalogs / prices / kill-switch change WITHOUT an app
/// release. Falls back to the disk cache, then the built-in defaults.
class AiConfigService {
  static const _cacheKey = 'ai:gateway_config_v1';

  final NostrService _nostr;

  AiConfigService(this._nostr);

  /// Built-in defaults → disk cache → network (network wins, then cached).
  Future<AiGatewayConfig> load() async {
    final fallback = await _loadCached() ?? defaultAiGateway();
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
      if (events.isEmpty) return fallback;
      // Addressable: newest version wins.
      events.sort((a, b) => b.createdAt.compareTo(a.createdAt));
      final content = events.first.content;
      final json = jsonDecode(content);
      if (json is! Map<String, dynamic>) return fallback;
      final remote = AiGatewayConfig.fromJson(json);
      // Never let a remote note REMOVE the providers/models entirely —
      // merge onto defaults so a bad note can't brick the feature.
      final merged = _merge(remote, fallback);
      await _saveCached(merged);
      return merged;
    } catch (_) {
      return fallback;
    }
  }

  /// Remote wins on scalars + lists it actually provides; defaults fill
  /// anything the note omitted.
  AiGatewayConfig _merge(AiGatewayConfig remote, AiGatewayConfig fallback) {
    return AiGatewayConfig(
      enabled: remote.enabled,
      freeTrialPerDay: remote.freeTrialPerDay,
      profitMargin: remote.profitMargin,
      minSatsPerMessage: remote.minSatsPerMessage,
      modalityUpliftSats: remote.modalityUpliftSats.isNotEmpty
          ? remote.modalityUpliftSats
          : fallback.modalityUpliftSats,
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
