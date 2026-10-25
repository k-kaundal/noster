import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/theme/app_shapes.dart';
import 'package:nostrfeed_mobile/core/theme/app_spacing.dart';
import 'package:nostrfeed_mobile/core/theme/app_theme.dart';
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';
import 'package:nostrfeed_mobile/core/widgets/detail_scaffold.dart';
import 'package:nostrfeed_mobile/core/widgets/empty_state.dart';
import 'package:nostrfeed_mobile/core/widgets/error_view.dart';
import 'package:nostrfeed_mobile/core/widgets/skeleton.dart';
import 'package:nostrfeed_mobile/features/memberships/application/membership_providers.dart';
import 'package:nostrfeed_mobile/features/memberships/presentation/widgets/tier_editor_sheet.dart';
import 'package:nostrfeed_mobile/features/studio/application/studio_providers.dart';
import 'package:nostrfeed_mobile/features/studio/domain/subscription.dart';
import 'package:nostrfeed_mobile/features/studio/presentation/widgets/zap_goal_card.dart';
import 'package:nostrfeed_mobile/features/studio/presentation/widgets/zap_goal_editor.dart';

/// Creator Studio — what you earned, and the tools to earn it.
///
/// **Premium-only**: the seller side (tiers, goals, the earnings dashboard)
/// unlocks with a paid NIP-05/lightning identity. Earnings figures are built
/// only from zap receipts that survive NIP-57 validation.
class StudioScreen extends ConsumerWidget {
  const StudioScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authStateProvider);

    if (!auth.isLoggedIn) {
      return const DetailScaffold(
        title: 'Studio',
        body: EmptyState(
          icon: Icons.dashboard_rounded,
          title: 'Sign in to open your Studio',
          subtitle: 'Your earnings, goals and memberships live here.',
        ),
      );
    }

    final canUse = ref.watch(canUseStudioProvider).value ?? false;

    if (!canUse) {
      return const DetailScaffold(
        title: 'Studio',
        body: _StudioGate(),
      );
    }

    return DetailScaffold(
      title: 'Studio',
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(studioEarningsProvider);
          ref.invalidate(myGoalsProvider);
          ref.invalidate(myMembershipsProvider);
        },
        child: ListView(
          padding: AppSpacing.paddingMd,
          children: const [
            _EarningsSection(),
            AppSpacing.gapLg,
            _GoalsSection(),
            AppSpacing.gapLg,
            _MembershipsSection(),
          ],
        ),
      ),
    );
  }
}

/// The premium gate — Studio is where a creator sells, and selling needs a
/// paid, verified identity.
class _StudioGate extends StatelessWidget {
  const _StudioGate();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Center(
      child: Padding(
        padding: AppSpacing.paddingXl,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            AppIcon('chart', size: 64, color: scheme.primary),
            AppSpacing.gapMd,
            Text(
              'Studio is a Premium feature',
              style: Theme.of(context)
                  .textTheme
                  .titleLarge
                  ?.copyWith(fontWeight: FontWeight.bold),
              textAlign: TextAlign.center,
            ),
            AppSpacing.gapSm,
            Text(
              'Creators sell subscriptions and run zap goals under a verified, '
              'paid name — that is what supporters are paying to reach. Get a '
              'NIP-05 name to open your Studio.',
              style: Theme.of(context)
                  .textTheme
                  .bodyMedium
                  ?.copyWith(color: scheme.onSurfaceVariant, height: 1.4),
              textAlign: TextAlign.center,
            ),
            AppSpacing.gapLg,
            FilledButton.icon(
              onPressed: () => context.push('/premium'),
              icon: const AppIcon('verified', size: 18),
              label: const Text('Get Premium'),
            ),
          ],
        ),
      ),
    );
  }
}

/// Uppercase accent section label — the Refined header treatment.
class _SectionLabel extends StatelessWidget {
  final String text;
  const _SectionLabel(this.text);

  @override
  Widget build(BuildContext context) {
    return Text(
      text.toUpperCase(),
      style: Theme.of(context).textTheme.labelSmall?.copyWith(
            fontWeight: FontWeight.w700,
            letterSpacing: 1.2,
            color: Theme.of(context).colorScheme.primary,
          ),
    );
  }
}

// ── Earnings ────────────────────────────────────────────────────────────

class _EarningsSection extends ConsumerStatefulWidget {
  const _EarningsSection();

  @override
  ConsumerState<_EarningsSection> createState() => _EarningsSectionState();
}

