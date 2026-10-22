import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/theme/app_spacing.dart';
import 'package:nostrfeed_mobile/core/widgets/detail_scaffold.dart';
import 'package:nostrfeed_mobile/core/widgets/empty_state.dart';
import 'package:nostrfeed_mobile/core/widgets/error_view.dart';
import 'package:nostrfeed_mobile/core/widgets/skeleton.dart';
import 'package:nostrfeed_mobile/features/memberships/application/membership_providers.dart';
import 'package:nostrfeed_mobile/features/memberships/presentation/widgets/member_row.dart';
import 'package:nostrfeed_mobile/features/memberships/presentation/widgets/tier_card.dart';
import 'package:nostrfeed_mobile/features/memberships/presentation/widgets/tier_editor_sheet.dart';
import 'package:nostrfeed_mobile/features/studio/domain/subscription.dart';

/// Memberships — user-to-user subscriptions.
///
/// **Premium-only for sellers**: creating a tier (what subscribers pay for)
/// requires a paid NIP-05/lightning identity — subscribers can be anyone.
/// A subscription is a zap to a tier, so every figure here is read from
/// receipts that pass NIP-57 validation.
class MembershipsScreen extends ConsumerWidget {
  const MembershipsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authStateProvider);

    if (!auth.isLoggedIn) {
      return const DetailScaffold(
        title: 'Memberships',
        body: EmptyState(
          icon: Icons.card_membership_rounded,
          title: 'Sign in to see memberships',
          subtitle: 'Subscriptions you sell and the ones you hold.',
        ),
      );
    }

    final canSell = ref.watch(canSellMembershipsProvider).value ?? false;

    return DetailScaffold(
      title: 'Memberships',
      floatingActionButton: canSell
          ? FloatingActionButton.extended(
              onPressed: () => TierEditorSheet.show(context),
              icon: const Icon(Icons.add_rounded),
              label: const Text('New tier'),
            )
          : null,
      body: ListView(
        padding: AppSpacing.paddingMd,
        children: [
          if (!canSell) ...[
            _PremiumGateCard(),
            AppSpacing.gapLg,
          ],
          if (canSell) ...[
            Text(
              'Your tiers',
              style: Theme.of(context)
                  .textTheme
                  .titleSmall
                  ?.copyWith(fontWeight: FontWeight.bold),
            ),
            AppSpacing.gapSm,
            const _CreatorSection(),
            AppSpacing.gapLg,
          ],
          Text(
            'Your subscriptions',
            style: Theme.of(context)
                .textTheme
                .titleSmall
                ?.copyWith(fontWeight: FontWeight.bold),
          ),
          AppSpacing.gapSm,
          const _SubscribingSection(),
        ],
      ),
    );
  }
}

/// The premium gate: selling subscriptions needs a paid identity.
class _PremiumGateCard extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: AppSpacing.paddingMd,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.workspace_premium_rounded,
                    color: scheme.primary, size: 28),
                AppSpacing.gapSm,
                Expanded(
                  child: Text(
                    'Selling memberships is a Premium feature',
                    style: Theme.of(context)
                        .textTheme
                        .titleSmall
                        ?.copyWith(fontWeight: FontWeight.bold),
                  ),
                ),
              ],
            ),
            AppSpacing.gapSm,
            Text(
              'Creators sell subscriptions under a verified, paid name — that is '
              'what a subscriber is paying to support. Get a NIP-05 name to open '
              'your own tiers. Subscribing to someone else needs nothing but sats.',
              style: TextStyle(fontSize: 13, color: scheme.onSurfaceVariant),
            ),
            AppSpacing.gapMd,
            FilledButton.tonalIcon(
              onPressed: () => context.push('/premium'),
              icon: const Icon(Icons.verified_rounded, size: 18),
              label: const Text('Get Premium'),
            ),
          ],
        ),
      ),
    );
  }
}

/// The creator's side: summary + tiers + members, premium-gated above.
class _CreatorSection extends ConsumerWidget {
  const _CreatorSection();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final memberships = ref.watch(myMembershipsProvider);

    return memberships.when(
      loading: () => const _LoadingList(),
      error: (error, _) => ErrorView(message: '$error'),
      data: (data) {
        if (data.standings.isEmpty) {
          return EmptyState(
            icon: Icons.sell_rounded,
            title: 'No tiers yet',
            subtitle:
                'A tier is what somebody pays for, one period at a time. Publish one and supporters appear here.',
            action: FilledButton.tonal(
              onPressed: () => TierEditorSheet.show(context),
              child: const Text('Create a tier'),
            ),
          );
        }

        final summary = data.summary;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Summary strip — people, run rate, lifetime.
            Row(
              children: [
                _SummaryChip(
                  label: 'Supporters',
                  value: '${summary.activeMembers}',
                ),
                AppSpacing.gapSm,
                _SummaryChip(
                  label: 'Per month',
                  value: _format(summary.runRateSats),
                ),
                AppSpacing.gapSm,
                _SummaryChip(
                  label: 'Lifetime',
                  value: _format(summary.lifetimeSats),
                ),
              ],
            ),
            AppSpacing.gapMd,
            for (final standing in data.standings) ...[
              _TierBlock(standing: standing),
              AppSpacing.gapSm,
            ],
          ],
        );
      },
    );
  }
}

