import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'package:nostrfeed_mobile/core/config/env.dart';
import 'package:nostrfeed_mobile/core/services/http_helper.dart';
import 'package:nostrfeed_mobile/features/ai/domain/ai_gateway.dart';
import 'package:nostrfeed_mobile/features/ai/domain/ai_models.dart';

/// One chunk of a streaming chat completion.
class AiStreamChunk {
  /// New text delta (may be empty on the final usage chunk).
  final String delta;

  /// Set exactly once, on the final chunk before [DONE].
  final AiUsage? usage;

  /// Generated image URLs (image-gen models emit an `images` array on the
  /// message — Gemini image models return data URLs or hosted URLs).
  final List<String> images;

  const AiStreamChunk(this.delta, {this.usage, this.images = const []});
}

/// Token + cost accounting for one completion, from the provider's `usage`.
class AiUsage {
  final int promptTokens;
  final int completionTokens;

  /// USD cost of the request (0 for free models / providers that omit cost).
  final double costUsd;

  /// Model that actually served the request (routers may substitute).
  final String model;

  const AiUsage({
    required this.promptTokens,
    required this.completionTokens,
    required this.costUsd,
    required this.model,
  });

  static AiUsage? tryParse(Map<String, dynamic>? usage, String? model) {
    if (usage == null) return null;
    return AiUsage(
      promptTokens: (usage['prompt_tokens'] as num?)?.toInt() ?? 0,
      completionTokens: (usage['completion_tokens'] as num?)?.toInt() ?? 0,
      costUsd: (usage['cost'] as num?)?.toDouble() ?? 0,
      model: model ?? '',
    );
  }
}

/// Live free-tier quota, from OpenRouter's `GET /auth/key` (null elsewhere).
class AiFreeQuota {
  final int used;
  final int limit;
  final int remaining;

  const AiFreeQuota({
    required this.used,
    required this.limit,
    required this.remaining,
  });

  static AiFreeQuota? tryParse(Map<String, dynamic> keyData) {
    final raw = keyData['free_model_daily_requests'];
    if (raw is! Map) return null;
    return AiFreeQuota(
      used: (raw['used'] as num?)?.toInt() ?? 0,
      limit: (raw['limit'] as num?)?.toInt() ?? 50,
      remaining: (raw['remaining'] as num?)?.toInt() ?? 0,
    );
  }
}

class AiGatewayException implements Exception {
  final int statusCode;
  final String message;

  /// True for 402 — paid model requested without provider credits.
  final bool isPaymentRequired;

  /// True for 429 — rate-limited (free pool busy / per-minute cap).
  final bool isRateLimited;

  const AiGatewayException({
    required this.statusCode,
    required this.message,
  })  : isPaymentRequired = statusCode == 402,
        isRateLimited = statusCode == 429;

  @override
  String toString() => message;
}

/// One finished video generation: the download URLs + cost.
class AiVideoResult {
  /// Signed or key-less download URLs (mp4). Prefer these for playback —
  /// `unsignedUrls` need the API key as a bearer header.
  final List<String> urls;

  /// Content-endpoint URLs that need the provider key as Authorization.
  final List<String> unsignedUrls;

  /// USD cost reported by the job's `usage`.
  final double costUsd;

  const AiVideoResult({
    required this.urls,
    required this.unsignedUrls,
    required this.costUsd,
  });
}

/// Provider-agnostic chat gateway: speaks OpenAI-compatible streaming chat
/// completions to ANY configured provider (OpenRouter today, others by
/// config). Keys are resolved by env NAME from the provider config — a
/// config note never carries secrets.
class AiGatewayService {
  final ApiHttpClient _http;

  /// Resolves an API key by env name (injected for tests).
  final String Function(String envName) _resolveKey;

  AiGatewayService({
    ApiHttpClient? httpClient,
    String Function(String envName)? resolveKey,
  })  : _http = httpClient ?? const ApiHttpClient(),
        _resolveKey = resolveKey ?? _defaultKeyResolver;

  static String _defaultKeyResolver(String envName) {
    switch (envName) {
      case 'OPENROUTER_API_KEY':
        return Env.openRouterApiKey;
      default:
        // Unknown providers are configured by the config note; keys only
        // ever come from --dart-define, so unknown names resolve empty and
        // the model shows as unavailable.
        return const String.fromEnvironment('');
    }
  }

  bool isProviderConfigured(AiProviderConfig provider) =>
      _resolveKey(provider.apiKeyEnvName).isNotEmpty;

  Map<String, String> _headers(AiProviderConfig provider, {bool sse = false}) {
    final key = _resolveKey(provider.apiKeyEnvName);
    return {
      if (key.isNotEmpty) 'Authorization': 'Bearer $key',
      if (provider.referer != null) 'HTTP-Referer': provider.referer!,
      if (provider.title != null) 'X-OpenRouter-Title': provider.title!,
      if (sse) 'Accept': 'text/event-stream',
    };
  }

