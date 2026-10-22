import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/widgets/app_sheet.dart';
import 'package:nostrfeed_mobile/core/widgets/detail_scaffold.dart';
import 'package:nostrfeed_mobile/core/widgets/empty_state.dart';
import 'package:nostrfeed_mobile/features/ai/application/ai_chat_notifier.dart';
import 'package:nostrfeed_mobile/features/ai/application/ai_providers.dart';
import 'package:nostrfeed_mobile/features/ai/domain/ai_gateway.dart';
import 'package:nostrfeed_mobile/features/ai/domain/ai_models.dart';
import 'package:nostrfeed_mobile/features/ai/presentation/widgets/ai_model_picker.dart';
import 'package:nostrfeed_mobile/features/ai/presentation/widgets/ai_top_up_sheet.dart';

/// The AI assistant chat screen — streaming, markdown answers, per-model
/// sats pricing (upstream cost × operator margin).
class AiChatScreen extends ConsumerStatefulWidget {
  const AiChatScreen({super.key});

  @override
  ConsumerState<AiChatScreen> createState() => _AiChatScreenState();
}

class _AiChatScreenState extends ConsumerState<AiChatScreen> {
  final _inputController = TextEditingController();
  final _scrollController = ScrollController();
  var _privacyNoticeShown = false;

  @override
  void dispose() {
    _inputController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final chatState = ref.watch(aiChatNotifierProvider);
    final notifier = ref.read(aiChatNotifierProvider.notifier);
    final available = ref.watch(aiAvailableProvider);
    final configAsync = ref.watch(aiGatewayConfigProvider);

    ref.listen(aiChatNotifierProvider, (_, next) {
      if (next.messages.isNotEmpty) _privacyNoticeShown = true;
    });

    // Surface send errors (insufficient credits → top-up sheet).
    ref.listen(aiChatNotifierProvider.select((s) => s.error), (_, error) {
      if (error == 'insufficient_credits') {
        notifier.clearError();
        showAiTopUpSheet(context);
      } else if (error != null && error.isNotEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(error)),
        );
        notifier.clearError();
      }
    });

    final selectedModel = ref.watch(aiSelectedModelProvider);

    return DetailScaffold(
      title: 'NostrFeed AI',
      actions: [
        const _BalanceChip(),
        IconButton(
          icon: const Icon(Icons.delete_outline_rounded),
          tooltip: 'Clear chat',
          onPressed: chatState.messages.isEmpty
              ? null
              : () async {
                  final confirmed = await AppDialog.confirm(
                    context,
                    title: 'Clear chat history?',
                    message: 'This deletes the conversation on this device.',
                    confirmLabel: 'Clear',
                  );
                  if (confirmed) notifier.clearChat();
                },
        ),
      ],
      body: configAsync.isLoading
          ? const Center(child: CircularProgressIndicator())
          : !available
              ? const EmptyState(
                  icon: Icons.smart_toy_outlined,
                  title: 'AI not configured',
                  subtitle:
                      'This build has no AI provider key. Run with --dart-define-from-file=.env',
                )
              : Column(
                  children: [
                    if (!_privacyNoticeShown && chatState.messages.isEmpty)
                      const _PrivacyBanner(),
                    if (selectedModel != null)
                      _ModelSelectorButton(model: selectedModel),
                    Expanded(
                      child: chatState.messages.isEmpty
                          ? const _WelcomeView()
                          : ListView.builder(
                              controller: _scrollController,
                              padding: const EdgeInsets.symmetric(
                                horizontal: 12,
                                vertical: 8,
                              ),
                              itemCount: chatState.messages.length,
                              itemBuilder: (context, index) {
                                final message = chatState.messages[index];
                                if (message.role == AiRole.system) {
                                  return const SizedBox.shrink();
                                }
                                return _MessageBubble(
                                  message: message,
                                  isStreaming: chatState.isStreaming &&
                                      index == chatState.messages.length - 1,
                                );
                              },
                            ),
                    ),
                    if (selectedModel != null)
                      _InputBar(
                        controller: _inputController,
                        model: selectedModel,
                        isStreaming: chatState.isStreaming,
                        onSend: (text) {
                          notifier.send(text, model: selectedModel);
                          _inputController.clear();
                          _scrollToEnd();
                        },
                        onStop: notifier.stopStreaming,
                      ),
                  ],
                ),
    );
  }

  void _scrollToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 250),
          curve: Curves.easeOut,
        );
      }
    });
  }
}

class _PrivacyBanner extends StatelessWidget {
  const _PrivacyBanner();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.fromLTRB(12, 8, 12, 0),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: scheme.tertiaryContainer.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: [
          Icon(Icons.privacy_tip_outlined, size: 18, color: scheme.tertiary),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              'Messages are processed by third-party AI providers. '
              'Never share your nsec or secrets.',
              style: TextStyle(fontSize: 12, color: scheme.onSurface),
            ),
          ),
        ],
      ),
    );
  }
}

class _WelcomeView extends StatelessWidget {
  const _WelcomeView();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.smart_toy_rounded, size: 56, color: scheme.primary),
            const SizedBox(height: 16),
            Text(
              'Ask me anything',
              style: theme.textTheme.titleLarge
                  ?.copyWith(fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 8),
            Text(
              'Summarize a thread, translate a post, draft a reply, '
              'or just chat. Paid in sats — only for what you use.',
              textAlign: TextAlign.center,
              style: TextStyle(color: scheme.onSurfaceVariant),
            ),
          ],
        ),
      ),
    );
  }
}

