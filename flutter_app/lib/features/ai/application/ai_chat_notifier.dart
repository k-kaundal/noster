import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/providers/auth_providers.dart';
import 'package:nostrfeed_mobile/features/ai/application/ai_providers.dart';
import 'package:nostrfeed_mobile/features/ai/data/ai_gateway_service.dart';
import 'package:nostrfeed_mobile/features/ai/domain/ai_gateway.dart';
import 'package:nostrfeed_mobile/features/ai/domain/ai_models.dart';

/// State for the AI chat screen.
class AiChatState {
  final List<AiMessage> messages;

  /// True while a completion is streaming in.
  final bool isStreaming;

  /// One-off error text for the banner (cleared on next send).
  final String? error;

  /// Older messages dropped from the request context on the last send —
  /// the UI surfaces this ("older messages are out of context") so a
  /// trimmed window never reads as the model "forgetting" things.
  final int contextDropped;

  /// The input text of the last FAILED send — the screen restores it into
  /// the composer so a failed message is one tap away from a retry instead
  /// of a retype.
  final String? failedText;

  const AiChatState({
    this.messages = const [],
    this.isStreaming = false,
    this.error,
    this.contextDropped = 0,
    this.failedText,
  });

  AiChatState copyWith({
    List<AiMessage>? messages,
    bool? isStreaming,
    String? error,
    int? contextDropped,
    String? failedText,
    bool clearError = false,
    bool clearFailedText = false,
  }) {
    return AiChatState(
      messages: messages ?? this.messages,
      isStreaming: isStreaming ?? this.isStreaming,
      error: clearError ? null : (error ?? this.error),
      contextDropped: contextDropped ?? this.contextDropped,
      failedText: clearFailedText ? null : (failedText ?? this.failedText),
    );
  }
}

final aiChatNotifierProvider =
    NotifierProvider<AiChatNotifier, AiChatState>(AiChatNotifier.new);

/// The assistant persona. Nostr-aware context is fetched live from the
/// user's relays by `AiContextService` (note/thread links, npub profiles,
/// "#hashtag" summarize requests) and arrives as a second system message —
/// this sets tone + hard safety rules.
const _systemPrompt = 'You are NostrFeed AI, a helpful assistant inside a '
    'Nostr social app. Be concise and friendly. Use markdown formatting. '
    'When a "Live Nostr context" block is provided, answer from it — '
    'summarize, quote and reference what is actually there; never invent '
    'posts or stats. If the context is missing or empty for a Nostr '
    'question, say you could not fetch it from relays right now instead '
    'of guessing. '
    'Never ask for or repeat private keys (nsec) — if a user pastes one, '
    'warn them it is compromised and tell them to rotate it.';

class AiChatNotifier extends Notifier<AiChatState> {
  StreamSubscription<AiStreamChunk>? _activeStream;
  var _idCounter = 0;

  String _nextId(String prefix) =>
      '$prefix-${DateTime.now().microsecondsSinceEpoch}-${_idCounter++}';

  @override
  AiChatState build() {
    ref.onDispose(() => _activeStream?.cancel());
    unawaited(_restoreHistory());
    unawaited(_reconcileCredits());
    return const AiChatState();
  }

  Future<void> _restoreHistory() async {
    final history = await ref.read(aiChatStoreProvider).load();
    if (history.isNotEmpty && state.messages.isEmpty) {
      state = state.copyWith(messages: history);
    }
  }

  /// Pull top-ups from the house wallet that this device hasn't credited
  /// (payments on other devices, or a reinstall). Runs once per AI screen
  /// open; idempotent by payment hash.
  Future<void> _reconcileCredits() async {
    try {
      final auth = ref.read(authStateProvider);
      final pubkey = auth.pubkey;
      if (pubkey == null) return;
      await ref.read(aiCreditsProvider.notifier).reconcile(pubkey);
    } catch (_) {
      // Best-effort — the local ledger is the fallback.
    }
  }

  /// Clears the one-off error banner (called by the UI after reacting to it).
  void clearError() {
    if (state.error != null) state = state.copyWith(clearError: true);
  }

  Future<void> clearChat() async {
    await stopStreaming();
    state = state.copyWith(messages: const []);
    await ref.read(aiChatStoreProvider).clear();
  }

  Future<void> stopStreaming() async {
    await _activeStream?.cancel();
    _activeStream = null;
    if (state.isStreaming) {
      state = state.copyWith(isStreaming: false);
    }
  }

