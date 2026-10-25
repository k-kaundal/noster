import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:nostrfeed_mobile/core/theme/app_theme.dart';
import 'package:nostrfeed_mobile/features/wallet/application/cashu_providers.dart';
import 'package:nostrfeed_mobile/features/wallet/application/lnbits_providers.dart';
import 'package:nostrfeed_mobile/features/wallet/application/nwc_providers.dart';
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';

/// Wallet-connection status tiles (LNbits, NWC, Cashu) — each a CircleAvatar
/// status icon + name + live balance summary + chevron, navigating to the
/// wallet's screen. Extracted from `wallet_screen.dart` where the LNbits and
/// Cashu tiles were copy-pasted into both settings tabs.
class LnbitsConnectionTile extends ConsumerWidget {
  const LnbitsConnectionTile({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colorScheme = Theme.of(context).colorScheme;
    final lnbits = ref.watch(lnbitsAuthProvider);

    return ListTile(
      leading: CircleAvatar(
        backgroundColor: lnbits.isConnected
            ? AppStatusColors.success.withValues(alpha: 0.12)
            : colorScheme.surfaceContainerHighest,
        child: Icon(
          lnbits.isConnected ? Icons.check : Icons.account_balance,
          color: lnbits.isConnected
              ? AppStatusColors.success
              : colorScheme.onSurfaceVariant,
          size: 20,
        ),
      ),
      title: const Text('NostrFeed Wallet'),
      subtitle: Text(
        lnbits.isConnected
            ? '${lnbits.account?.wallets.length ?? 0} wallet'
                '${lnbits.account?.wallets.length == 1 ? '' : 's'} • '
                '${lnbits.account?.wallets.fold(0, (s, w) => s + w.balanceSats) ?? 0} sats'
            : 'Not connected',
      ),
      trailing: const AppIcon('chevron_r'),
      onTap: () => context.push('/wallet/lnbits'),
    );
  }
}

class NwcConnectionTile extends ConsumerWidget {
  const NwcConnectionTile({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colorScheme = Theme.of(context).colorScheme;
    final nwc = ref.watch(nwcNotifierProvider);

    return ListTile(
      leading: CircleAvatar(
        backgroundColor: nwc.isConnected
            ? AppStatusColors.success.withValues(alpha: 0.12)
            : colorScheme.surfaceContainerHighest,
        child: Icon(
          nwc.isConnected ? Icons.check : Icons.link,
          color: nwc.isConnected
              ? AppStatusColors.success
              : colorScheme.onSurfaceVariant,
          size: 20,
        ),
      ),
      title: const Text('NWC Connections'),
      subtitle: Text(
        nwc.isConnected
            ? '${nwc.activeConnection?.alias ?? 'Connected'} • '
                '${nwc.balanceSats ?? 0} sats'
            : '${nwc.connections.length} saved connection'
                '${nwc.connections.length == 1 ? '' : 's'}',
      ),
      trailing: const AppIcon('chevron_r'),
      onTap: () => context.push('/wallet/nwc'),
    );
  }
}

class CashuConnectionTile extends ConsumerWidget {
  const CashuConnectionTile({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colorScheme = Theme.of(context).colorScheme;
    final cashu = ref.watch(cashuWalletProvider);

    return ListTile(
      leading: CircleAvatar(
        backgroundColor: colorScheme.surfaceContainerHighest,
        child: Icon(
          Icons.eco,
          color: colorScheme.onSurfaceVariant,
          size: 20,
        ),
      ),
      title: const Text('Cashu Ecash'),
      subtitle: Text(
        '${cashu.data.proofs.length} proofs • ${cashu.totalSats} sats',
      ),
      trailing: const AppIcon('chevron_r'),
      onTap: () => context.push('/wallet/cashu'),
    );
  }
}
