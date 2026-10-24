/// Provider-agnostic AI gateway config — the heart of the AI feature.
///
/// One [AiProviderConfig] describes an OpenAI-compatible chat-completions
/// backend (OpenRouter today, any compatible endpoint tomorrow). One
/// [AiModelEntry] describes a model the user can pick, with its upstream
/// USD pricing; the app shows per-model TOKEN prices =
/// upstream USD cost × (1 + platform fee) × margin × [tokensPerUsd] —
/// dollar-pegged, so a price never moves with BTC.
///
/// The whole catalog is driven by the operator's Nostr config note
/// (kind 30078, d-tag `nostrfeed-ai-config`, signed by the operator
/// pubkey) with env-built-in defaults — switching providers or adjusting
/// prices is a config change, never a code change.
library;

import 'package:nostrfeed_mobile/core/config/env.dart';
import 'package:nostrfeed_mobile/features/ai/domain/ai_credits.dart';

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

  /// Video generation: text in, video out (async job API, not chat
  /// completions — handled by `AiGatewayService.generateVideo`).
  videoGen,
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
    } else if (outputs.contains('video')) {
      // Video-GEN models don't chat — everything else does.
      mods.add(AiModality.videoGen);
    } else {
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
  /// 1.5 = 50% margin. Price shown to the user =
  /// cost × (1 + platformFee) × satsPerUsd × margin.
  final double profitMargin;

  /// The provider's platform fee on credit purchases, as a fraction
  /// (OpenRouter Standard pay-as-you-go = 5.5%). The REAL cost of a request
  /// is its `usage.cost × (1 + platformFee)` — pricing off the raw number
  /// alone sells every message at a 5% discount out of the operator's pocket.
  final double platformFee;

  /// Volatility buffer on the sats conversion, as a fraction (0.03 = 3%).
  /// Sats are bought with USD at fill time but priced from a rate fetched
  /// minutes earlier; BTC moving against the operator between quote and
  /// settlement would eat the margin. The user-facing sats price uses
  /// `satsPerUsd × (1 + volatilityBuffer)` so a pump never sells sats cheap.
  final double volatilityBuffer;

  /// Every paid message costs at least this many TOKENS (even free models —
  /// the trial covers N/day, after that Basic costs its floor price).
  final int minTokensPerMessage;

  /// Assumed split for estimate pricing (typical chat message). The prompt
  /// side is deliberately generous — the estimate is RESERVED up front and
  /// under-charging is forgiven at settle, so a low estimate realizes less
  /// than the configured margin. Over-estimating and refunding is the only
  /// direction that never sells at a loss.
  final int assumedPromptTokens;
  final int assumedCompletionTokens;

  /// Extra TOKENS added to the estimate for capability-heavy models —
  /// vision, image generation, audio, video cost the operator more than
  /// plain chat (media tokens price far above text), so their chip price
  /// carries a modality uplift ON TOP of cost × margin. Overridable live
  /// via the config note (`modality_uplift_tokens`).
  final Map<AiModality, int> modalityUpliftTokens;

  final List<AiProviderConfig> providers;
  final List<AiModelEntry> models;

  /// Ordered fallbacks when the default model 429s (free pool busy).
  final List<String> fallbackModelIds;

  const AiGatewayConfig({
    this.enabled = true,
    this.freeTrialPerDay = 5,
    this.profitMargin = 1.5,
    this.platformFee = 0.055,
    this.volatilityBuffer = 0.03,
    this.minTokensPerMessage = 1,
    this.assumedPromptTokens = 1500,
    this.assumedCompletionTokens = 800,
    this.modalityUpliftTokens = defaultModalityUpliftTokens,
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

  // ── Pricing (in TOKENS — dollar-pegged, BTC-independent) ────────────

  /// The operator's REAL USD cost for a request — OpenRouter's `usage.cost`
  /// is the upstream token cost; the platform fee on credit purchases is on
  /// top of that and comes out of the operator's pocket if it's not priced in.
  double realCostUsd(double upstreamCostUsd) =>
      upstreamCostUsd * (1 + platformFee);

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
      final u = modalityUpliftTokens[modality] ?? 0;
      if (u > uplift) uplift = u;
    }
    return uplift;
  }

  /// USD → tokens at the peg ([tokensPerUsd] tokens = $1), with the margin.
  /// No exchange rate in sight — a token price is the same today and next
  /// month, whatever BTC does.
  int _usdToTokens(double usd) => (usd * tokensPerUsd).ceil();

  /// TOKEN estimate shown on the model chip and RESERVED up front:
  /// real cost × margin + modality uplift. Free-upstream models price at the
  /// floor — no uplift on a zero cost (the trial pool must stay free; the
  /// uplift exists to cover media-token cost that free models don't have).
  int estimatePriceTokens(AiModelEntry model) {
    if (model.isFreeUpstream) return minTokensPerMessage;
    final costUsd = realCostUsd(estimateCostUsd(model));
    final raw = _usdToTokens(costUsd * profitMargin) + modalityUpliftFor(model);
    return raw < minTokensPerMessage ? minTokensPerMessage : raw;
  }

  /// Exact TOKENS to charge for a completed request — real cost × margin.
  /// [costUsd] is the provider's `usage.cost` (upstream).
  int settlePriceTokens(double costUsd) {
    final raw = _usdToTokens(realCostUsd(costUsd) * profitMargin);
    return raw < minTokensPerMessage ? minTokensPerMessage : raw;
  }

  /// The most a completed request may charge ABOVE the up-front reserve.
  /// Settlement is exact, but a fully uncapped top-up lets a runaway
  /// request (a reasoning model burning 10× the assumed tokens) drain a
  /// balance the user never agreed to spend — and, when the balance can't
  /// cover it, the operator eats the difference. Capping the top-up bounds
  /// BOTH: the user never owes more than reserve × (1 + maxSettleOverage),
  /// and the operator's worst-case forgiveness is the overage beyond it.
  static const maxSettleOverage = 1.0; // ≤ reserve × 2 total

  /// The settle charge given an up-front [reserved] amount: the exact price,
  /// capped at reserve + the allowed overage.
  int cappedSettleTokens(int exactTokens, int reservedTokens) {
    final cap = (reservedTokens * (1 + maxSettleOverage)).ceil();
    final capped = exactTokens > cap ? cap : exactTokens;
    return capped < minTokensPerMessage ? minTokensPerMessage : capped;
  }

  // ── Serialization ───────────────────────────────────────────────────

  Map<String, dynamic> toJson() => {
    'enabled': enabled,
    'free_trial_per_day': freeTrialPerDay,
    'profit_margin': profitMargin,
    'platform_fee': platformFee,
    'volatility_buffer': volatilityBuffer,
    'min_tokens_per_message': minTokensPerMessage,
    'modality_uplift_tokens': {
      for (final e in modalityUpliftTokens.entries) e.key.name: e.value,
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
    final uplifts = Map<AiModality, int>.from(defaultModalityUpliftTokens);
    // Accept BOTH keys: an older config note written in sats still parses
    // (its values are treated as tokens — the numbers are close enough at
    // the current rate that nothing meaningful shifts).
    final rawUplifts =
        json['modality_uplift_tokens'] ?? json['modality_uplift_sats'];
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
      platformFee: (json['platform_fee'] as num?)?.toDouble() ?? 0.055,
      volatilityBuffer:
          (json['volatility_buffer'] as num?)?.toDouble() ?? 0.03,
      minTokensPerMessage:
          (json['min_tokens_per_message'] as num?)?.toInt() ?? 1,
      modalityUpliftTokens: uplifts,
      providers: providers,
      models: models,
      fallbackModelIds: [
        for (final id in (json['fallback_models'] as List? ?? const [])) '$id',
      ],
    );
  }
}

