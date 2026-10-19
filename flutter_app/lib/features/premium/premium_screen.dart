import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';

class PremiumScreen extends ConsumerStatefulWidget {
  const PremiumScreen({super.key});

  @override
  ConsumerState<PremiumScreen> createState() => _PremiumScreenState();
}

class _PremiumScreenState extends ConsumerState<PremiumScreen> {
  int _selectedPlan = 1; // default: monthly

  static const _plans = [
    _Plan(
      name: 'Monthly',
      price: '10,000',
      period: 'month',
      savings: null,
    ),
    _Plan(
      name: 'Yearly',
      price: '100,000',
      period: 'year',
      savings: 'Save 17%',
    ),
    _Plan(
      name: 'Lifetime',
      price: '500,000',
      period: 'one-time',
      savings: 'Best value',
    ),
  ];

  static const _features = [
    _Feature(
      icon: Icons.storage,
      title: 'Premium relay access',
      description: 'Guaranteed uptime, low latency, and higher rate limits.',
    ),
    _Feature(
      icon: Icons.cloud_upload,
      title: 'Media storage',
      description: 'Upload images and videos up to 100MB per file.',
    ),
    _Feature(
      icon: Icons.bolt,
      title: 'Priority zaps',
      description: 'Your zaps are routed with priority for instant delivery.',
    ),
    _Feature(
      icon: Icons.analytics,
      title: 'Advanced analytics',
      description: 'Detailed insights into your audience and engagement.',
    ),
    _Feature(
      icon: Icons.verified,
      title: 'Verified badge',
      description: 'Display a premium badge on your Nostr profile.',
    ),
    _Feature(
      icon: Icons.support_agent,
      title: 'Priority support',
      description: 'Direct access to the NostrFeed team for help.',
    ),
  ];

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authStateProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Premium')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Hero header
          _HeroHeader(),
          const SizedBox(height: 28),

          // Features
          Text(
            'What\'s included',
            style: Theme.of(context)
                .textTheme
                .titleSmall
                ?.copyWith(fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 12),
          ..._features.map((f) => _FeatureTile(feature: f)),
          const SizedBox(height: 28),

          // Pricing
          Text(
            'Choose a plan',
            style: Theme.of(context)
                .textTheme
                .titleSmall
                ?.copyWith(fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 12),
          Row(
            children: List.generate(_plans.length, (i) {
              final plan = _plans[i];
              return Expanded(
                child: Padding(
                  padding: EdgeInsets.only(
                      right: i < _plans.length - 1 ? 8 : 0),
                  child: _PlanCard(
                    plan: plan,
                    selected: _selectedPlan == i,
                    onTap: () => setState(() => _selectedPlan = i),
                  ),
                ),
              );
            }),
          ),
          const SizedBox(height: 24),

          // Subscribe CTA
          SizedBox(
            width: double.infinity,
            height: 52,
            child: FilledButton.icon(
              onPressed: auth.isLoggedIn ? () {} : null,
              icon: const Icon(Icons.workspace_premium),
              label: Text(
                auth.isLoggedIn
                    ? 'Subscribe with Lightning'
                    : 'Log in to subscribe',
                style: const TextStyle(fontSize: 16),
              ),
            ),
          ),
          const SizedBox(height: 12),
          Text(
            'Cancel anytime. Payment via Lightning Network.',
            textAlign: TextAlign.center,
            style: TextStyle(
                fontSize: 12,
                color: Theme.of(context).colorScheme.onSurfaceVariant),
          ),
          const SizedBox(height: 24),
        ],
      ),
    );
  }
}

class _HeroHeader extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [scheme.primary, scheme.tertiary],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.workspace_premium, size: 40, color: Colors.white),
          const SizedBox(height: 12),
          const Text(
            'NostrFeed Premium',
            style: TextStyle(
              color: Colors.white,
              fontSize: 22,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 6),
          const Text(
            'Unlock the full power of Nostr with premium relays, media storage, and exclusive features.',
            style: TextStyle(color: Colors.white70, fontSize: 14),
          ),
        ],
      ),
    );
  }
}

class _Feature {
  final IconData icon;
  final String title;
  final String description;
  const _Feature(
      {required this.icon, required this.title, required this.description});
}

class _FeatureTile extends StatelessWidget {
  final _Feature feature;
  const _FeatureTile({required this.feature});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: scheme.primaryContainer,
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(feature.icon,
                size: 20, color: scheme.onPrimaryContainer),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(feature.title,
                    style:
                        const TextStyle(fontWeight: FontWeight.w600)),
                const SizedBox(height: 2),
                Text(
                  feature.description,
                  style: TextStyle(
                      fontSize: 13,
                      color: scheme.onSurfaceVariant,
                      height: 1.4),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Plan {
  final String name;
  final String price;
  final String period;
  final String? savings;
  const _Plan({
    required this.name,
    required this.price,
    required this.period,
    this.savings,
  });
}

class _PlanCard extends StatelessWidget {
  final _Plan plan;
  final bool selected;
  final VoidCallback onTap;
  const _PlanCard(
      {required this.plan, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: selected
              ? scheme.primaryContainer
              : scheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
            color: selected ? scheme.primary : Colors.transparent,
            width: 2,
          ),
        ),
        child: Column(
          children: [
            Text(
              plan.name,
              style: TextStyle(
                fontWeight: FontWeight.bold,
                fontSize: 13,
                color: selected
                    ? scheme.onPrimaryContainer
                    : scheme.onSurface,
              ),
            ),
            const SizedBox(height: 6),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Icon(Icons.bolt,
                    size: 14,
                    color: selected ? scheme.primary : scheme.onSurfaceVariant),
                Text(
                  plan.price,
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 16,
                    color: selected ? scheme.primary : scheme.onSurface,
                  ),
                ),
              ],
            ),
            Text(
              '/${plan.period}',
              style: TextStyle(
                  fontSize: 10,
                  color: selected
                      ? scheme.onPrimaryContainer
                      : scheme.onSurfaceVariant),
            ),
            if (plan.savings != null) ...[
              const SizedBox(height: 4),
              Text(
                plan.savings!,
                style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w600,
                    color: Colors.green.shade700),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