  /// Streams a chat completion token-by-token.
  ///
  /// [maxTokens] defaults high (2048): current free models are reasoning
  /// models that burn 50–200 hidden tokens before any visible text — a
  /// small cap yields "empty" replies (verified live 2026-10-22).
  ///
  /// Throws [AiGatewayException] on non-2xx.
  Stream<AiStreamChunk> streamChat({
    required AiProviderConfig provider,
    required List<AiMessage> messages,
    required String modelId,
    int maxTokens = 2048,
  }) {
    final controller = StreamController<AiStreamChunk>();

    () async {
      final request = http.Request(
        'POST',
        Uri.parse('${provider.baseUrl}/chat/completions'),
      );
      request.headers.addAll({
        ..._headers(provider, sse: true),
        'Content-Type': 'application/json',
      });
      request.body = jsonEncode({
        'model': modelId,
        'messages': [
          for (final m in messages)
            {'role': m.role.name, 'content': m.content},
        ],
        'max_tokens': maxTokens,
        'stream': true,
        // OpenRouter extension: usage in the final stream chunk.
        'usage': {'include': true},
      });

      final http.StreamedResponse response;
      try {
        response = await request.send().timeout(const Duration(seconds: 30));
      } catch (e) {
        controller.addError(
          AiGatewayException(statusCode: 0, message: 'Network error: $e'),
        );
        await controller.close();
        return;
      }

      if (response.statusCode < 200 || response.statusCode >= 300) {
        final body = await response.stream.bytesToString();
        controller.addError(_parseError(response.statusCode, body));
        await controller.close();
        return;
      }

      final buffer = StringBuffer();
      String? servedModel;
      await for (final chunk in response.stream.transform(utf8.decoder)) {
        buffer.write(chunk);
        final text = buffer.toString();
        final lines = text.split('\n');
        buffer
          ..clear()
          ..write(lines.removeLast());

        for (final line in lines) {
          final trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          final payload = trimmed.substring(5).trim();
          if (payload == '[DONE]') continue;
          Map<String, dynamic> json;
          try {
            json = jsonDecode(payload) as Map<String, dynamic>;
          } catch (_) {
            continue; // SSE comments / keepalives
          }
          servedModel ??= json['model'] as String?;

          final usage = AiUsage.tryParse(
            json['usage'] as Map<String, dynamic>?,
            servedModel,
          );

          final choices = json['choices'];
          var delta = '';
          final images = <String>[];
          if (choices is List && choices.isNotEmpty) {
            final first = choices.first;
            if (first is Map) {
              // Streaming chunks carry `delta`; non-streamed image replies
              // may arrive as a full `message` in one chunk.
              final d = first['delta'] ?? first['message'];
              if (d is Map) {
                if (d['content'] is String) {
                  delta = d['content'] as String;
                }
                images.addAll(_extractImages(d['images']));
              }
            }
          }
          if (delta.isNotEmpty || usage != null || images.isNotEmpty) {
            controller.add(
              AiStreamChunk(delta, usage: usage, images: images),
            );
          }
        }
      }
      await controller.close();
    }();

    return controller.stream;
  }

  /// Pulls image URLs out of a provider `images` array
  /// (`[{type: image_url, image_url: {url: …}}]` — data URLs or https).
  static List<String> _extractImages(Object? raw) {
    final out = <String>[];
    if (raw is! List) return out;
    for (final item in raw) {
      if (item is! Map) continue;
      final imageUrl = item['image_url'];
      if (imageUrl is Map && imageUrl['url'] is String) {
        out.add(imageUrl['url'] as String);
      } else if (item['url'] is String) {
        out.add(item['url'] as String);
      }
    }
    return out;
  }