/// Default modality uplifts (TOKENS per message estimate) — media models
/// cost the operator far more than text (a generated image ≈ 1,200+ output
/// tokens at premium rates; audio/video tokens are 5–20× text prices).
/// Text chat stays at zero uplift — its cost estimate already covers it.
const defaultModalityUpliftTokens = <AiModality, int>{
  AiModality.text: 0,
  AiModality.vision: 4,
  AiModality.imageGen: 33,
  AiModality.audio: 12,
  AiModality.video: 8,
  // Video generation is priced per second of output (baked into the
  // model's token-equivalent USD price below) — no extra uplift.
  AiModality.videoGen: 0,
};

/// The built-in default gateway: OpenRouter direct, free router + locked
/// price tiers (docs/AI_PLAN.md §3.1). Model USD prices are VERIFIED against
/// the live catalog (`GET /api/v1/models`, no key needed) on 2026-10-22 —
/// the config note can correct them live, and `AiGatewayService.fetchCatalog`
/// refreshes them from the same endpoint.
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
    'nvidia/nemotron-3-super-120b-a12b:free',
    'cohere/north-mini-code:free',
    'poolside/laguna-s-2.1:free',
    'poolside/laguna-xs-2.1:free',
  ],
  models: [
    // ── Free chat (trial pool) — all verified live 2026-10-22 ──────
    AiModelEntry(
      id: 'openrouter/free',
      providerId: 'openrouter',
      label: 'Basic',
      tier: 1,
      trialEligible: true,
      modalities: {AiModality.text, AiModality.vision},
    ),
    AiModelEntry(
      id: 'nvidia/nemotron-3-super-120b-a12b:free',
      providerId: 'openrouter',
      label: 'Nemotron Super 120B',
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
      id: 'poolside/laguna-s-2.1:free',
      providerId: 'openrouter',
      label: 'Poolside Laguna S',
      tier: 1,
      trialEligible: true,
    ),
    AiModelEntry(
      id: 'google/gemma-4-31b-it:free',
      providerId: 'openrouter',
      label: 'Gemma 4 31B',
      tier: 1,
      trialEligible: true,
      modalities: {AiModality.text, AiModality.vision, AiModality.video},
    ),
    // ── Budget paid (tier 2) — the cheap-but-reliable workhorses ────
    AiModelEntry(
      id: 'openai/gpt-5-nano',
      providerId: 'openrouter',
      label: 'GPT-5 Nano',
      tier: 2,
      promptUsdPerM: 0.05,
      completionUsdPerM: 0.40,
      modalities: {AiModality.text, AiModality.vision},
    ),
    AiModelEntry(
      id: 'google/gemini-2.5-flash-lite',
      providerId: 'openrouter',
      label: 'Gemini 2.5 Flash Lite',
      tier: 2,
      promptUsdPerM: 0.10,
      completionUsdPerM: 0.40,
      modalities: {
        AiModality.text,
        AiModality.vision,
        AiModality.video,
        AiModality.audio,
      },
    ),
    AiModelEntry(
      id: 'deepseek/deepseek-v3.2',
      providerId: 'openrouter',
      label: 'DeepSeek V3.2',
      tier: 2,
      promptUsdPerM: 0.28,
      completionUsdPerM: 0.42,
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
      id: 'z-ai/glm-4.7',
      providerId: 'openrouter',
      label: 'GLM 4.7',
      tier: 2,
      promptUsdPerM: 0.54,
      completionUsdPerM: 1.98,
    ),
    // ── Mid (tier 3) ────────────────────────────────────────────────
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
      id: 'moonshotai/kimi-k2-0905',
      providerId: 'openrouter',
      label: 'Kimi K2',
      tier: 3,
      promptUsdPerM: 0.60,
      completionUsdPerM: 2.50,
    ),
    // A reasoning model — completion USD is the POSTED output rate, but the
    // hidden reasoning tokens settle in `usage.cost` (which can run 5–10× a
    // plain answer). The estimate deliberately assumes a heavy reasoning burn
    // so the up-front reserve is honest; settlement is exact and the
    // under-charge cap (see AiChatNotifier) keeps a runaway request from
    // ever realizing below cost.
    AiModelEntry(
      id: 'deepseek/deepseek-r1-0528',
      providerId: 'openrouter',
      label: 'DeepSeek R1 (reasoning)',
      tier: 3,
      promptUsdPerM: 0.50,
      completionUsdPerM: 8.60,
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
    // ── Frontier (tier 4) ───────────────────────────────────────────
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
    AiModelEntry(
      id: 'anthropic/claude-opus-4.6',
      providerId: 'openrouter',
      label: 'Claude Opus 4.6',
      tier: 4,
      promptUsdPerM: 5.00,
      completionUsdPerM: 25.00,
      modalities: {AiModality.text, AiModality.vision},
    ),
    // ── Image generation (verified in the live catalog 2026-10-22) ──
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
      completionUsdPerM: 2.40,
      modalities: {AiModality.audio},
    ),
    // ── Video generation (async job API, not chat completions) ───────
    // Priced per second of output: Veo 3.1 ≈ $0.50/s (OpenRouter video
    // catalog) → a 4s clip ≈ $2.00. The estimate expresses that as
    // token-equivalent USD (1500 assumed prompt tokens × $1333/1M ≈ $2.00);
    // settlement uses the job's exact `usage.cost`.
    AiModelEntry(
      id: 'google/veo-3.1',
      providerId: 'openrouter',
      label: 'Veo 3.1 Video',
      tier: 4,
      promptUsdPerM: 1333,
      modalities: {AiModality.videoGen},
    ),
  ],
);
