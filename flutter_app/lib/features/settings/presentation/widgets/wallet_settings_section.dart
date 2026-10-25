import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nostrfeed_mobile/core/config/env.dart';
import 'package:nostrfeed_mobile/core/theme/app_shapes.dart';
import 'package:nostrfeed_mobile/core/theme/app_theme.dart';
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/features/settings/application/settings_providers.dart';
import 'package:nostrfeed_mobile/features/wallet/application/lnbits_providers.dart';
import 'package:nostrfeed_mobile/features/wallet/application/nwc_providers.dart';
import 'package:nostrfeed_mobile/features/wallet/application/wallet_tools_providers.dart';

/// The Wallet section of Settings: the LNbits instance this app talks to,
/// quick links to the wallet + NWC + Cashu, and a Premium entry.
class WalletSettingsSection extends ConsumerWidget {
  const WalletSettingsSection({super.key});

  Future<void> _editUrl(BuildContext context, WidgetRef ref) async {
    final current = ref.read(lnbitsUrlProvider);
    final controller = TextEditingController(text: current);
    final saved = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('LNbits instance'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Which LNbits server the wallet, names, and premium features talk to. Change only if yours is hosted elsewhere.',
              style: Theme.of(ctx).textTheme.bodyMedium,
            ),
            const SizedBox(height: 12),
            TextField(
              controller: controller,
              decoration: const InputDecoration(
                labelText: 'Instance URL',
                hintText: 'https://ln.nostrfeed.com',
                prefixIcon: AppIcon('globe', size: AppIconSize.md),
              ),
              keyboardType: TextInputType.url,
              autofocus: true,
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () async {
              await ref.read(lnbitsUrlProvider.notifier).reset();
              if (ctx.mounted) Navigator.pop(ctx, true);
            },
            child: const Text('Reset'),
          ),
          FilledButton(
            onPressed: () async {
              await ref
                  .read(lnbitsUrlProvider.notifier)
                  .setUrl(controller.text);
              if (ctx.mounted) Navigator.pop(ctx, true);
            },
            child: const Text('Save'),
          ),
        ],
      ),
    );
    if (saved == true && context.mounted) {
      AppToast.success(context, 'Wallet server updated — sign in again if it changed');
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final url = ref.watch(lnbitsUrlProvider);
    final lnbits = ref.watch(lnbitsAuthProvider);
    final nwc = ref.watch(nwcNotifierProvider);
    final isDefault = url == Env.lnbitsUrl;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // LNbits instance
        ListTile(
          leading: Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: lnbits.isConnected
                  ? AppStatusColors.success.withValues(alpha: 0.12)
                  : scheme.surfaceContainerHighest,
              borderRadius: AppShapes.radiusMd,
            ),
            child: AppIcon(
              lnbits.isConnected ? 'check' : 'globe',
              size: AppIconSize.md,
              color: lnbits.isConnected
                  ? AppStatusColors.success
                  : scheme.onSurfaceVariant,
            ),
          ),
          title: const Text('Wallet server (LNbits)'),
          subtitle: Text(
            url.replaceFirst('https://', ''),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context)
                .textTheme
                .bodySmall
                ?.copyWith(fontFamily: 'monospace'),
          ),
          trailing: TextButton(
            onPressed: () => _editUrl(context, ref),
            child: Text(isDefault ? 'Edit' : 'Custom'),
          ),
        ),
        // Wallet / NWC / Cashu quick links
        ListTile(
          leading: const AppIcon('wallet'),
          title: const Text('Wallet'),
          subtitle: Text(
            lnbits.isConnected
                ? '${lnbits.account?.wallets.length ?? 0} wallet${lnbits.account?.wallets.length == 1 ? '' : 's'} connected'
                : 'Not connected',
          ),
          trailing: const AppIcon('chevron_r'),
          onTap: () => context.push('/wallet/lnbits'),
        ),
        ListTile(
          leading: const AppIcon('link'),
          title: const Text('Nostr Wallet Connect'),
          subtitle: Text(
            nwc.isConnected
                ? (nwc.activeConnection?.alias ?? 'Connected')
                : 'External wallet (Alby, Zeus…)',
          ),
          trailing: const AppIcon('chevron_r'),
          onTap: () => context.push('/wallet/nwc'),
        ),
        ListTile(
          leading: const AppIcon('gift'),
          title: const Text('Cashu ecash'),
          subtitle: const Text('Private ecash wallet'),
          trailing: const AppIcon('chevron_r'),
          onTap: () => context.push('/wallet/cashu'),
        ),
        // Premium entry
        ListTile(
          leading: Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: scheme.primaryContainer.withValues(alpha: 0.5),
              borderRadius: AppShapes.radiusMd,
            ),
            child: AppIcon(
              'verified',
              size: AppIconSize.md,
              color: scheme.primary,
            ),
          ),
          title: const Text('Premium'),
          subtitle: const Text(
              'Verified name, paid relay, bunker, Wallet Connect'),
          trailing: const AppIcon('chevron_r'),
          onTap: () => context.push('/premium'),
        ),
        // Recheck pending payments (the "invoice stuck" fix).
        if (lnbits.isConnected)
          ListTile(
            leading: const AppIcon('repost'),
            title: const Text('Refresh pending payments'),
            subtitle: const Text(
                'Force a re-check of payments stuck on "pending"'),
            onTap: () async {
              final wallet = lnbits.activeWallet;
              final key = wallet?.inkey ?? wallet?.adminkey;
              if (key == null) return;
              try {
                await ref
                    .read(walletToolsServiceProvider)
                    .recheckPending(apiKey: key);
                await ref.read(lnbitsAuthProvider.notifier).refresh();
                if (context.mounted) {
                  AppToast.success(context, 'Payments re-checked');
                }
              } catch (e) {
                if (context.mounted) AppToast.error(context, '$e');
              }
            },
          ),
      ],
    );
  }
}
