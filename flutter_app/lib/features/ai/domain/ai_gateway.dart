/// Provider-agnostic AI gateway config — the heart of the AI feature.
///
/// One [AiProviderConfig] describes an OpenAI-compatible chat-completions
/// backend (OpenRouter today, any compatible endpoint tomorrow). One
/// [AiModelEntry] describes a model the user can pick, with its upstream
/// USD pricing; the app shows per-model sats prices = upstream cost ×
/// sats-per-USD × the operator profit margin.
///
/// The whole catalog is driven by the operator's Nostr config note
/// (kind 30078, d-tag `nostrfeed-ai-config`, signed by the operator
/// pubkey) with env-built-in defaults — switching providers or adjusting
/// prices is a config change, never a code change.
library;

import 'package:nostrfeed_mobile/core/config/env.dart';

/// An OpenAI-compatible chat-completions provider.
class AiProviderConfig {
  /// Stable id, referenced by model entries (`provider: 'openrouter'`).
  final String id;

  /// Display name in the model picker.
  final String name;

  /// Base URL including `/v1` — chat completions at `$baseUrl/chat/completions`.
  final String baseUrl;

  /// Models catalog endpoint (OpenRouter: `/models`). Empty = unsupported.
  final String modelsPath;

  /// Env var NAME the API key comes from — never the key itself, so a
  /// config note can point at a different provider without shipping secrets.
  final String apiKeyEnvName;

  /// App-attribution headers OpenRouter uses for rankings (ignored elsewhere).
  final String? referer;
  final String? title;

  const AiProviderConfig({
    required this.id,
    required this.name,
    required this.baseUrl,
    this.modelsPath = '/models',
    this.apiKeyEnvName = 'OPENROUTER_API_KEY',
    this.referer,
    this.title,
  });

  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'base_url': baseUrl,
    'models_path': modelsPath,
    'api_key_env': apiKeyEnvName,
    if (referer != null) 'referer': referer,
    if (title != null) 'title': title,
  };

  factory AiProviderConfig.fromJson(Map<String, dynamic> json) {
    return AiProviderConfig(
      id: json['id'] as String? ?? 'openrouter',
      name: json['name'] as String? ?? 'OpenRouter',
      baseUrl: json['base_url'] as String? ?? 'https://openrouter.ai/api/v1',
      modelsPath: json['models_path'] as String? ?? '/models',
      apiKeyEnvName: json['api_key_env'] as String? ?? 'OPENROUTER_API_KEY',
      referer: json['referer'] as String?,
      title: json['title'] as String?,
    );
  }
}

/// What a model can do — shown as type filters in the picker.
/// Provider economics (free/paid) NEVER surface in the UI — only the
/// sats price does.
enum AiModality {
  /// Text in → text out (chat, summarize, translate…).
  text,

  /// Image understanding (vision): photos/screenshots in, text out.
  vision,

  /// Image generation: text in, image out.
  imageGen,

  /// Audio in (transcription) and/or audio out (music/TTS).
  audio,

  /// Video understanding.
  video,
}

/// One user-pickable model.
class AiModelEntry {
  /// Model id sent to the provider (`openrouter/free`, `google/gemini-2.5-flash`).
  final String id;

  /// Which provider serves it.
  final String providerId;

  /// Short label in the picker (`Basic`, `Gemini 2.5 Flash`).
  final String label;

  /// Tier grouping for display ordering (1 = cheapest … 4 = frontier).
  final int tier;

  /// Upstream USD price per 1M prompt tokens (0 for free models).
  final double promptUsdPerM;

  /// Upstream USD price per 1M completion tokens (0 for free models).
  final double completionUsdPerM;

  /// Free for the user during the daily trial (Basic tier only).
  final bool trialEligible;

  /// Hidden from the picker (kept in config for fallback lists).
  final bool hidden;

  /// What the model can do (drives the picker's type filters).
  final Set<AiModality> modalities;

  const AiModelEntry({
    required this.id,
    required this.providerId,
    required this.label,
    this.tier = 1,
    this.promptUsdPerM = 0,
    this.completionUsdPerM = 0,
    this.trialEligible = false,
    this.hidden = false,
    this.modalities = const {AiModality.text},
  });

  /// Cost is zero upstream (INTERNAL only — never surfaces in the UI).
  bool get isFreeUpstream => promptUsdPerM == 0 && completionUsdPerM == 0;

