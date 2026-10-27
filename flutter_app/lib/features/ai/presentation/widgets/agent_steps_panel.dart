import 'package:flutter/material.dart';

import 'package:nostrfeed_mobile/core/theme/app_motion.dart';
import 'package:nostrfeed_mobile/core/theme/app_shapes.dart';
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';
import 'package:nostrfeed_mobile/features/ai/domain/ai_models.dart';

/// The Grok-style agent activity panel — the advanced step manager above the
/// input while the agent works. Instead of a spinner, the user watches the
/// agent PLAN and EXECUTE in real time:
///
///  - **Header** — pulsing ✨ + "Agent is working" + step count (N of the
///    steps done so far), so there's always a live signal.
///  - **Current step** (the newest, still running) — highlighted in the
///    accent, a small spinner, and its live status ("Searching 'bitcoin'…").
///  - **Done steps** — collapsed into a quiet expandable "N steps done"
///    summary (tap to expand the trail) so a long run stays readable.
///
/// Steps arrive via `liveAgentSteps` (notifier); the LAST entry is treated
/// as the in-flight one. No per-frame tickers — a single
/// [TweenAnimationBuilder] drives the pulse.
class AgentStepsPanel extends StatelessWidget {
  final List<AgentStepEntry> steps;
  const AgentStepsPanel({super.key, required this.steps});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    if (steps.isEmpty) return const SizedBox.shrink();

    final done = steps.take(steps.length - 1).toList();
    final current = steps.last;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 12),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLowest,
        border: Border(
          top: BorderSide(color: scheme.outlineVariant, width: 0.5),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          // Header — pulsing agent mark + status + count.
          Row(
            children: [
              _PulsingAgentMark(),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Agent is working…',
                  style: textTheme.labelLarge?.copyWith(
                    fontWeight: FontWeight.w700,
                    color: scheme.onSurface,
                  ),
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: scheme.primaryContainer,
                  borderRadius: AppShapes.radiusFull,
                ),
                child: Text(
                  '${done.length + 1} step${steps.length == 1 ? '' : 's'}',
                  style: textTheme.labelSmall?.copyWith(
                    color: scheme.onPrimaryContainer,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          // Done steps — collapsed, expandable.
          if (done.isNotEmpty) _DoneStepsCollapsible(steps: done),
          // The CURRENT step — highlighted, live.
          _CurrentStepTile(step: current),
        ],
      ),
    );
  }
}

/// The pulsing ✨ agent mark — a self-contained implicit pulse (no
/// AnimationController): scale + opacity breathe in a loop.
class _PulsingAgentMark extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0.75, end: 1.0),
      duration: const Duration(milliseconds: 900),
      curve: Curves.easeInOut,
      builder: (context, value, child) {
        return Opacity(
          opacity: value,
          child: Transform.scale(
            scale: value,
            child: Container(
              width: 22,
              height: 22,
              decoration: BoxDecoration(
                color: scheme.primaryContainer,
                shape: BoxShape.circle,
              ),
              child: Center(
                child: AppIcon(
                  'sparkle',
                  size: AppIconSize.sm,
                  color: scheme.onPrimaryContainer,
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}

/// The current (in-flight) step — accent-highlighted, small spinner, live
/// status text. Slides/fades in as a new step starts.
class _CurrentStepTile extends StatelessWidget {
  final AgentStepEntry step;
  const _CurrentStepTile({required this.step});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return AnimatedSwitcher(
      duration: AppMotion.fast,
      child: Container(
        key: ValueKey(step.status),
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(
          color: scheme.primaryContainer.withValues(alpha: 0.5),
          borderRadius: AppShapes.radiusMd,
          border: Border.all(color: scheme.primary.withValues(alpha: 0.4)),
        ),
        child: Row(
          children: [
            SizedBox(
              width: 16,
              height: 16,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: scheme.primary,
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                step.status,
                style: textTheme.labelLarge?.copyWith(
                  color: scheme.onPrimaryContainer,
                  fontWeight: FontWeight.w600,
                ),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            Text(
              'now',
              style: textTheme.labelSmall?.copyWith(
                color: scheme.primary,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Done steps, collapsed into a quiet tappable summary that expands the trail.
class _DoneStepsCollapsible extends StatefulWidget {
  final List<AgentStepEntry> steps;
  const _DoneStepsCollapsible({required this.steps});

  @override
  State<_DoneStepsCollapsible> createState() => _DoneStepsCollapsibleState();
}

class _DoneStepsCollapsibleState extends State<_DoneStepsCollapsible> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        GestureDetector(
          onTap: () => setState(() => _expanded = !_expanded),
          child: Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Row(
              children: [
                AppIcon(
                  'check',
                  size: AppIconSize.xs,
                  color: scheme.primary,
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    '${widget.steps.length} step${widget.steps.length == 1 ? '' : 's'} done',
                    style: textTheme.labelMedium?.copyWith(
                      color: scheme.onSurfaceVariant,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ),
                AppIcon(
                  _expanded ? 'arrow_up' : 'arrow_down',
                  size: AppIconSize.xs,
                  color: scheme.onSurfaceVariant,
                ),
              ],
            ),
          ),
        ),
        if (_expanded)
          ...widget.steps.map(
            (s) => Padding(
              padding: const EdgeInsets.only(left: 22, bottom: 2),
              child: Text(
                '• ${s.status}',
                style: textTheme.labelSmall?.copyWith(
                  color: scheme.onSurfaceVariant,
                ),
              ),
            ),
          ),
      ],
    );
  }
}
