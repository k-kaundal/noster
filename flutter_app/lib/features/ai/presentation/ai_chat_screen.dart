import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/widgets/app_sheet.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/core/widgets/detail_scaffold.dart';
import 'package:nostrfeed_mobile/core/widgets/empty_state.dart';
import 'package:nostrfeed_mobile/features/ai/application/ai_chat_notifier.dart';
import 'package:nostrfeed_mobile/features/ai/application/ai_providers.dart';
import 'package:nostrfeed_mobile/features/ai/domain/ai_gateway.dart';
import 'package:nostrfeed_mobile/features/ai/domain/ai_models.dart';
import 'package:nostrfeed_mobile/features/ai/presentation/widgets/ai_generated_media.dart';
import 'package:nostrfeed_mobile/features/ai/presentation/widgets/ai_model_picker.dart';
import 'package:nostrfeed_mobile/features/ai/presentation/widgets/ai_top_up_sheet.dart';
import 'package:share_plus/share_plus.dart';

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

    // Surface send errors (insufficient credits → top-up sheet) and, on a
    // failed send, restore the text into the composer so a retry is one
    // tap instead of a retype.
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
    ref.listen(aiChatNotifierProvider.select((s) => s.failedText),
        (_, failedText) {
      if (failedText != null && failedText.isNotEmpty) {
        _inputController.text = failedText;
        _inputController.selection =
            TextSelection.collapsed(offset: failedText.length);
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
                          ? _WelcomeView(
                              onPrompt: (prompt) {
                                if (selectedModel != null) {
                                  notifier.send(prompt, model: selectedModel);
                                }
                              },
                              onFill: (text) {
                                // Suggestions that need user input (a note
                                // link) prefill the composer instead of
                                // sending an instruction as the message.
                                _inputController.text = text;
                                _inputController.selection =
                                    TextSelection.collapsed(
                                  offset: text.length,
                                );
                              },
                            )
                          : ListView.builder(
                              controller: _scrollController,
                              padding: const EdgeInsets.symmetric(
                                horizontal: 12,
                                vertical: 8,
                              ),
                              // +1 for the context-clipped note when older
                              // messages fell out of the request window.
                              itemCount: chatState.messages.length +
                                  (chatState.contextDropped > 0 ? 1 : 0),
                              itemBuilder: (context, index) {
                                if (chatState.contextDropped > 0) {
                                  if (index == 0) {
                                    return _ContextNote(
                                      dropped: chatState.contextDropped,
                                    );
                                  }
                                  index -= 1;
                                }
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

/// The "older messages are out of context" note — shown at the top of the
/// conversation when the request window dropped history. A silent trim
/// would read as the model "forgetting" things it was never told.
class _ContextNote extends StatelessWidget {
  final int dropped;

  const _ContextNote({required this.dropped});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Center(
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 6),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: scheme.surfaceContainerHighest.withValues(alpha: 0.7),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Text(
          '$dropped older ${dropped == 1 ? 'message' : 'messages'} out of '
          'context — clear chat to reset',
          style: TextStyle(fontSize: 11, color: scheme.onSurfaceVariant),
          textAlign: TextAlign.center,
        ),
      ),
    );
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

/// The empty chat state — teaches with tappable first prompts instead of
/// sitting blank (an empty state that onboards beats one that churns).
class _WelcomeView extends StatelessWidget {
  final ValueChanged<String> onPrompt;

  /// Prefills the composer (suggestions needing user input, like a note
  /// link, edit before sending).
  final ValueChanged<String> onFill;

  const _WelcomeView({required this.onPrompt, required this.onFill});

  /// (icon, label, prompt, prefillOnly) — prefill-only suggestions carry
  /// a placeholder the user replaces (a note link to summarize).
  static const _suggestions = <(IconData, String, String, bool)>[
    (
      Icons.summarize_outlined,
      'Summarize #hashtag',
      'Summarize the top posts on #bitcoin today in 5 bullet points',
      false,
    ),
    (
      Icons.link_rounded,
      'Summarize a thread',
      'Summarize this thread: ',
      true,
    ),
    (
      Icons.edit_outlined,
      'Draft a post',
      'Draft a short Nostr post about why decentralization matters',
      false,
    ),
  ];

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return Center(
      child: SingleChildScrollView(
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
              'Summarize threads, hashtags and people straight from your '
              'relays, translate, draft, generate images and video, '
              'or just chat. Paid in tokens — only for what you use.',
              textAlign: TextAlign.center,
              style: TextStyle(color: scheme.onSurfaceVariant),
            ),
            const SizedBox(height: 24),
            for (final (icon, label, prompt, prefillOnly) in _suggestions) ...[
              _SuggestionChip(
                icon: icon,
                label: label,
                prompt: prefillOnly
                    ? 'Paste a note1… / nevent1… link — I\'ll fetch the '
                        'thread from your relays'
                    : prompt,
                onTap: () =>
                    prefillOnly ? onFill(prompt) : onPrompt(prompt),
              ),
              const SizedBox(height: 8),
            ],
          ],
        ),
      ),
    );
  }
}

