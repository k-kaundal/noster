import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/features/identity/application/address_providers.dart';

// ── Current Address Section ───────────────────────────────────────────

class CurrentAddressSection extends ConsumerWidget {
  const CurrentAddressSection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final lightning = ref.watch(lightningAddressProvider);
    final auth = ref.watch(authStateProvider);
    final hasLightning = ref.watch(hasLightningAddressProvider);
    final colorScheme = Theme.of(context).colorScheme;
    final theme = Theme.of(context);

    final primary = lightning.primaryAddress;
    final published = auth.profile?.lud16;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.bolt, color: colorScheme.primary),
                const SizedBox(width: 8),
                Text(
                  'Lightning Address',
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            if (lightning.isLoading)
              const Center(
                child: Padding(
                  padding: EdgeInsets.all(16),
                  child: SizedBox(
                    width: 24,
                    height: 24,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                ),
              )
            else if (lightning.error != null)
              Text(
                lightning.error!,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: colorScheme.error,
                ),
              )
            else if (primary == null)
              Text(
                'No address claimed yet. Your free address below is ready to use.',
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: colorScheme.onSurfaceVariant,
                ),
              )
            else ...[
              Row(
                children: [
                  Expanded(
                    child: Text(
                      primary,
                      style: theme.textTheme.bodyLarge?.copyWith(
                        fontFamily: 'monospace',
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.copy, size: 18),
                    tooltip: 'Copy address',
                    onPressed: () {
                      Clipboard.setData(ClipboardData(text: primary));
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('Address copied')),
                      );
                    },
                  ),
                ],
              ),
              if (published != null && published == primary) ...[
                const SizedBox(height: 8),
                Row(
                  children: [
                    Icon(Icons.check_circle,
                        size: 16, color: Colors.green.shade600),
                    const SizedBox(width: 4),
                    Text(
                      'Published on your Nostr profile',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: Colors.green.shade600,
                      ),
                    ),
                  ],
                ),
              ] else ...[
                const SizedBox(height: 8),
                Text(
                  'Not on your Nostr profile yet',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: colorScheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 8),
                TextButton.icon(
                  onPressed: () async {
                    try {
                      await ref
                          .read(lightningAddressProvider.notifier)
                          .publishToProfile(address: primary);
                      if (context.mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                              content: Text('Published to your profile')),
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
                  icon: const Icon(Icons.publish, size: 16),
                  label: const Text('Publish to profile'),
                  style: TextButton.styleFrom(
                    foregroundColor: colorScheme.primary,
                    padding: EdgeInsets.zero,
                    minimumSize: const Size(0, 36),
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  ),
                ),
              ],
              if (lightning.silentAddresses.isNotEmpty) ...[
                const SizedBox(height: 8),
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: colorScheme.surfaceContainerHighest
                        .withValues(alpha: 0.5),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Row(
                    children: [
                      Icon(Icons.notifications_off_outlined,
                          size: 16,
                          color: colorScheme.onSurfaceVariant),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          'Zaps are off for some addresses',
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: colorScheme.onSurfaceVariant,
                          ),
                        ),
                      ),
                      TextButton(
                        onPressed: () => ref
                            .read(lightningAddressProvider.notifier)
                            .enableZaps(),
                        child: const Text('Enable'),
                      ),
                    ],
                  ),
                ),
              ],
            ],
            if (!lightning.isLoading &&
                lightning.error == null &&
                primary != null &&
                hasLightning &&
                lightning.links.length > 1) ...[
              const SizedBox(height: 12),
              Divider(
                  height: 1,
                  color: colorScheme.outlineVariant
                      .withValues(alpha: 0.3)),
              const SizedBox(height: 8),
              Text(
                'All addresses',
                style: theme.textTheme.labelLarge?.copyWith(
                  color: colorScheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: 4),
              for (final addr in lightning.addresses)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 2),
                  child: Text(
                    addr,
                    style: theme.textTheme.bodySmall?.copyWith(
                      fontFamily: 'monospace',
                      color: addr == primary
                          ? colorScheme.primary
                          : colorScheme.onSurfaceVariant,
                    ),
                  ),
                ),
            ],
          ],
        ),
      ),
    );
  }
}