  /// Generates a video on OpenRouter's async video API
  /// (`POST /videos` → poll `polling_url` until completed → download URLs).
  ///
  /// Video jobs take 30s–several minutes; this polls every 5s up to
  /// [maxWait]. Throws [AiGatewayException] on failure/timeout.
  Future<AiVideoResult> generateVideo({
    required AiProviderConfig provider,
    required String modelId,
    required String prompt,
    int durationSeconds = 4,
    String resolution = '720p',
    String aspectRatio = '16:9',
    Duration maxWait = const Duration(minutes: 6),
  }) async {
    final key = _resolveKey(provider.apiKeyEnvName);
    if (key.isEmpty) {
      throw const AiGatewayException(
        statusCode: 0,
        message: 'AI provider is not configured in this build.',
      );
    }
    final headers = {
      ..._headers(provider),
      'Content-Type': 'application/json',
    };

    // 1. Submit the job (202 Accepted).
    final submit = await http
        .post(
          Uri.parse('${provider.baseUrl}/videos'),
          headers: headers,
          body: jsonEncode({
            'model': modelId,
            'prompt': prompt,
            'duration': durationSeconds,
            'resolution': resolution,
            'aspect_ratio': aspectRatio,
          }),
        )
        .timeout(const Duration(seconds: 30));
    if (submit.statusCode < 200 || submit.statusCode >= 300) {
      throw _parseError(submit.statusCode, submit.body);
    }
    final job = jsonDecode(submit.body);
    if (job is! Map || job['polling_url'] is! String) {
      throw const AiGatewayException(
        statusCode: 0,
        message: 'The video provider returned an unexpected response.',
      );
    }
    var pollingUrl = job['polling_url'] as String;
    if (pollingUrl.startsWith('/')) pollingUrl = '${provider.baseUrl}$pollingUrl';

    // 2. Poll until completed / failed / timeout.
    final deadline = DateTime.now().add(maxWait);
    while (DateTime.now().isBefore(deadline)) {
      await Future<void>.delayed(const Duration(seconds: 5));
      final poll = await http
          .get(Uri.parse(pollingUrl), headers: headers)
          .timeout(const Duration(seconds: 30));
      if (poll.statusCode < 200 || poll.statusCode >= 300) continue;
      final status = jsonDecode(poll.body);
      if (status is! Map) continue;
      switch (status['status']) {
        case 'completed':
          final usage = status['usage'];
          final cost = usage is Map
              ? (usage['cost'] as num?)?.toDouble() ?? 0
              : 0.0;
          return AiVideoResult(
            urls: [for (final u in (status['urls'] as List? ?? const [])) '$u'],
            unsignedUrls: [
              for (final u in (status['unsigned_urls'] as List? ?? const []))
                '$u',
            ],
            costUsd: cost,
          );
        case 'failed' || 'cancelled' || 'expired':
          final err = status['error'];
          throw AiGatewayException(
            statusCode: 0,
            message: err is Map
                ? '${err['message'] ?? 'Video generation ${status['status']}'}'
                : 'Video generation ${status['status']}',
          );
        default:
          continue; // pending / in_progress
      }
    }
    throw const AiGatewayException(
      statusCode: 0,
      message: 'The video is taking too long — try again later.',
    );
  }

  /// Live free-pool quota (OpenRouter only — returns null on providers
  /// without an equivalent endpoint).
  Future<AiFreeQuota?> fetchFreeQuota(AiProviderConfig provider) async {
    if (!isProviderConfigured(provider)) return null;
    try {
      final json = await _http.getJson(
        Uri.parse('${provider.baseUrl}/auth/key'),
        headers: _headers(provider),
      );
      final data = json['data'];
      if (data is Map<String, dynamic>) return AiFreeQuota.tryParse(data);
    } catch (_) {
      // Quota display is best-effort — never block chat on it.
    }
    return null;
  }

  /// Live model catalog (OpenRouter `/models`) — used to refresh USD prices
  /// and surface newly available free models. Null on failure/other shapes.
  Future<List<AiModelEntry>?> fetchCatalog(AiProviderConfig provider) async {
    if (!isProviderConfigured(provider) || provider.modelsPath.isEmpty) {
      return null;
    }
    try {
      final json = await _http.getJson(
        Uri.parse('${provider.baseUrl}${provider.modelsPath}'),
        headers: _headers(provider),
      );
      final data = json['data'];
      if (data is! List) return null;
      final out = <AiModelEntry>[];
      for (final raw in data) {
        if (raw is! Map) continue;
        final id = raw['id'];
        if (id is! String) continue;
        final pricing = raw['pricing'];
        double prompt = 0, completion = 0;
        if (pricing is Map) {
          prompt = double.tryParse('${pricing['prompt'] ?? 0}') ?? 0;
          completion = double.tryParse('${pricing['completion'] ?? 0}') ?? 0;
        }
        final arch = raw['architecture'];
        var modalities = const {AiModality.text};
        if (arch is Map) {
          final outputs = [
            for (final m in (arch['output_modalities'] as List? ?? const []))
              '$m',
          ];
          // Skip non-chat models entirely (the free pool carries embedding /
          // rerank / decision / speech models the chat UI can never call —
          // their output isn't a chat reply).
          const nonChat = {'embeddings', 'rerank', 'decisions', 'speech'};
          if (outputs.any(nonChat.contains)) continue;
          modalities = AiModelEntry.modalitiesFrom(
            inputs: [
              for (final m in (arch['input_modalities'] as List? ?? const []))
                '$m',
            ],
            outputs: outputs,
          );
        }
        out.add(AiModelEntry(
          id: id,
          providerId: provider.id,
          label: (raw['name'] as String?) ?? id,
          promptUsdPerM: prompt * 1e6,
          completionUsdPerM: completion * 1e6,
          modalities: modalities,
        ));
      }
      return out;
    } catch (_) {
      return null;
    }
  }

  AiGatewayException _parseError(int statusCode, String body) {
    String message;
    try {
      final decoded = jsonDecode(body);
      message = decoded is Map && decoded['error'] is Map
          ? (decoded['error']['message'] as String? ?? body)
          : body;
    } catch (_) {
      message = body;
    }
    if (statusCode == 402) {
      message =
          'This model needs credits on the AI provider account — pick a '
          'free model instead.';
    } else if (statusCode == 429) {
      message = 'The free AI pool is busy right now — try again in a minute.';
    }
    return AiGatewayException(statusCode: statusCode, message: message);
  }
}
