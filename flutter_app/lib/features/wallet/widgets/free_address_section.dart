import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/config/env.dart';
import 'package:nostrfeed_mobile/features/identity/providers/address_providers.dart';

// ── Free Address Section ──────────────────────────────────────────────

class FreeAddressSection extends ConsumerWidget {
  const FreeAddressSection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final freeAddress = ref.watch(freeAddressProvider);
    final lightning = ref.watch(lightningAddressProvider);
    final colorScheme = Theme.of(context).colorScheme;
    final theme = Theme.of(context);

    if (freeAddress == null) return const SizedBox.shrink();

    final fullAddress = '$freeAddress@${Env.lightningAddressDomain}';
    final isClaimed =
        lightning.addresses.any((a) => a.startsWith(freeAddress));

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.card_giftcard, color: colorScheme.primary),
                const SizedBox(width: 8),
                Text(
                  'Free Address',
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              'Every Nostr key gets one — derived from your public key, no payment needed.',
              style: theme.textTheme.bodySmall?.copyWith(
                color: colorScheme.onSurfaceVariant,
                height: 1.4,
              ),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: Text(
                    fullAddress,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      fontFamily: 'monospace',
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.copy, size: 18),
                  tooltip: 'Copy address',
                  onPressed: () {
                    Clipboard.setData(ClipboardData(text: fullAddress));
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('Address copied')),
                    );
                  },
                ),
              ],
            ),
            if (!isClaimed && !lightning.isLoading) ...[
              const SizedBox(height: 8),
              SizedBox(
                width: double.infinity,
                child: FilledButton.tonal(
                  onPressed: () async {
                    try {
                      await ref
                          .read(lightningAddressProvider.notifier)
                          .claim(username: freeAddress);
                      if (context.mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                              content: Text('Free address claimed!')),
                        );
                      }
                    } catch (e) {
                      if (context.mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(content: Text('$e')),
                        );
                      }
                    }
                  },
                  child: const Text('Claim this address'),
                ),
              ),
            ] else if (isClaimed) ...[
              const SizedBox(height: 8),
              Row(
                children: [
                  Icon(Icons.check_circle,
                      size: 16, color: Colors.green.shade600),
                  const SizedBox(width: 4),
                  Text(
                    'Claimed',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: Colors.green.shade600,
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}
