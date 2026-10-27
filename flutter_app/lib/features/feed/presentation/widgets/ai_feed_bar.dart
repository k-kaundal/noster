import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:nostrfeed_mobile/core/theme/app_shapes.dart';
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';

/// The AI entry bar at the top of the For You feed — a NATIVE feature entry
/// point (like WhatsApp's Meta AI bar or X's Grok button), NOT a promo card.
///
/// AGENTS.md rule honored: the old `_AiPromoCard` (an injected ad-style card)
/// was removed because it read as an ad. This is different: a persistent,
/// quiet input that looks and behaves like the app's own search bar — it
/// answers "what can the AI do for me" (summarize the feed, explain a post,
/// ask anything), not "please use our AI". It sits above the first post in
/// the For You tab only, never injected mid-feed.
class AiFeedBar extends ConsumerWidget {
  const AiFeedBar({super.key});

  /// Rotating suggestion chips — concrete, useful prompts (context-aware AI
  /// is the differentiator: it reads your actual feed/relays).
  static const _suggestions = [
    'Summarize my feed',
    "What's trending today",
    'Explain a post to me',
  ];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;

    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // The ask bar — search-bar shape, quiet accent border.
          Semantics(
            button: true,
            label: 'Ask Nova AI',
            child: Material(
              color: scheme.surfaceContainerLowest,
              borderRadius: AppShapes.radiusFull,
              child: InkWell(
                borderRadius: AppShapes.radiusFull,
                onTap: () {
                  HapticFeedback.lightImpact();
                  context.push('/ai');
                },
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 12,
                  ),
                  decoration: BoxDecoration(
                    borderRadius: AppShapes.radiusFull,
                    border: Border.all(
                      color: scheme.primary.withValues(alpha: 0.35),
                      width: 1,
                    ),
                  ),
                  child: Row(
                    children: [
                      AppIcon(
                        'sparkle',
                        size: AppIconSize.lg,
                        color: scheme.primary,
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          'Ask Nova AI anything…',
                          style: textTheme.bodyMedium?.copyWith(
                            color: scheme.onSurfaceVariant,
                          ),
                        ),
                      ),
                      AppIcon(
                        'chevron_r',
                        size: AppIconSize.md,
                        color: scheme.onSurfaceVariant,
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(height: 8),
          // Suggestion chips — tap drops the prompt into the AI chat.
          SizedBox(
            height: 34,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: _suggestions.length,
              separatorBuilder: (_, _) => const SizedBox(width: 8),
              itemBuilder: (context, i) {
                final prompt = _suggestions[i];
                return _SuggestionChip(prompt: prompt);
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _SuggestionChip extends ConsumerWidget {
  final String prompt;
  const _SuggestionChip({required this.prompt});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    return Material(
      color: scheme.surfaceContainerLowest,
      borderRadius: AppShapes.radiusFull,
      child: InkWell(
        borderRadius: AppShapes.radiusFull,
        onTap: () {
          HapticFeedback.selectionClick();
          // Open the AI chat with the prompt prefilled.
          context.push('/ai', extra: {'prompt': prompt});
        },
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
          decoration: BoxDecoration(
            borderRadius: AppShapes.radiusFull,
            border: Border.all(color: scheme.outlineVariant),
          ),
          child: Text(
            prompt,
            style: Theme.of(context).textTheme.labelMedium?.copyWith(
                  color: scheme.onSurfaceVariant,
                  fontWeight: FontWeight.w500,
                ),
          ),
        ),
      ),
    );
  }
}