/// Compact bar showing the active model — taps open the full picker sheet.
class _ModelSelectorButton extends ConsumerWidget {
  final AiModelEntry model;

  const _ModelSelectorButton({required this.model});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final price = ref.watch(aiModelPriceProvider(model));

    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 6, 12, 2),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => showAiModelPicker(context),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: scheme.surfaceContainerHighest,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Row(
            children: [
              Icon(Icons.auto_awesome_rounded, size: 16, color: scheme.primary),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  model.label,
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              Icon(Icons.bolt_rounded, size: 13, color: scheme.primary),
              Text(
                '~$price⚡/msg',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: scheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(width: 4),
              Icon(
                Icons.unfold_more_rounded,
                size: 16,
                color: scheme.onSurfaceVariant,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _BalanceChip extends ConsumerWidget {
  const _BalanceChip();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final balance = ref.watch(aiCreditsProvider).value?.balance ?? 0;
    final trialLeft = ref.watch(aiTrialRemainingProvider);
    final scheme = Theme.of(context).colorScheme;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: () => showAiTopUpSheet(context),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
          decoration: BoxDecoration(
            color: scheme.surfaceContainerHighest,
            borderRadius: BorderRadius.circular(16),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.bolt_rounded, size: 14, color: scheme.primary),
              const SizedBox(width: 2),
              Text(
                trialLeft > 0 ? '$trialLeft free · $balance' : '$balance',
                style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MessageBubble extends StatelessWidget {
  final AiMessage message;
  final bool isStreaming;

  const _MessageBubble({required this.message, this.isStreaming = false});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isUser = message.role == AiRole.user;

    return Align(
      alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 4),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        constraints: BoxConstraints(
          maxWidth: MediaQuery.of(context).size.width * 0.82,
        ),
        decoration: BoxDecoration(
          color: isUser ? scheme.primary : scheme.surfaceContainerHighest,
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(16),
            topRight: const Radius.circular(16),
            bottomLeft: Radius.circular(isUser ? 16 : 4),
            bottomRight: Radius.circular(isUser ? 4 : 16),
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (isUser)
              Text(
                message.content,
                style: TextStyle(color: scheme.onPrimary, fontSize: 15),
              )
            else ...[
              if (message.images.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(10),
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxHeight: 320),
                      child: Image.network(
                        message.images.first,
                        fit: BoxFit.contain,
                        loadingBuilder: (context, child, progress) =>
                            progress == null
                                ? child
                                : const SizedBox(
                                    height: 120,
                                    child: Center(
                                      child: CircularProgressIndicator(),
                                    ),
                                  ),
                        errorBuilder: (_, _, _) => const SizedBox(
                          height: 60,
                          child: Center(
                            child: Text('Image could not be loaded'),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              MarkdownBody(
                data: message.content.isEmpty && isStreaming
                    ? '…'
                    : message.content,
                styleSheet: MarkdownStyleSheet(
                  p: TextStyle(color: scheme.onSurface, fontSize: 15),
                  code: TextStyle(
                    backgroundColor: scheme.surfaceContainer,
                    color: scheme.onSurface,
                    fontFamily: 'monospace',
                  ),
                  codeblockDecoration: BoxDecoration(
                    color: scheme.surfaceContainer,
                    borderRadius: BorderRadius.circular(8),
                  ),
                ),
              ),
            ],
            if (!isUser && !isStreaming && message.model != null) ...[
              const SizedBox(height: 4),
              Text(
                '${message.model} · ${message.costSats == 0 ? "trial" : "${message.costSats}⚡"}',
                style: TextStyle(fontSize: 10, color: scheme.onSurfaceVariant),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _InputBar extends ConsumerWidget {
  final TextEditingController controller;
  final AiModelEntry model;
  final bool isStreaming;
  final ValueChanged<String> onSend;
  final VoidCallback onStop;

  const _InputBar({
    required this.controller,
    required this.model,
    required this.isStreaming,
    required this.onSend,
    required this.onStop,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final canSend = ref.watch(aiCanSendProvider(model));
    final price = ref.watch(aiModelPriceProvider(model));
    final trialLeft = ref.watch(aiTrialRemainingProvider);
    final showTrial = model.trialEligible && trialLeft > 0;

    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 6, 12, 10),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Expanded(
                  child: TextField(
                    controller: controller,
                    minLines: 1,
                    maxLines: 5,
                    textInputAction: TextInputAction.send,
                    onSubmitted: canSend ? onSend : null,
                    decoration: InputDecoration(
                      hintText: canSend
                          ? 'Message…'
                          : 'Out of credits — tap ⚡ to top up',
                      filled: true,
                      fillColor: scheme.surfaceContainerHighest,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(24),
                        borderSide: BorderSide.none,
                      ),
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 10,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                isStreaming
                    ? IconButton.filled(
                        onPressed: onStop,
                        icon: const Icon(Icons.stop_rounded),
                        tooltip: 'Stop',
                      )
                    : IconButton.filled(
                        onPressed:
                            canSend ? () => onSend(controller.text) : null,
                        icon: const Icon(Icons.send_rounded),
                        tooltip: 'Send',
                      ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              showTrial
                  ? '$trialLeft free messages left today · then ~$price⚡/msg'
                  : '≈ $price⚡ per message on ${model.label}',
              style: TextStyle(fontSize: 11, color: scheme.onSurfaceVariant),
            ),
          ],
        ),
      ),
    );
  }
}