  /// Provider catalog shape: `architecture.input_modalities` /
  /// `output_modalities` → our modality set.
  static Set<AiModality> modalitiesFrom({
    List<String> inputs = const [],
    List<String> outputs = const [],
  }) {
    final mods = <AiModality>{};
    if (inputs.contains('image') || inputs.contains('file')) {
      mods.add(AiModality.vision);
    }
    if (inputs.contains('video')) mods.add(AiModality.video);
    if (inputs.contains('audio') || outputs.contains('audio')) {
      mods.add(AiModality.audio);
    }
    if (outputs.contains('image')) {
      mods.add(AiModality.imageGen);
    } else {
      // Image-GEN models reply with image+text; everything else chats.
      mods.add(AiModality.text);
    }
    if (mods.isEmpty) mods.add(AiModality.text);
    return mods;
  }

  AiModelEntry copyWith({
    String? label,
    int? tier,
    double? promptUsdPerM,
    double? completionUsdPerM,
    bool? trialEligible,
    Set<AiModality>? modalities,
  }) {
    return AiModelEntry(
      id: id,
      providerId: providerId,
      label: label ?? this.label,
      tier: tier ?? this.tier,
      promptUsdPerM: promptUsdPerM ?? this.promptUsdPerM,
      completionUsdPerM: completionUsdPerM ?? this.completionUsdPerM,
      trialEligible: trialEligible ?? this.trialEligible,
      hidden: hidden,
      modalities: modalities ?? this.modalities,
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'provider': providerId,
    'label': label,
    'tier': tier,
    'prompt_usd_per_m': promptUsdPerM,
    'completion_usd_per_m': completionUsdPerM,
    'trial_eligible': trialEligible,
    if (hidden) 'hidden': true,
    'modalities': [for (final m in modalities) m.name],
  };

  factory AiModelEntry.fromJson(Map<String, dynamic> json) {
    final mods = <AiModality>{};
    final rawMods = json['modalities'];
    if (rawMods is List) {
      for (final raw in rawMods) {
        for (final m in AiModality.values) {
          if (m.name == raw) mods.add(m);
        }
      }
    }
    return AiModelEntry(
      id: json['id'] as String,
      providerId: json['provider'] as String? ?? 'openrouter',
      label: json['label'] as String? ?? (json['id'] as String),
      tier: (json['tier'] as num?)?.toInt() ?? 1,
      promptUsdPerM: (json['prompt_usd_per_m'] as num?)?.toDouble() ?? 0,
      completionUsdPerM:
          (json['completion_usd_per_m'] as num?)?.toDouble() ?? 0,
      trialEligible: json['trial_eligible'] as bool? ?? false,
      hidden: json['hidden'] as bool? ?? false,
      modalities: mods.isEmpty ? const {AiModality.text} : mods,
    );
  }
}

/// The full AI gateway config: providers + models + economics + kill-switch.
class AiGatewayConfig {
  final bool enabled;

  /// Free trial messages per day per device (trial-eligible models only).
  final int freeTrialPerDay;

  /// Operator profit multiplier applied to upstream USD cost.
  /// 1.5 = 50% margin. Price shown to the user = cost × satsPerUsd × margin.
  final double profitMargin;

  /// Every paid message costs at least this many sats (even free models —
  /// the trial covers N/day, after that Basic costs its floor price).
  final int minSatsPerMessage;

  /// Assumed split for estimate pricing (typical chat message).
  final int assumedPromptTokens;
  final int assumedCompletionTokens;

  /// Extra sats added to the estimate for capability-heavy models —
  /// vision, image generation, audio, video cost the operator more than
  /// plain chat (media tokens price far above text), so their chip price
  /// carries a modality uplift ON TOP of cost × margin. Overridable live
  /// via the config note (`modality_uplift_sats`).
  final Map<AiModality, int> modalityUpliftSats;

  final List<AiProviderConfig> providers;
  final List<AiModelEntry> models;

  /// Ordered fallbacks when the default model 429s (free pool busy).
  final List<String> fallbackModelIds;

  const AiGatewayConfig({
    this.enabled = true,
    this.freeTrialPerDay = 5,
    this.profitMargin = 1.5,
    this.minSatsPerMessage = 1,
    this.assumedPromptTokens = 800,
    this.assumedCompletionTokens = 400,
    this.modalityUpliftSats = defaultModalityUpliftSats,
    required this.providers,
    required this.models,
    this.fallbackModelIds = const [],
  });

  AiProviderConfig? provider(String id) {
    for (final p in providers) {
      if (p.id == id) return p;
    }
    return null;
  }

  AiModelEntry? model(String id) {
    for (final m in models) {
      if (m.id == id) return m;
    }
    return null;
  }