class _EarningsSectionState extends ConsumerState<_EarningsSection> {
  int _days = 30;
  static const _windows = [7, 30, 90];

  @override
  Widget build(BuildContext context) {
    final earnings = ref.watch(studioEarningsProvider(_days));

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const Expanded(child: _SectionLabel('Earnings')),
            SegmentedButton<int>(
              segments: _windows
                  .map((d) => ButtonSegment(value: d, label: Text('${d}d')))
                  .toList(),
              selected: {_days},
              showSelectedIcon: false,
              style: const ButtonStyle(
                visualDensity: VisualDensity.compact,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
              onSelectionChanged: (s) => setState(() => _days = s.first),
            ),
          ],
        ),
        AppSpacing.gapSm,
        earnings.when(
          loading: () => const SkeletonBox(height: 180),
          error: (error, _) => ErrorView.fromError(error),
          data: (data) => Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  _Stat(
                    label: 'sats',
                    value: _format(data.sats),
                    delta: data.changePercent == null
                        ? null
                        : '${data.changePercent! >= 0 ? '+' : ''}'
                            '${data.changePercent}% vs prev',
                  ),
                  AppSpacing.gapSm,
                  _Stat(label: 'payments', value: '${data.payments}'),
                  AppSpacing.gapSm,
                  _Stat(
                    label: 'zappers',
                    value: '${data.zappers}',
                    delta: '${data.repeatZappers} repeat',
                  ),
                ],
              ),
              AppSpacing.gapSm,
              _TrendCard(daily: data.daily, days: _days),
              if (data.refused > 0) ...[
                AppSpacing.gapXs,
                Text(
                  '${data.refused} receipt${data.refused == 1 ? '' : 's'} named you and '
                  'failed a NIP-57 check, so not counted.',
                  style: Theme.of(context)
                      .textTheme
                      .labelSmall
                      ?.copyWith(
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

class _Stat extends StatelessWidget {
  final String label;
  final String value;
  final String? delta;
  const _Stat({required this.label, required this.value, this.delta});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Expanded(
      child: Container(
        padding: AppSpacing.paddingSm,
        decoration: BoxDecoration(
          color: scheme.surfaceContainerLowest,
          borderRadius: AppShapes.radiusMd,
          border: Border.all(color: scheme.outlineVariant),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              value,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context)
                  .textTheme
                  .titleMedium
                  ?.copyWith(
                    fontWeight: FontWeight.bold,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
            ),
            Text(
              label,
              style: Theme.of(context)
                  .textTheme
                  .labelSmall
                  ?.copyWith(color: scheme.onSurfaceVariant),
            ),
            if (delta != null)
              Text(
                delta!,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context)
                    .textTheme
                    .labelSmall
                    ?.copyWith(color: scheme.primary),
              ),
          ],
        ),
      ),
    );
  }
}

class _TrendCard extends StatelessWidget {
  final List<DailyEarning> daily;
  final int days;
  const _TrendCard({required this.daily, required this.days});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final max = daily.fold<int>(0, (m, d) => d.sats > m ? d.sats : m);

    return Container(
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLowest,
        borderRadius: AppShapes.radiusMd,
        border: Border.all(color: scheme.outlineVariant),
      ),
      child: Padding(
        padding: AppSpacing.paddingMd,
        child: SizedBox(
          height: 72,
          child: max == 0
              ? Center(
                  child: Text(
                    'No zaps in this period.',
                    style: Theme.of(context)
                        .textTheme
                        .bodySmall
                        ?.copyWith(color: scheme.onSurfaceVariant),
                  ),
                )
              : Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    for (final day in daily)
                      Expanded(
                        child: Padding(
                          padding:
                              const EdgeInsets.symmetric(horizontal: 0.5),
                          child: Tooltip(
                            message:
                                '${day.day.month}/${day.day.day}: ${day.sats} sats',
                            child: Container(
                              height: (72 * (day.sats / max)).clamp(2.0, 72.0),
                              decoration: BoxDecoration(
                                color: day.sats > 0
                                    ? scheme.primary
                                    : scheme.surfaceContainerHigh,
                                borderRadius: const BorderRadius.vertical(
                                    top: Radius.circular(AppShapes.xs)),
                              ),
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
        ),
      ),
    );
  }
}

// ── Goals ───────────────────────────────────────────────────────────────

class _GoalsSection extends ConsumerWidget {
  const _GoalsSection();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final goals = ref.watch(myGoalsProvider);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const Expanded(child: _SectionLabel('Zap goals')),
            TextButton.icon(
              onPressed: () => ZapGoalEditorSheet.show(context),
              icon: const AppIcon('plus', size: 18),
              label: const Text('New goal'),
            ),
          ],
        ),
        AppSpacing.gapSm,
        goals.when(
          loading: () => const SkeletonBox(height: 96),
          error: (error, _) => ErrorView.fromError(error),
          data: (items) {
            if (items.isEmpty) {
              return const _HintCard(
                'No goals yet. Set a target and people can zap toward it.',
              );
            }
            return Column(
              children: [
                for (final item in items) ...[
                  ZapGoalCard(
                    goal: item.goal,
                    progress: item.progress,
                    isOwn: true,
                  ),
                  AppSpacing.gapSm,
                ],
              ],
            );
          },
        ),
      ],
    );
  }
}