  /// Sends [text] on [model] and streams the reply into the message list.
  ///
  /// Billing: trial message when one is left (trial-eligible models only),
  /// else the estimated price is reserved BEFORE sending and settled to the
  /// EXACT cost (`usage.cost × margin`) after the answer lands — overpayment
  /// is refunded, underpayment (estimate was low) is forgiven, capped at the
  /// user's remaining balance.
  Future<void> send(String text, {required AiModelEntry model}) async {
    final trimmed = text.trim();
    if (trimmed.isEmpty || state.isStreaming) return;

    final config = ref.read(aiGatewayConfigProvider).value;
    if (config == null || !config.enabled) {
      state = state.copyWith(error: 'AI is not available right now.');
      return;
    }
    final provider = config.provider(model.providerId);
    if (provider == null) {
      state = state.copyWith(error: 'Unknown AI provider for this model.');
      return;
    }
    final gateway = ref.read(aiGatewayServiceProvider);
    if (!gateway.isProviderConfigured(provider)) {
      state = state.copyWith(
        error: '${provider.name} is not configured in this build.',
      );
      return;
    }

    // Token pricing is dollar-pegged — no exchange rate needed here.
    final estimate = config.estimatePriceTokens(model);

    // ── Gate: trial first, then credits ─────────────────────────────────
    final trialLeft = ref.read(aiTrialRemainingProvider);
    var usedTrial = false;
    var reserved = 0;
    if (model.trialEligible && trialLeft > 0) {
      usedTrial = true;
    } else {
      final ok = await ref.read(aiCreditsProvider.notifier).debit(estimate);
      if (!ok) {
        state = state.copyWith(error: 'insufficient_credits');
        return;
      }
      reserved = estimate;
    }

    // ── Video generation: async job API, not chat completions ──────────
    if (model.modalities.contains(AiModality.videoGen)) {
      await _sendVideo(
        trimmed,
        model: model,
        provider: provider,
        gateway: gateway,
        config: config,
        reserved: reserved,
      );
      return;
    }

    final userMessage = AiMessage(
      id: _nextId('u'),
      role: AiRole.user,
      content: trimmed,
      createdAt: DateTime.now(),
    );
    final assistantMessage = AiMessage(
      id: _nextId('a'),
      role: AiRole.assistant,
      content: '',
      createdAt: DateTime.now(),
    );
    state = state.copyWith(
      messages: [...state.messages, userMessage, assistantMessage],
      isStreaming: true,
      clearError: true,
      clearFailedText: true,
    );

    // Relay access: fetch live Nostr context for this message (note/thread
    // links, npub profiles, "#hashtag" summarize requests). Best-effort —
    // bounded internally, null when nothing fetchable is referenced.
    final nostrContext =
        await ref.read(aiContextServiceProvider).buildContext(trimmed);

    // Fit the window into the request budget: every message capped, oldest
    // dropped first, and the fetched Nostr context counted AGAINST the
    // budget so a big relay fetch shrinks history instead of blowing the
    // model's context window (the "AI forgot everything" bug class).
    final window = trimToContextBudget(
      state.messages.where((m) => m.id != assistantMessage.id).toList(),
      reservedChars:
          _systemPrompt.length + (nostrContext?.length ?? 0) + 500,
    );

    final requestMessages = [
      AiMessage(
        id: 'sys',
        role: AiRole.system,
        content: _systemPrompt,
        createdAt: DateTime.now(),
      ),
      if (nostrContext != null)
        AiMessage(
          id: 'ctx',
          role: AiRole.system,
          content: nostrContext,
          createdAt: DateTime.now(),
        ),
      ...window.messages,
    ];

    // Candidate models: the picked one, then config fallbacks (free pool).
    final candidates = <String>[
      model.id,
      if (model.trialEligible)
        ...config.fallbackModelIds.where((id) => id != model.id),
    ];

    final buffer = StringBuffer();
    final generatedImages = <String>[];
    AiUsage? finalUsage;
    String? streamError;

    for (var attempt = 0; attempt < candidates.length; attempt++) {
      streamError = null;
      await for (final chunk in gateway
          .streamChat(
            provider: provider,
            messages: requestMessages,
            modelId: candidates[attempt],
          )
          .handleError((Object e) {
        streamError = e is AiGatewayException ? e.message : '$e';
      })) {
        if (streamError != null) break;
        buffer.write(chunk.delta);
        if (chunk.images.isNotEmpty) {
          generatedImages.addAll(chunk.images);
          _updateLast(buffer.toString());
        }
        if (chunk.usage != null) finalUsage = chunk.usage;
        _updateLast(buffer.toString());
      }
      final retryable = streamError != null &&
          streamError!.contains('busy') &&
          attempt < candidates.length - 1 &&
          buffer.isEmpty;
      if (!retryable) break;
    }

    if (streamError != null) {
      // Refund the reserve (trial was never consumed), keep the text for
      // one-tap retry, and remove the empty assistant placeholder.
      if (!usedTrial && reserved > 0) {
        await ref.read(aiCreditsProvider.notifier).credit(reserved);
      }
      final messages = [...state.messages]
        ..removeWhere((m) => m.id == assistantMessage.id);
      state = state.copyWith(
        messages: messages,
        isStreaming: false,
        error: streamError,
        failedText: trimmed,
      );
      return;
    }

    // Success — consume trial AFTER a delivered answer.
    if (usedTrial) {
      await ref.read(aiTrialUsedProvider.notifier).increment();
    }

    // ── Settle to exact cost (usage.cost × margin), refund the difference ─
    var charged = usedTrial ? 0 : reserved;
    if (!usedTrial && finalUsage != null) {
      final exact = config.settlePriceTokens(finalUsage.costUsd);
      final balance =
          ref.read(aiCreditsProvider).value?.balance ?? 0;
      // Cap the top-up: never more than the allowed overage above reserve,
      // and never more than the user can actually cover. This bounds what a
      // runaway (reasoning-heavy) request can cost both sides.
      final capped = config.cappedSettleTokens(exact, reserved);
      final settle =
          capped > reserved + balance ? reserved + balance : capped;
      final delta = reserved - settle;
      if (delta > 0) {
        await ref.read(aiCreditsProvider.notifier).credit(delta);
      } else if (delta < 0) {
        await ref.read(aiCreditsProvider.notifier).debit(-delta);
      }
      charged = settle;
    }

    final settled = assistantMessage.copyWith(
      content: buffer.toString(),
      costTokens: charged,
      costUsd: finalUsage?.costUsd ?? 0,
      model: finalUsage?.model ?? model.id,
      images: generatedImages,
    );
    final messages = [...state.messages];
    final idx = messages.indexWhere((m) => m.id == assistantMessage.id);
    if (idx >= 0) messages[idx] = settled;
    state = state.copyWith(
      messages: messages,
      isStreaming: false,
      contextDropped: window.dropped,
    );
    await ref.read(aiChatStoreProvider).save(messages);

    if (model.trialEligible) ref.invalidate(aiFreeQuotaProvider);
  }

