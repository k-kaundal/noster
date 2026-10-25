import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nostrfeed_mobile/core/config/env.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/features/identity/application/address_providers.dart';

/// The wallet's Lightning Address card — shows the ACCURATE address from the
/// wallet itself (LNbits primary pay link), falling back to the free derived
/// address, falling back to whatever the profile advertises (may be stale).
///
/// Extracted from `wallet_screen.dart` where it was copy-pasted into both
/// `_settingsTab` and `_nwcSettingsTab`.
class LightningAddressCard extends ConsumerWidget {
  const LightningAddressCard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colorScheme = Theme.of(context).colorScheme;
    final auth = ref.watch(authStateProvider);
    final lightning = ref.watch(lightningAddressProvider);
    final freeAddress = ref.watch(freeAddressProvider);

    final accurateAddress = lightning.primaryAddress ??
        (freeAddress != null
            ? '$freeAddress@${Env.lightningAddressDomain}'
            : null) ??
        auth.profile?.lud16;

    // Whether the profile's lud16 matches what LNbits actually has.
    final profileMatchesWallet = auth.profile?.lud16 != null &&
        lightning.addresses.contains(auth.profile!.lud16);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                AppIcon('at', color: colorScheme.primary),
                const SizedBox(width: 8),
                Text(
                  'Lightning Address',
                  style: Theme.of(context)
                      .textTheme
                      .titleMedium
                      ?.copyWith(fontWeight: FontWeight.bold),
                ),
              ],
            ),
            const SizedBox(height: 12),
            if (accurateAddress != null) ...[
              Row(
                children: [
                  Expanded(
                    child: SelectableText(
                      accurateAddress,
                      style: const TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  IconButton(
                    icon: const AppIcon('edit', size: 20),
                    tooltip: 'Copy address',
                    onPressed: () {
                      Clipboard.setData(
                        ClipboardData(text: accurateAddress),
                      );
                      AppToast.success(
                          context, 'Lightning address copied');
                    },
                  ),
                ],
              ),
              const SizedBox(height: 8),
              if (lightning.isLoading)
                const LinearProgressIndicator()
              else if (!profileMatchesWallet && auth.profile?.lud16 != null)
                Text(
                  'Your profile shows a different address. Update it to match.',
                  style: Theme.of(context)
                      .textTheme
                      .bodySmall
                      ?.copyWith(color: colorScheme.error),
                )
              else if (auth.profile?.lud16 == null)
                Text(
                  'Not published to your Nostr profile yet.',
                  style: Theme.of(context)
                      .textTheme
                      .bodySmall
                      ?.copyWith(color: colorScheme.onSurfaceVariant),
                ),
            ] else ...[
              Text(
                'No lightning address claimed yet.',
                style: Theme.of(context).textTheme.bodyMedium,
              ),
              const SizedBox(height: 8),
              if (freeAddress != null)
                Text(
                  'Your free address: $freeAddress@${Env.lightningAddressDomain}',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: colorScheme.onSurfaceVariant,
                        fontFamily: 'monospace',
                      ),
                ),
            ],
          ],
        ),
      ),
    );
  }
}