  /// Picker-visible models, ordered by tier then price.
  List<AiModelEntry> get visibleModels {
    final list = models.where((m) => !m.hidden).toList()
      ..sort((a, b) {
        final byTier = a.tier.compareTo(b.tier);
        if (byTier != 0) return byTier;
        final byPrice = (a.promptUsdPerM + a.completionUsdPerM).compareTo(
          b.promptUsdPerM + b.completionUsdPerM,
        );
        if (byPrice != 0) return byPrice;
        return a.label.compareTo(b.label);
      });
    return list;
  }

  // ── Pricing ─────────────────────────────────────────────────────────

  /// Upstream USD estimate for one typical message on [model].
  double estimateCostUsd(AiModelEntry model) {
    return (assumedPromptTokens * model.promptUsdPerM +
            assumedCompletionTokens * model.completionUsdPerM) /
        1e6;
  }

  /// The modality uplift for [model] — the MAX of its modalities' uplifts
  /// (a vision+video model charges the video uplift, not their sum).
  int modalityUpliftFor(AiModelEntry model) {
    var uplift = 0;
    for (final modality in model.modalities) {
      final u = modalityUpliftSats[modality] ?? 0;
      if (u > uplift) uplift = u;
    }
    return uplift;
  }

  /// Sats estimate shown on the model chip: cost × margin + modality
  /// uplift (includes the profit margin on the cost part).
  int estimatePriceSats(AiModelEntry model, {required double satsPerUsd}) {
    final costUsd = estimateCostUsd(model);
    final raw =
        (costUsd * satsPerUsd * profitMargin).ceil() + modalityUpliftFor(model);
    return raw < minSatsPerMessage ? minSatsPerMessage : raw;
  }

  /// Exact sats to charge for a completed request (includes the margin).
  int settlePriceSats(double costUsd, {required double satsPerUsd}) {
    final raw = (costUsd * satsPerUsd * profitMargin).ceil();
    return raw < minSatsPerMessage ? minSatsPerMessage : raw;
  }

  // ── Serialization ───────────────────────────────────────────────────

  Map<String, dynamic> toJson() => {
    'enabled': enabled,
    'free_trial_per_day': freeTrialPerDay,
    'profit_margin': profitMargin,
    'min_sats_per_message': minSatsPerMessage,
    'modality_uplift_sats': {
      for (final e in modalityUpliftSats.entries) e.key.name: e.value,
    },
    'providers': [for (final p in providers) p.toJson()],
    'models': [for (final m in models) m.toJson()],
    'fallback_models': fallbackModelIds,
  };