  void _updateLast(String content) {
    final messages = [...state.messages];
    if (messages.isEmpty) return;
    messages[messages.length - 1] =
        messages[messages.length - 1].copyWith(content: content);
    state = state.copyWith(messages: messages);
  }

  /// Video-generation path: submit → poll → attach the finished video.
  ///
  /// Video jobs take 30s–several minutes, so unlike chat this can't
  /// stream — the assistant message shows a progress note that flips to
  /// the finished player. Settlement is the same reserve → exact-cost
  /// refund flow as chat (the job reports `usage.cost` on completion).
  Future<void> _sendVideo(
    String prompt, {
    required AiModelEntry model,
    required AiProviderConfig provider,
    required AiGatewayService gateway,
    required AiGatewayConfig config,
    required int reserved,
  }) async {
    final userMessage = AiMessage(
      id: _nextId('u'),
      role: AiRole.user,
      content: prompt,
      createdAt: DateTime.now(),
    );
    final assistantMessage = AiMessage(
      id: _nextId('a'),
      role: AiRole.assistant,
      content:
          '🎬 Generating your video — this usually takes a minute or two…',
      createdAt: DateTime.now(),
    );
    state = state.copyWith(
      messages: [...state.messages, userMessage, assistantMessage],
      isStreaming: true,
      clearError: true,
    );

    try {
      final result = await gateway.generateVideo(
        provider: provider,
        modelId: model.id,
        prompt: prompt,
      );

      // ── Settle to exact cost (usage.cost × margin), refund the rest ──
      var charged = reserved;
      final exact = config.settlePriceTokens(result.costUsd);
      final balance = ref.read(aiCreditsProvider).value?.balance ?? 0;
      final capped = config.cappedSettleTokens(exact, reserved);
      final settle = capped > reserved + balance ? reserved + balance : capped;
      final delta = reserved - settle;
      if (delta > 0) {
        await ref.read(aiCreditsProvider.notifier).credit(delta);
      } else if (delta < 0) {
        await ref.read(aiCreditsProvider.notifier).debit(-delta);
      }
      charged = settle;

      final urls =
          result.urls.isNotEmpty ? result.urls : result.unsignedUrls;
      if (urls.isEmpty) {
        // Nothing downloadable was delivered — refund everything.
        await ref.read(aiCreditsProvider.notifier).credit(charged);
        charged = 0;
      }
      final settled = assistantMessage.copyWith(
        content: urls.isEmpty
            ? 'The video finished but the provider returned no download '
                'URLs — your credits were refunded.'
            : 'Here\'s your video:',
        costTokens: charged,
        costUsd: result.costUsd,
        model: model.id,
        videos: urls,
      );
      final messages = [...state.messages];
      final idx = messages.indexWhere((m) => m.id == assistantMessage.id);
      if (idx >= 0) messages[idx] = settled;
      state = state.copyWith(messages: messages, isStreaming: false);
      await ref.read(aiChatStoreProvider).save(messages);
    } on AiGatewayException catch (e) {
      // Refund the reserve — nothing was delivered.
      if (reserved > 0) {
        await ref.read(aiCreditsProvider.notifier).credit(reserved);
      }
      final messages = [...state.messages]
        ..removeWhere((m) => m.id == assistantMessage.id);
      state = state.copyWith(
        messages: messages,
        isStreaming: false,
        error: e.message,
      );
    }
  }
}