class _SummaryChip extends StatelessWidget {
  final String label;
  final String value;
  const _SummaryChip({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Expanded(
      child: Container(
        padding: AppSpacing.paddingSm,
        decoration: BoxDecoration(
          color: scheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          children: [
            Text(
              value,
              style:
                  const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
            ),
            Text(
              label,
              style: TextStyle(fontSize: 10, color: scheme.onSurfaceVariant),
            ),
          ],
        ),
      ),
    );
  }
}

/// One tier: its card, edit/retire actions, and the members on it.
class _TierBlock extends ConsumerWidget {
  final TierStanding standing;
  const _TierBlock({required this.standing});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tier = standing.tier;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                '${tier.title} · ${_format(tier.amount)} sats/${describeCadence(tier.cadence)}',
                style: const TextStyle(fontWeight: FontWeight.w600),
              ),
            ),
            IconButton(
              icon: const Icon(Icons.edit_rounded, size: 20),
              tooltip: 'Edit tier',
              onPressed: () => TierEditorSheet.show(context, existing: tier),
            ),
            IconButton(
              icon: const Icon(Icons.delete_outline_rounded, size: 20),
              tooltip: 'Retire tier',
              onPressed: () => _confirmRetire(context, ref, tier),
            ),
          ],
        ),
        if (standing.members.isEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(
              'Nobody has paid this tier yet.',
              style: TextStyle(
                  fontSize: 12,
                  color: Theme.of(context).colorScheme.onSurfaceVariant),
            ),
          )
        else
          for (final member in standing.members.take(8))
            MemberRow(member: member, cadence: tier.cadence),
      ],
    );
  }

  Future<void> _confirmRetire(
      BuildContext context, WidgetRef ref, Tier tier) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Retire this tier?'),
        content: Text(
          '“${tier.title}” stops being offered. Sats already paid are yours; '
          'relays are asked to delete it, which is a request, not a guarantee.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Keep it'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Retire'),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      await ref.read(retireTierProvider)(tier);
    }
  }
}

/// The subscriber's side: tiers the user currently pays, across creators.
class _SubscribingSection extends ConsumerWidget {
  const _SubscribingSection();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authStateProvider);
    final pubkey = auth.pubkey;
    if (pubkey == null) return const SizedBox.shrink();

    // The user's own tiers are excluded — subscribing to yourself is not a
    // membership. This shows tiers from OTHER creators the user stands on.
    // We discover them by scanning creators the user follows is out of scope;
    // for now the section lists tiers from the creators the app knows about
    // via the public tier search (any tier the user has a standing on).
    return const _HeldMemberships();
  }
}

/// Tiers from other creators the user has paid, discovered via the creators
/// whose tiers are visible on the network (bounded).
class _HeldMemberships extends ConsumerWidget {
  const _HeldMemberships();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authStateProvider);
    final me = auth.pubkey;
    if (me == null) return const SizedBox.shrink();

    final follows = ref.watch(followsProvider).valueOrNull ?? const <String>[];
    // Look up tiers only from people the user actually follows — that is the
    // set of creators one would plausibly support, and it bounds the relay
    // queries to a sane number.
    final creators = follows.where((pk) => pk != me).take(40).toList();
    if (creators.isEmpty) {
      return const Padding(
        padding: EdgeInsets.only(bottom: 24),
        child: Text(
          'Follow a creator and their support tiers show up here.',
          style: TextStyle(fontSize: 13),
        ),
      );
    }

    final held = <Widget>[];
    for (final creator in creators) {
      held.add(_CreatorTiersForSubscriber(creator: creator, me: me));
    }
    return Column(children: held);
  }
}

class _CreatorTiersForSubscriber extends ConsumerWidget {
  final String creator;
  final String me;
  const _CreatorTiersForSubscriber({required this.creator, required this.me});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tiers = ref.watch(tiersProvider(creator)).valueOrNull ?? const [];
    if (tiers.isEmpty) return const SizedBox.shrink();

    final cards = <Widget>[];
    for (final tier in tiers) {
      final status =
          ref.watch(mySubscriptionProvider(tier)).valueOrNull ?? SubscriptionStatus.none;
      // Only tiers the user has actually paid — a standing exists.
      if (status.state == SubscriptionState.none && status.totalSats == 0) {
        continue;
      }
      cards.add(Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: TierCard(tier: tier),
      ));
    }
    if (cards.isEmpty) return const SizedBox.shrink();

    final profile = ref.watch(profileProvider(creator)).valueOrNull;
    final name = profile?.displayName ?? profile?.name ??
        '${creator.substring(0, 8)}…';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(top: 8, bottom: 4),
          child: Text(
            name,
            style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
          ),
        ),
        ...cards,
      ],
    );
  }
}

class _LoadingList extends StatelessWidget {
  const _LoadingList();

  @override
  Widget build(BuildContext context) {
    return Column(
      children: List.generate(
        3,
        (_) => Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: SkeletonBox(
            height: 72,
            borderRadius: BorderRadius.circular(16),
          ),
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