  factory AiGatewayConfig.fromJson(Map<String, dynamic> json) {
    final providers = <AiProviderConfig>[];
    final rawProviders = json['providers'];
    if (rawProviders is List) {
      for (final p in rawProviders) {
        if (p is Map<String, dynamic>) {
          providers.add(AiProviderConfig.fromJson(p));
        } else if (p is Map) {
          providers.add(
            AiProviderConfig.fromJson(Map<String, dynamic>.from(p)),
          );
        }
      }
    }
    final models = <AiModelEntry>[];
    final rawModels = json['models'];
    if (rawModels is List) {
      for (final m in rawModels) {
        if (m is Map) {
          models.add(AiModelEntry.fromJson(Map<String, dynamic>.from(m)));
        }
      }
    }
    final uplifts = Map<AiModality, int>.from(defaultModalityUpliftSats);
    final rawUplifts = json['modality_uplift_sats'];
    if (rawUplifts is Map) {
      for (final m in AiModality.values) {
        final v = rawUplifts[m.name];
        if (v is num && v >= 0) uplifts[m] = v.toInt();
      }
    }
    return AiGatewayConfig(
      enabled: json['enabled'] as bool? ?? true,
      freeTrialPerDay: (json['free_trial_per_day'] as num?)?.toInt() ?? 5,
      profitMargin: (json['profit_margin'] as num?)?.toDouble() ?? 1.5,
      minSatsPerMessage: (json['min_sats_per_message'] as num?)?.toInt() ?? 1,
      modalityUpliftSats: uplifts,
      providers: providers,
      models: models,
      fallbackModelIds: [
        for (final id in (json['fallback_models'] as List? ?? const [])) '$id',
      ],
    );
  }
}

/// Default modality uplifts (sats per message estimate) — media models
/// cost the operator far more than text (a generated image ≈ 1,200+ output
/// tokens at premium rates; audio/video tokens are 5–20× text prices).
/// Text chat stays at zero uplift — its cost estimate already covers it.
const defaultModalityUpliftSats = <AiModality, int>{
  AiModality.text: 0,
  AiModality.vision: 5,
  AiModality.imageGen: 40,
  AiModality.audio: 15,
  AiModality.video: 10,
};

/// The built-in default gateway: OpenRouter direct, free router + the four
/// locked price tiers (docs/AI_PLAN.md §3.1). Model USD prices are catalog
/// list prices (Oct 2026) — the config note can correct them live.
AiGatewayConfig defaultAiGateway() => const AiGatewayConfig(
  providers: [
    AiProviderConfig(
      id: 'openrouter',
      name: 'OpenRouter',
      baseUrl: Env.openRouterBaseUrl,
      referer: 'https://nostrfeed.com',
      title: 'NostrFeed',
    ),
  ],
  fallbackModelIds: [
    'openrouter/free',
    'minimax/minimax-m3.1-flash:free',
    'cohere/north-mini-code:free',
    'poolside/laguna-s-2.1:free',
  ],
  models: [
    // ── Chat (text) ────────────────────────────────────────────────
    AiModelEntry(
      id: 'openrouter/free',
      providerId: 'openrouter',
      label: 'Basic',
      tier: 1,
      trialEligible: true,
    ),
    AiModelEntry(
      id: 'minimax/minimax-m3.1-flash:free',
      providerId: 'openrouter',
      label: 'MiniMax Flash',
      tier: 1,
      trialEligible: true,
    ),
    AiModelEntry(
      id: 'cohere/north-mini-code:free',
      providerId: 'openrouter',
      label: 'Cohere North Mini',
      tier: 1,
      trialEligible: true,
    ),
    AiModelEntry(
      id: 'google/gemini-2.5-flash',
      providerId: 'openrouter',
      label: 'Gemini 2.5 Flash',
      tier: 2,
      promptUsdPerM: 0.30,
      completionUsdPerM: 2.50,
      modalities: {
        AiModality.text,
        AiModality.vision,
        AiModality.video,
        AiModality.audio,
      },
    ),
    AiModelEntry(
      id: 'deepseek/deepseek-chat',
      providerId: 'openrouter',
      label: 'DeepSeek V3',
      tier: 2,
      promptUsdPerM: 0.28,
      completionUsdPerM: 0.42,
    ),
    AiModelEntry(
      id: 'openai/gpt-5-mini',
      providerId: 'openrouter',
      label: 'GPT-5 Mini',
      tier: 3,
      promptUsdPerM: 0.25,
      completionUsdPerM: 2.00,
      modalities: {AiModality.text, AiModality.vision},
    ),
    AiModelEntry(
      id: 'anthropic/claude-haiku-4.5',
      providerId: 'openrouter',
      label: 'Claude Haiku 4.5',
      tier: 3,
      promptUsdPerM: 1.00,
      completionUsdPerM: 5.00,
      modalities: {AiModality.text, AiModality.vision},
    ),
    AiModelEntry(
      id: 'anthropic/claude-sonnet-4.5',
      providerId: 'openrouter',
      label: 'Claude Sonnet 4.5',
      tier: 4,
      promptUsdPerM: 3.00,
      completionUsdPerM: 15.00,
      modalities: {AiModality.text, AiModality.vision},
    ),
    AiModelEntry(
      id: 'openai/gpt-5',
      providerId: 'openrouter',
      label: 'GPT-5',
      tier: 4,
      promptUsdPerM: 1.25,
      completionUsdPerM: 10.00,
      modalities: {AiModality.text, AiModality.vision},
    ),
    // ── Image generation (verified in the live catalog Oct 2026) ────
    AiModelEntry(
      id: 'google/gemini-3.1-flash-image',
      providerId: 'openrouter',
      label: 'Gemini Image Flash',
      tier: 3,
      promptUsdPerM: 0.50,
      completionUsdPerM: 3.00,
      modalities: {AiModality.imageGen, AiModality.vision},
    ),
    AiModelEntry(
      id: 'google/gemini-3-pro-image',
      providerId: 'openrouter',
      label: 'Gemini Image Pro',
      tier: 4,
      promptUsdPerM: 2.00,
      completionUsdPerM: 12.00,
      modalities: {AiModality.imageGen, AiModality.vision},
    ),
    // ── Audio generation ────────────────────────────────────────────
    AiModelEntry(
      id: 'openai/gpt-audio-mini',
      providerId: 'openrouter',
      label: 'GPT Audio Mini',
      tier: 3,
      promptUsdPerM: 0.60,
      completionUsdPerM: 3.00,
      modalities: {AiModality.audio},
    ),
  ],
);
