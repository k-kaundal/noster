import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';

class MembershipsScreen extends ConsumerWidget {
  const MembershipsScreen({super.key});

  static const _tiers = [
    _Tier(
      name: 'Supporter',
      price: '1,000',
      period: 'month',
      perks: ['Badge on profile', 'Early access to posts', 'Supporter-only chat'],
      memberCount: 42,
      highlighted: false,
    ),
    _Tier(
      name: 'Premium',
      price: '5,000',
      period: 'month',
      perks: [
        'All Supporter perks',
        'Exclusive articles',
        'Monthly AMA access',
        'Direct DM access'
      ],
      memberCount: 18,
      highlighted: true,
    ),
    _Tier(
      name: 'Patron',
      price: '21,000',
      period: 'month',
      perks: [
        'All Premium perks',
        'Name in credits',
        '1-on-1 monthly call',
        'Custom requests'
      ],
      memberCount: 3,
      highlighted: false,
    ),
  ];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authStateProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Memberships')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Header
          Text(
            'Support Creators',
            style: Theme.of(context)
                .textTheme
                .headlineSmall
                ?.copyWith(fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 6),
          Text(
            'Subscribe to creators with sats and get exclusive perks.',
            style: TextStyle(
                color: Theme.of(context).colorScheme.onSurfaceVariant),
          ),
          const SizedBox(height: 24),

          // Tiers
          for (final tier in _tiers) ...[
            _TierCard(tier: tier, isLoggedIn: auth.isLoggedIn),
            const SizedBox(height: 12),
          ],

          const SizedBox(height: 16),
          // My memberships
          Text(
            'My Memberships',
            style: Theme.of(context)
                .textTheme
                .titleSmall
                ?.copyWith(fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 10),
          _MyMembershipsPlaceholder(),
        ],
      ),
    );
  }
}

class _Tier {
  final String name;
  final String price;
  final String period;
  final List<String> perks;
  final int memberCount;
  final bool highlighted;

  const _Tier({
    required this.name,
    required this.price,
    required this.period,
    required this.perks,
    required this.memberCount,
    required this.highlighted,
  });
}

class _TierCard extends StatelessWidget {
  final _Tier tier;
  final bool isLoggedIn;
  const _TierCard({required this.tier, required this.isLoggedIn});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Card(
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: tier.highlighted
            ? BorderSide(color: scheme.primary, width: 2)
            : BorderSide.none,
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    tier.name,
                    style: Theme.of(context)
                        .textTheme
                        .titleMedium
                        ?.copyWith(fontWeight: FontWeight.bold),
                  ),
                ),
                if (tier.highlighted)
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: scheme.primary,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      'POPULAR',
                      style: TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.bold,
                          color: scheme.onPrimary),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 6),
            Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Icon(Icons.bolt, size: 18, color: scheme.primary),
                Text(
                  tier.price,
                  style: TextStyle(
                    fontSize: 24,
                    fontWeight: FontWeight.bold,
                    color: scheme.primary,
                  ),
                ),
                Text(
                  ' sats/${tier.period}',
                  style: TextStyle(
                      fontSize: 13, color: scheme.onSurfaceVariant),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              '${tier.memberCount} members',
              style: TextStyle(
                  fontSize: 12, color: scheme.onSurfaceVariant),
            ),
            const SizedBox(height: 12),
            for (final perk in tier.perks)
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Row(
                  children: [
                    Icon(Icons.check_circle,
                        size: 16, color: scheme.primary),
                    const SizedBox(width: 8),
                    Expanded(
                      child:
                          Text(perk, style: const TextStyle(fontSize: 13)),
                    ),
                  ],
                ),
              ),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: tier.highlighted
                  ? FilledButton(
                      onPressed: isLoggedIn ? () {} : null,
                      child: const Text('Subscribe'),
                    )
                  : FilledButton.tonal(
                      onPressed: isLoggedIn ? () {} : null,
                      child: const Text('Subscribe'),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _MyMembershipsPlaceholder extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            Icon(Icons.card_membership,
                size: 40, color: scheme.onSurfaceVariant),
            const SizedBox(height: 12),
            Text(
              'No active memberships',
              style: Theme.of(context).textTheme.titleSmall,
            ),
            const SizedBox(height: 4),
            Text(
              'Your subscribed creators will appear here.',
              style: TextStyle(
                  fontSize: 13, color: scheme.onSurfaceVariant),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}