class _SuggestionChip extends StatelessWidget {
  final IconData icon;
  final String label;
  final String prompt;
  final VoidCallback onTap;

  const _SuggestionChip({
    required this.icon,
    required this.label,
    required this.prompt,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: onTap,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
        decoration: BoxDecoration(
          color: scheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          children: [
            Icon(icon, size: 18, color: scheme.primary),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    label,
                    style: const TextStyle(
                      fontWeight: FontWeight.w600,
                      fontSize: 13,
                    ),
                  ),
                  Text(
                    prompt,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 11,
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
            Icon(Icons.north_west_rounded,
                size: 14, color: scheme.onSurfaceVariant),
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
                '~$price tokens/msg',
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
    final balance = ref.watch(aiCreditsProvider).valueOrNull?.balance ?? 0;
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
      child: GestureDetector(
        // Long-press: copy / share the answer — the two things a user
        // expects to do with a good AI reply and couldn't.
        onLongPress: message.content.isEmpty
            ? null
            : () => _showActions(context, message),
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
                  child: AiGeneratedImage(
                    urlOrDataUrl: message.images.first,
                  ),
                ),
              if (message.videos.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: AiGeneratedVideo(url: message.videos.first),
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
                '${message.model} · ${message.costTokens == 0 ? "trial" : "${message.costTokens} tokens"}',
                style: TextStyle(fontSize: 10, color: scheme.onSurfaceVariant),
              ),
            ],
          ],
        ),
      ),
      ),
    );
  }

  /// Long-press actions: copy the answer to the clipboard or share it out —
  /// the two things a user expects to do with a good AI reply.
  void _showActions(BuildContext context, AiMessage message) {
    final scheme = Theme.of(context).colorScheme;
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: Icon(Icons.copy_rounded, color: scheme.primary),
              title: const Text('Copy text'),
              onTap: () {
                Navigator.of(sheetContext).pop();
                Clipboard.setData(ClipboardData(text: message.content));
                AppToast.success(context, 'Copied');
              },
            ),
            ListTile(
              leading: Icon(Icons.share_rounded, color: scheme.primary),
              title: const Text('Share…'),
              onTap: () {
                Navigator.of(sheetContext).pop();
                SharePlus.instance.share(
                  ShareParams(text: message.content),
                );
              },
            ),
            const SizedBox(height: 8),
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
                          : 'Out of tokens — tap the balance to top up',
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
                  ? '$trialLeft free messages left today · then ~$price tokens/msg'
                  : '≈ $price tokens per message on ${model.label}',
              style: TextStyle(fontSize: 11, color: scheme.onSurfaceVariant),
            ),
          ],
        ),
      ),
    );
  }
}
