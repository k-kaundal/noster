import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/theme/app_shapes.dart';
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';
import 'package:nostrfeed_mobile/features/ai/application/ai_chat_notifier.dart';
import 'package:nostrfeed_mobile/features/ai/application/ai_providers.dart';
import 'package:nostrfeed_mobile/features/ai/domain/ai_gateway.dart';
import 'package:nostrfeed_mobile/features/ai/presentation/widgets/ai_model_picker.dart';

/// The compact AI header — ONE slim row (not a big card) that holds BOTH the
/// Chat/Agent mode toggle AND the model picker, so it stays out of the
/// conversation's way (the big two-row card covered most of the screen).
///
/// Left: a tight Chat/Agent segmented pill (small, no subtitle). Right: the
/// model picker (✨ + model name + chevron). One 34dp row, quiet hairline.
class AiHeader extends ConsumerWidget {
  final AiChatMode mode;
  final ValueChanged<AiChatMode> onModeChanged;
  final AiModelEntry model;

  const AiHeader({
    super.key,
    required this.mode,
    required this.onModeChanged,
    required this.model,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;

    final price = ref.watch(aiModelPriceProvider(model));

    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 6, 12, 4),
      child: Row(
        children: [
          // ── Chat/Agent toggle — HALF the row (equal sizing with the
          // model picker, not a small pill next to a wide one). ──
          Expanded(
            child: Container(
              height: 34,
              decoration: BoxDecoration(
                color: scheme.surfaceContainerHighest,
                borderRadius: AppShapes.radiusFull,
              ),
              padding: const EdgeInsets.all(3),
              child: Row(
                children: [
                  Expanded(
                    child: _ModePill(
                      icon: 'chat',
                      label: 'Chat',
                      selected: mode == AiChatMode.chat,
                      onTap: () => onModeChanged(AiChatMode.chat),
                    ),
                  ),
                  Expanded(
                    child: _ModePill(
                      icon: 'sparkle',
                      label: 'Agent',
                      selected: mode == AiChatMode.agent,
                      onTap: () => onModeChanged(AiChatMode.agent),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(width: 10),
          // ── Model picker — the OTHER half (equal width), opens the
          // picker sheet. Shows model + cost so the price is visible up
          // front (the "show cost" ask). ──
          Expanded(
            child: InkWell(
              borderRadius: AppShapes.radiusMd,
              onTap: () => showAiModelPicker(context),
              child: Container(
                height: 34,
                padding: const EdgeInsets.symmetric(horizontal: 8),
                decoration: BoxDecoration(
                  color: scheme.surfaceContainerLowest,
                  borderRadius: AppShapes.radiusMd,
                  border: Border.all(color: scheme.outlineVariant),
                ),
                child: Row(
                  children: [
                    AppIcon('sparkle', size: AppIconSize.sm, color: scheme.primary),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            model.label,
                            style: textTheme.labelMedium?.copyWith(
                              fontWeight: FontWeight.w700,
                              height: 1.0,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          Text(
                            '~$price/msg',
                            style: textTheme.labelSmall?.copyWith(
                              color: scheme.onSurfaceVariant,
                              fontSize: 10,
                              height: 1.1,
                            ),
                            maxLines: 1,
                          ),
                        ],
                      ),
                    ),
                    AppIcon('chevron_r',
                        size: AppIconSize.xs, color: scheme.onSurfaceVariant),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// One tiny pill of the mode toggle — icon + label, accent when active.
class _ModePill extends StatelessWidget {
  final String icon;
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const _ModePill({
    required this.icon,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return InkWell(
      borderRadius: AppShapes.radiusFull,
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(
          color: selected ? scheme.primary : Colors.transparent,
          borderRadius: AppShapes.radiusFull,
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          mainAxisSize: MainAxisSize.min,
          children: [
            AppIcon(
              icon,
              size: AppIconSize.xs,
              color: selected ? scheme.onPrimary : scheme.onSurfaceVariant,
            ),
            const SizedBox(width: 4),
            Text(
              label,
              style: textTheme.labelMedium?.copyWith(
                fontWeight: FontWeight.w600,
                color: selected ? scheme.onPrimary : scheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