// ── Memberships ─────────────────────────────────────────────────────────

class _MembershipsSection extends ConsumerWidget {
  const _MembershipsSection();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final memberships = ref.watch(myMembershipsProvider);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const Expanded(child: _SectionLabel('Memberships')),
            TextButton.icon(
              onPressed: () => TierEditorSheet.show(context),
              icon: const AppIcon('plus', size: 18),
              label: const Text('New tier'),
            ),
            TextButton(
              onPressed: () => context.push('/memberships'),
              child: const Text('Open'),
            ),
          ],
        ),
        AppSpacing.gapSm,
        memberships.when(
          loading: () => const SkeletonBox(height: 96),
          error: (error, _) => ErrorView.fromError(error),
          data: (data) {
            if (data.standings.isEmpty) {
              return const _HintCard(
                'No tiers yet. A tier is what a subscriber pays for, one '
                'period at a time.',
              );
            }
            final summary = data.summary;
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    _Stat(
                      label: 'supporters',
                      value: '${summary.activeMembers}',
                      delta: summary.renewingSoon > 0
                          ? '${summary.renewingSoon} ending soon'
                          : null,
                    ),
                    AppSpacing.gapSm,
                    _Stat(
                      label: 'per month',
                      value: _format(summary.runRateSats),
                    ),
                    AppSpacing.gapSm,
                    _Stat(
                      label: 'lifetime',
                      value: _format(summary.lifetimeSats),
                    ),
                  ],
                ),
                AppSpacing.gapSm,
                for (final standing in data.standings)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: _StudioTierRow(standing: standing),
                  ),
              ],
            );
          },
        ),
      ],
    );
  }
}

class _StudioTierRow extends StatelessWidget {
  final TierStanding standing;
  const _StudioTierRow({required this.standing});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final tier = standing.tier;
    return Container(
      padding: AppSpacing.paddingSm,
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLowest,
        borderRadius: AppShapes.radiusMd,
        border: Border.all(color: scheme.outlineVariant),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  tier.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context)
                      .textTheme
                      .bodyMedium
                      ?.copyWith(fontWeight: FontWeight.w600),
                ),
                Text(
                  '${_format(tier.amount)} sats/${describeCadence(tier.cadence)}'
                  ' · ${standing.active.length} active',
                  style: Theme.of(context)
                      .textTheme
                      .bodySmall
                      ?.copyWith(color: scheme.onSurfaceVariant),
                ),
              ],
            ),
          ),
          Text(
            '${_format(standing.lifetimeSats)} sats',
            style: Theme.of(context)
                .textTheme
                .bodySmall
                ?.copyWith(
                  fontWeight: FontWeight.bold,
                  color: AppActionColors.zapFor(scheme.brightness),
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
          ),
        ],
      ),
    );
  }
}

class _HintCard extends StatelessWidget {
  final String text;
  const _HintCard(this.text);

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLowest,
        borderRadius: AppShapes.radiusMd,
        border: Border.all(color: scheme.outlineVariant),
      ),
      child: Padding(
        padding: AppSpacing.paddingMd,
        child: Text(
          text,
          style: Theme.of(context)
              .textTheme
              .bodySmall
              ?.copyWith(color: scheme.onSurfaceVariant),
        ),
      ),
    );
  }
}

String _format(int sats) {
  final s = sats.toString();
  final buf = StringBuffer();
  for (var i = 0; i < s.length; i++) {
    final idx = s.length - i;
    buf.write(s[i]);
    if (idx > 1 && idx % 3 == 1) buf.write(',');
  }
  return buf.toString();
}
