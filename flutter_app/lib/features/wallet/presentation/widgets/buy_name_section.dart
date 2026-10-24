import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:nostrfeed_mobile/core/config/env.dart';
import 'package:nostrfeed_mobile/features/identity/application/address_providers.dart';
import 'package:nostrfeed_mobile/features/identity/data/address_service.dart';
import 'package:nostrfeed_mobile/features/identity/presentation/widgets/owned_nip5_tile.dart';

// ── Buy Name Section ──────────────────────────────────────────────────

/// The wallet's Verified Name section. Lists every owned name (each with its
/// own state-driven action — publish for active, "pay for it" for unpaid)
/// via the shared [OwnedNip5Tile], and always offers "buy another".
class BuyNameSection extends ConsumerWidget {
  const BuyNameSection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final nip5 = ref.watch(nip5Provider);
    final colorScheme = Theme.of(context).colorScheme;
    final theme = Theme.of(context);

    // Hide if the NIP-05 extension isn't available on this server.
    if (!nip5.isAvailable && !nip5.isLoading) {
      return const SizedBox.shrink();
    }

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.verified_outlined, color: colorScheme.primary),
                const SizedBox(width: 8),
                Text(
                  'Verified Name',
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              nip5Domains.length > 1
                  ? 'A NIP-05 name under ${nip5Domains.map((d) => d.domain).join(' or ')} — proves who you are across Nostr clients.'
                  : 'A NIP-05 name like you@${nip5Domains.isEmpty ? Env.nip5Domain : nip5Domains.first.domain} — proves who you are across Nostr clients.',
              style: theme.textTheme.bodySmall?.copyWith(
                color: colorScheme.onSurfaceVariant,
                height: 1.4,
              ),
            ),
            const SizedBox(height: 12),
            if (nip5.isLoading)
              const Center(
                child: Padding(
                  padding: EdgeInsets.all(8),
                  child: SizedBox(
                    width: 24,
                    height: 24,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                ),
              )
            else if (nip5.addresses.isNotEmpty) ...[
              // Every owned name, on any domain — the shared tile drives the
              // right action per state (publish / pay-for-it / on-profile).
              for (final addr in nip5.addresses) ...[
                OwnedNip5Tile(address: addr),
                const Divider(height: 8),
              ],
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  onPressed: () => context.push('/wallet/buy-name'),
                  icon: const Icon(Icons.add, size: 18),
                  label: const Text('Buy another name'),
                ),
              ),
            ] else ...[
              SizedBox(
                width: double.infinity,
                child: FilledButton.tonalIcon(
                  onPressed: () => context.push('/wallet/buy-name'),
                  icon: const Icon(Icons.add, size: 18),
                  label: const Text('Get a verified name'),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
