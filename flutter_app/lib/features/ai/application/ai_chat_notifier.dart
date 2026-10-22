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

  const AiChatState({
    this.messages = const [],
    this.isStreaming = false,
    this.error,
  });

  AiChatState copyWith({
    List<AiMessage>? messages,
    bool? isStreaming,
    String? error,
    bool clearError = false,
  }) {
    return AiChatState(
      messages: messages ?? this.messages,
      isStreaming: isStreaming ?? this.isStreaming,
      error: clearError ? null : (error ?? this.error),
    );
  }
}

final aiChatNotifierProvider =
    NotifierProvider<AiChatNotifier, AiChatState>(AiChatNotifier.new);

/// The assistant persona. Nostr-aware context (feed/mentions stuffing) is a
/// Phase 2 hook — for now this sets tone + hard safety rules.
const _systemPrompt = 'You are NostrFeed AI, a helpful assistant inside a '
    'Nostr social app. Be concise and friendly. Use markdown formatting. '
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

    final satsPerUsd = await ref.read(aiSatsPerUsdProvider.future);
    final estimate = config.estimatePriceSats(model, satsPerUsd: satsPerUsd);

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
    );

    final history = state.messages.length > 21
        ? state.messages.sublist(state.messages.length - 21)
        : state.messages;
    final requestMessages = [
      AiMessage(
        id: 'sys',
        role: AiRole.system,
        content: _systemPrompt,
        createdAt: DateTime.now(),
      ),
      ...history.where((m) => m.id != assistantMessage.id),
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
      // Refund the reserve (trial was never consumed).
      if (!usedTrial && reserved > 0) {
        await ref.read(aiCreditsProvider.notifier).credit(reserved);
      }
      final messages = [...state.messages]
        ..removeWhere((m) => m.id == assistantMessage.id);
      state = state.copyWith(
        messages: messages,
        isStreaming: false,
        error: streamError,
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
      final exact = config.settlePriceSats(
        finalUsage.costUsd,
        satsPerUsd: satsPerUsd,
      );
      final balance =
          ref.read(aiCreditsProvider).value?.balance ?? 0;
      // Never charge more than reserve + what the user can cover.
      final settle = exact > reserved + balance ? reserved : exact;
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
      costSats: charged,
      costUsd: finalUsage?.costUsd ?? 0,
      model: finalUsage?.model ?? model.id,
      images: generatedImages,
    );
    final messages = [...state.messages];
    final idx = messages.indexWhere((m) => m.id == assistantMessage.id);
    if (idx >= 0) messages[idx] = settled;
    state = state.copyWith(messages: messages, isStreaming: false);
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
}
