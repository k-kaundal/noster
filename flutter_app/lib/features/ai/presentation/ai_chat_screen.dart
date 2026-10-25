import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/theme/app_motion.dart';
import 'package:nostrfeed_mobile/core/theme/app_shapes.dart';
import 'package:nostrfeed_mobile/core/theme/app_spacing.dart';
import 'package:nostrfeed_mobile/core/theme/app_theme.dart';
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
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';
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
        AppToast.error(context, error);
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
          icon: const AppIcon('eye_off'),
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
          duration: AppMotion.normal,
          curve: AppMotion.curve,
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
          borderRadius: AppShapes.radiusMd,
        ),
        child: Text(
          '$dropped older ${dropped == 1 ? 'message' : 'messages'} out of '
          'context — clear chat to reset',
          style: Theme.of(context)
              .textTheme
              .labelSmall
              ?.copyWith(color: scheme.onSurfaceVariant),
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
        borderRadius: AppShapes.radiusMd,
      ),
      child: Row(
        children: [
          AppIcon('key', size: 18, color: scheme.tertiary),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              'Messages are processed by third-party AI providers. '
              'Never share your nsec or secrets.',
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: scheme.onSurface),
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
  static const _suggestions = <(String, String, String, bool)>[
    (
      'article',
      'Summarize #hashtag',
      'Summarize the top posts on #bitcoin today in 5 bullet points',
      false,
    ),
    (
      'link',
      'Summarize a thread',
      'Summarize this thread: ',
      true,
    ),
    (
      'edit',
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
            AppIcon('sparkle', size: 56, color: scheme.primary),
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
              style: theme.textTheme.bodyMedium
                  ?.copyWith(color: scheme.onSurfaceVariant),
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
  final String icon;
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
      borderRadius: AppShapes.radiusMd,
      onTap: onTap,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.sm + 2, vertical: AppSpacing.sm - 1),
        decoration: BoxDecoration(
          color: scheme.surfaceContainerHighest,
          borderRadius: AppShapes.radiusMd,
        ),
        child: Row(
          children: [
            AppIcon(icon, size: AppIconSize.md, color: scheme.primary),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    label,
                    style: Theme.of(context)
                        .textTheme
                        .bodySmall
                        ?.copyWith(fontWeight: FontWeight.w600),
                  ),
                  Text(
                    prompt,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context)
                        .textTheme
                        .labelSmall
                        ?.copyWith(color: scheme.onSurfaceVariant),
                  ),
                ],
              ),
            ),
            AppIcon('back',
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
        borderRadius: AppShapes.radiusMd,
        onTap: () => showAiModelPicker(context),
        child: Container(
          padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.sm, vertical: AppSpacing.xs),
          decoration: BoxDecoration(
            color: scheme.surfaceContainerHighest,
            borderRadius: AppShapes.radiusMd,
          ),
          child: Row(
            children: [
              AppIcon('sparkle', size: 16, color: scheme.primary),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  model.label,
                  style: Theme.of(context)
                      .textTheme
                      .bodySmall
                      ?.copyWith(fontWeight: FontWeight.w600),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              AppIcon('zap', size: 13, color: scheme.primary),
              Text(
                '~$price tokens/msg',
                style: Theme.of(context).textTheme.labelMedium?.copyWith(
                      fontWeight: FontWeight.w600,
                      color: scheme.onSurfaceVariant,
                    ),
              ),
              const SizedBox(width: 4),
              AppIcon('chevron_r',
                  size: AppIconSize.sm, color: scheme.onSurfaceVariant),
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
        borderRadius: AppShapes.radiusFull,
        onTap: () => showAiTopUpSheet(context),
        child: Container(
          padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.sm - 2, vertical: AppSpacing.xxs),
          decoration: BoxDecoration(
            color: scheme.surfaceContainerHighest,
            borderRadius: AppShapes.radiusFull,
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              AppIcon('zap', size: 14, color: scheme.primary),
              const SizedBox(width: 2),
              Text(
                trialLeft > 0 ? '$trialLeft free · $balance' : '$balance',
                style: Theme.of(context)
                    .textTheme
                    .labelMedium
                    ?.copyWith(fontWeight: FontWeight.w600),
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
          // Mine = flat tertiary (the accent); theirs = surfaceContainerHighest.
          color: isUser ? scheme.tertiary : scheme.surfaceContainerHighest,
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(AppShapes.lg),
            topRight: const Radius.circular(AppShapes.lg),
            bottomLeft: Radius.circular(isUser ? AppShapes.lg : AppShapes.xs),
            bottomRight: Radius.circular(isUser ? AppShapes.xs : AppShapes.lg),
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (isUser)
              Text(
                message.content,
                style: Theme.of(context)
                    .textTheme
                    .bodyLarge
                    ?.copyWith(color: scheme.onTertiary),
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
                  p: Theme.of(context)
                      .textTheme
                      .bodyLarge
                      ?.copyWith(color: scheme.onSurface),
                  code: TextStyle(
                    backgroundColor: scheme.surfaceContainer,
                    color: scheme.onSurface,
                    fontFamily: 'monospace',
                  ),
                  codeblockDecoration: BoxDecoration(
                    color: scheme.surfaceContainer,
                    borderRadius: AppShapes.radiusSm,
                  ),
                ),
              ),
            ],
            if (!isUser && !isStreaming && message.model != null) ...[
              const SizedBox(height: 4),
              Builder(
                builder: (context) {
                  final tokens = message.costTokens ?? 0;
                  final zapColor =
                      AppActionColors.zapFor(Theme.of(context).brightness);
                  return Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (tokens > 0) ...[
                        AppIcon('zap', size: AppIconSize.xs, color: zapColor),
                        const SizedBox(width: 2),
                      ],
                      Text(
                        '${message.model} · ${tokens == 0 ? "trial" : "$tokens tokens"}',
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(
                              color: tokens == 0
                                  ? scheme.onSurfaceVariant
                                  : zapColor,
                            ),
                      ),
                    ],
                  );
                },
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
              leading: AppIcon('edit', color: scheme.primary),
              title: const Text('Copy text'),
              onTap: () {
                Navigator.of(sheetContext).pop();
                Clipboard.setData(ClipboardData(text: message.content));
                AppToast.success(context, 'Copied');
              },
            ),
            ListTile(
              leading: AppIcon('share', color: scheme.primary),
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
                        borderRadius: AppShapes.radiusPill,
                        borderSide: BorderSide.none,
                      ),
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: AppSpacing.md,
                        vertical: AppSpacing.sm - 2,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                isStreaming
                    ? IconButton.filled(
                        onPressed: onStop,
                        icon: const AppIcon('plus'),
                        tooltip: 'Stop',
                      )
                    : IconButton.filled(
                        onPressed:
                            canSend ? () => onSend(controller.text) : null,
                        icon: const AppIcon('send'),
                        tooltip: 'Send',
                      ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              showTrial
                  ? '$trialLeft free messages left today · then ~$price tokens/msg'
                  : '≈ $price tokens per message on ${model.label}',
              style: Theme.of(context)
                  .textTheme
                  .labelSmall
                  ?.copyWith(color: scheme.onSurfaceVariant),
            ),
          ],
        ),
      ),
    );
  }
}
