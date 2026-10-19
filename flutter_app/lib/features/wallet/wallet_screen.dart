import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:timeago/timeago.dart' as timeago;
import 'package:intl/intl.dart';

import 'package:nostrfeed_mobile/core/config/env.dart';
import 'package:nostrfeed_mobile/features/identity/providers/address_providers.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/features/wallet/providers/cashu_providers.dart';
import 'package:nostrfeed_mobile/features/wallet/providers/lnbits_providers.dart';
import 'package:nostrfeed_mobile/features/wallet/providers/nwc_providers.dart';
import 'package:nostrfeed_mobile/features/wallet/services/lnbits_service.dart';
import 'package:nostrfeed_mobile/features/wallet/services/nwc_service.dart';
import 'package:nostrfeed_mobile/features/wallet/widgets/wallet_login_prompt.dart';

/// Wallet hub: shows the LNbits custodial wallet if connected, otherwise
/// offers to create one. Secondary wallets (NWC, Cashu) live in the
/// "More wallets" section. Matches the web WalletPage flow.
class WalletScreen extends ConsumerStatefulWidget {
  const WalletScreen({super.key});

  @override
  ConsumerState<WalletScreen> createState() => _WalletScreenState();
}

class _WalletScreenState extends ConsumerState<WalletScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final lnbits = ref.watch(lnbitsAuthProvider);
    final nwc = ref.watch(nwcNotifierProvider);
    final auth = ref.watch(authStateProvider);
    final colorScheme = Theme.of(context).colorScheme;

    // Main wallet state: LNbits (primary) or NWC (fallback)
    final hasLnbits = lnbits.isConnected;
    final hasNwc = nwc.isConnected;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Wallet'),
        actions: [
          IconButton(
            icon: const Icon(Icons.settings_outlined),
            tooltip: 'Wallet Settings',
            onPressed: () => context.push('/wallet/nwc'),
          ),
        ],
      ),
      body: !auth.isLoggedIn
          ? const WalletLoginPrompt()
          : lnbits.isLoading && !lnbits.isConnected
              ? const Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      CircularProgressIndicator(),
                      SizedBox(height: 16),
                      Text('Connecting to your wallet…'),
                    ],
                  ),
                )
              : hasLnbits
                  ? _lnbitsWalletView(context, lnbits, colorScheme)
                  : hasNwc
                      ? _nwcWalletView(context, nwc, colorScheme)
                      : _noWalletView(context, colorScheme),
    );
  }


  // ── LNbits wallet view (primary) ─────────────────────────────────────

  Widget _lnbitsWalletView(
    BuildContext context,
    LnbitsAuthState lnbits,
    ColorScheme colorScheme,
  ) {
    final account = lnbits.account!;
    final wallet = account.wallets.isEmpty ? null : account.wallets.first;
    final balance = wallet?.balanceSats ?? 0;
    final formatter = NumberFormat('#,###');

    return NestedScrollView(
      headerSliverBuilder: (context, innerBoxIsScrolled) => [
        SliverToBoxAdapter(
          child: Container(
            margin: const EdgeInsets.all(16),
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [Colors.blue.shade700, Colors.purple.shade600],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              borderRadius: BorderRadius.circular(20),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text(
                      'SPENDING BALANCE',
                      style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.7),
                        fontSize: 11,
                        fontWeight: FontWeight.bold,
                        letterSpacing: 1.2,
                      ),
                    ),
                    const Spacer(),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.15),
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: Text(
                        'ln.nostrfeed.com',
                        style: TextStyle(
                          color: Colors.white.withValues(alpha: 0.7),
                          fontSize: 10,
                          fontFamily: 'monospace',
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Text(
                  '${formatter.format(balance)} sats',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 36,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                if (account.username != null)
                  Text(
                    'as ${account.username}',
                    style: TextStyle(
                      color: Colors.white.withValues(alpha: 0.7),
                      fontSize: 13,
                    ),
                  ),
              ],
            ),
          ),
        ),
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(
              children: [
                Expanded(
                  child: FilledButton.icon(
                    onPressed: () => context.push('/wallet/lnbits'),
                    icon: const Icon(Icons.open_in_new),
                    label: const Text('Open Wallet'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: FilledButton.tonalIcon(
                    onPressed: () => context.push('/wallet/nwc'),
                    icon: const Icon(Icons.link),
                    label: const Text('NWC'),
                  ),
                ),
              ],
            ),
          ),
        ),
        const SliverToBoxAdapter(child: SizedBox(height: 8)),
        SliverPersistentHeader(
          pinned: true,
          delegate: _TabBarDelegate(
            TabBar(
              controller: _tabController,
              tabs: const [
                Tab(text: 'Wallets'),
                Tab(text: 'Activity'),
                Tab(text: 'Settings'),
              ],
            ),
            colorScheme.surface,
          ),
        ),
      ],
      body: TabBarView(
        controller: _tabController,
        children: [
          _walletsTab(context, lnbits, colorScheme),
          _activityTab(context, wallet, colorScheme),
          _settingsTab(context, colorScheme),
        ],
      ),
    );
  }

  Widget _walletsTab(
    BuildContext context,
    LnbitsAuthState lnbits,
    ColorScheme colorScheme,
  ) {
    final nwc = ref.watch(nwcNotifierProvider);
    final cashu = ref.watch(cashuWalletProvider);

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // LNbits wallet (primary)
        _walletCard(
          context,
          icon: Icons.account_balance,
          title: 'NostrFeed Wallet',
          subtitle: 'ln.nostrfeed.com',
          balance: lnbits.account?.wallets.isEmpty == false
              ? lnbits.account!.wallets.first.balanceSats
              : 0,
          isActive: true,
          color: Colors.blue,
          onTap: () => context.push('/wallet/lnbits'),
        ),
        const SizedBox(height: 8),

        // NWC wallet
        _walletCard(
          context,
          icon: Icons.link,
          title: nwc.activeConnection?.alias ?? 'NWC Wallet',
          subtitle: nwc.isConnected
              ? '${nwc.activeConnection?.walletPubkey.substring(0, 16)}…'
              : 'Not connected',
          balance: nwc.balanceSats ?? 0,
          isActive: nwc.isConnected,
          color: Colors.purple,
          onTap: () => context.push('/wallet/nwc'),
        ),
        const SizedBox(height: 8),

        // Cashu wallet
        _walletCard(
          context,
          icon: Icons.eco,
          title: 'Cashu Ecash',
          subtitle: '${cashu.data.proofs.length} proofs',
          balance: cashu.totalSats,
          isActive: cashu.totalSats > 0,
          color: Colors.teal,
          onTap: () => context.push('/wallet/cashu'),
        ),
      ],
    );
  }

  Widget _walletCard(
    BuildContext context, {
    required IconData icon,
    required String title,
    required String subtitle,
    required int balance,
    required bool isActive,
    required Color color,
    required VoidCallback onTap,
  }) {
    final formatter = NumberFormat('#,###');
    final colorScheme = Theme.of(context).colorScheme;

    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(icon, color: color, size: 24),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Text(
                          title,
                          style: const TextStyle(
                            fontWeight: FontWeight.bold,
                            fontSize: 15,
                          ),
                        ),
                        if (isActive) ...[
                          const SizedBox(width: 6),
                          Container(
                            width: 8,
                            height: 8,
                            decoration: BoxDecoration(
                              color: Colors.green,
                              shape: BoxShape.circle,
                            ),
                          ),
                        ],
                      ],
                    ),
                    Text(
                      subtitle,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: colorScheme.onSurfaceVariant,
                          ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    formatter.format(balance),
                    style: const TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 18,
                    ),
                  ),
                  Text(
                    'sats',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: colorScheme.onSurfaceVariant,
                        ),
                  ),
                ],
              ),
              const SizedBox(width: 8),
              Icon(Icons.chevron_right,
                  color: colorScheme.onSurfaceVariant, size: 20),
            ],
          ),
        ),
      ),
    );
  }

  Widget _activityTab(
    BuildContext context,
    LnbitsWallet? wallet,
    ColorScheme colorScheme,
  ) {
    if (wallet == null) {
      return Center(
        child: Text('No wallet activity',
            style: TextStyle(color: colorScheme.onSurfaceVariant)),
      );
    }
    return _PaymentsListInline(apiKey: wallet.inkey ?? wallet.adminkey ?? '');
  }

  Widget _settingsTab(BuildContext context, ColorScheme colorScheme) {
    final auth = ref.watch(authStateProvider);
    final lightning = ref.watch(lightningAddressProvider);
    final freeAddress = ref.watch(freeAddressProvider);
    final lnbits = ref.watch(lnbitsAuthProvider);
    final nwc = ref.watch(nwcNotifierProvider);

    // The accurate lightning address: the one actually claimed on LNbits
    // (primaryAddress), falling back to the free address derived from pubkey,
    // falling back to whatever the profile advertises (may be stale).
    final accurateAddress = lightning.primaryAddress ??
        (freeAddress != null ? '$freeAddress@${Env.lightningAddressDomain}' : null) ??
        auth.profile?.lud16;

    // Whether the profile's lud16 matches what LNbits actually has.
    final profileMatchesWallet = auth.profile?.lud16 != null &&
        lightning.addresses.contains(auth.profile!.lud16);

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // Lightning Address — accurate, from the wallet itself
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(Icons.alternate_email, color: colorScheme.primary),
                    const SizedBox(width: 8),
                    Text(
                      'Lightning Address',
                      style: Theme.of(context).textTheme.titleMedium
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
                        icon: const Icon(Icons.copy, size: 20),
                        tooltip: 'Copy address',
                        onPressed: () {
                          Clipboard.setData(
                              ClipboardData(text: accurateAddress));
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                                content: Text('Lightning address copied')),
                          );
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
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: colorScheme.error,
                          ),
                    )
                  else if (auth.profile?.lud16 == null)
                    Text(
                      'Not published to your Nostr profile yet.',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: colorScheme.onSurfaceVariant,
                          ),
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
        ),
        const SizedBox(height: 16),

        // Wallet connections summary — accurate status
        Card(
          child: Column(
            children: [
              ListTile(
                leading: CircleAvatar(
                  backgroundColor: lnbits.isConnected
                      ? Colors.green.withValues(alpha: 0.12)
                      : colorScheme.surfaceContainerHighest,
                  child: Icon(
                    lnbits.isConnected ? Icons.check : Icons.account_balance,
                    color: lnbits.isConnected
                        ? Colors.green
                        : colorScheme.onSurfaceVariant,
                    size: 20,
                  ),
                ),
                title: const Text('NostrFeed Wallet'),
                subtitle: Text(
                  lnbits.isConnected
                      ? '${lnbits.account?.wallets.length ?? 0} wallet${lnbits.account?.wallets.length == 1 ? '' : 's'} • ${lnbits.account?.wallets.fold(0, (s, w) => s + w.balanceSats) ?? 0} sats'
                      : 'Not connected',
                ),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.push('/wallet/lnbits'),
              ),
              const Divider(height: 1, indent: 72),
              ListTile(
                leading: CircleAvatar(
                  backgroundColor: nwc.isConnected
                      ? Colors.green.withValues(alpha: 0.12)
                      : colorScheme.surfaceContainerHighest,
                  child: Icon(
                    nwc.isConnected ? Icons.check : Icons.link,
                    color: nwc.isConnected
                        ? Colors.green
                        : colorScheme.onSurfaceVariant,
                    size: 20,
                  ),
                ),
                title: const Text('NWC Connections'),
                subtitle: Text(
                  nwc.isConnected
                      ? '${nwc.activeConnection?.alias ?? 'Connected'} • ${nwc.balanceSats ?? 0} sats'
                      : '${nwc.connections.length} saved connection${nwc.connections.length == 1 ? '' : 's'}',
                ),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.push('/wallet/nwc'),
              ),
              const Divider(height: 1, indent: 72),
              ListTile(
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
                  '${ref.watch(cashuWalletProvider).data.proofs.length} proofs • '
                  '${ref.watch(cashuWalletProvider).totalSats} sats',
                ),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.push('/wallet/cashu'),
              ),
            ],
          ),
        ),
      ],
    );
  }

  // ── NWC wallet view (fallback) ───────────────────────────────────────

  Widget _nwcWalletView(
    BuildContext context,
    NwcState nwcState,
    ColorScheme colorScheme,
  ) {
    final formatter = NumberFormat('#,###');
    final balance = nwcState.balanceSats;

    return NestedScrollView(
      headerSliverBuilder: (context, innerBoxIsScrolled) => [
        SliverToBoxAdapter(
          child: Container(
            margin: const EdgeInsets.all(16),
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [colorScheme.primary, colorScheme.tertiary],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              borderRadius: BorderRadius.circular(20),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(Icons.bolt,
                        color: Colors.white.withValues(alpha: 0.9), size: 20),
                    const SizedBox(width: 6),
                    Text(
                      nwcState.activeConnection?.alias ?? 'NWC Wallet',
                      style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.9),
                        fontSize: 14,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                balance != null
                    ? Text(
                        '${formatter.format(balance)} sats',
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 36,
                          fontWeight: FontWeight.bold,
                        ),
                      )
                    : Text(
                        'Loading…',
                        style: TextStyle(
                          color: Colors.white.withValues(alpha: 0.7),
                          fontSize: 28,
                        ),
                      ),
              ],
            ),
          ),
        ),
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(
              children: [
                Expanded(
                  child: FilledButton.icon(
                    onPressed: () => context.push('/wallet/nwc'),
                    icon: const Icon(Icons.link),
                    label: const Text('Manage NWC'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: FilledButton.tonalIcon(
                    onPressed: () => context.push('/wallet/lnbits'),
                    icon: const Icon(Icons.account_balance),
                    label: const Text('Create Wallet'),
                  ),
                ),
              ],
            ),
          ),
        ),
        const SliverToBoxAdapter(child: SizedBox(height: 8)),
        SliverPersistentHeader(
          pinned: true,
          delegate: _TabBarDelegate(
            TabBar(
              controller: _tabController,
              tabs: const [
                Tab(text: 'Transactions'),
                Tab(text: 'Zaps'),
                Tab(text: 'Settings'),
              ],
            ),
            colorScheme.surface,
          ),
        ),
      ],
      body: TabBarView(
        controller: _tabController,
        children: [
          _nwcTransactionList(nwcState.transactions ?? [], colorScheme),
          _nwcTransactionList(
            (nwcState.transactions ?? [])
                .where((t) => t.isIncoming)
                .toList(),
            colorScheme,
          ),
          _nwcSettingsTab(context, nwcState, colorScheme),
        ],
      ),
    );
  }

  Widget _nwcTransactionList(
      List<NwcTransaction> txs, ColorScheme colorScheme) {
    if (txs.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.receipt_long,
                size: 48, color: colorScheme.onSurfaceVariant),
            const SizedBox(height: 12),
            Text('No transactions yet',
                style: TextStyle(color: colorScheme.onSurfaceVariant)),
          ],
        ),
      );
    }
    return ListView.separated(
      padding: const EdgeInsets.symmetric(vertical: 4),
      itemCount: txs.length,
      separatorBuilder: (_, _) => const Divider(indent: 72),
      itemBuilder: (context, index) =>
          _nwcTransactionTile(context, txs[index], colorScheme),
    );
  }

  Widget _nwcTransactionTile(
      BuildContext context, NwcTransaction tx, ColorScheme colorScheme) {
    final formatter = NumberFormat('#,###');
    final isIncoming = tx.isIncoming;
    final amountColor = isIncoming ? Colors.green : colorScheme.error;

    return ListTile(
      leading: Container(
        padding: const EdgeInsets.all(8),
        decoration: BoxDecoration(
          color: amountColor.withValues(alpha: 0.12),
          shape: BoxShape.circle,
        ),
        child: Icon(
          isIncoming ? Icons.arrow_downward : Icons.arrow_upward,
          color: amountColor,
          size: 20,
        ),
      ),
      title: Text(
        '${isIncoming ? '+' : '-'}${formatter.format(tx.amountSats)} sats',
        style: TextStyle(
          fontWeight: FontWeight.w600,
          color: amountColor,
        ),
      ),
      subtitle: tx.description != null
          ? Text(tx.description!, maxLines: 1, overflow: TextOverflow.ellipsis)
          : null,
      trailing: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Text(
            timeago.format(
                DateTime.fromMillisecondsSinceEpoch(tx.createdAt * 1000)),
            style: Theme.of(context).textTheme.bodySmall,
          ),
          if (!tx.isSettled)
            Text(
              'Pending',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: Colors.orange,
                    fontWeight: FontWeight.w600,
                  ),
            ),
        ],
      ),
    );
  }

  Widget _nwcSettingsTab(
      BuildContext context, NwcState nwcState, ColorScheme colorScheme) {
    final auth = ref.watch(authStateProvider);
    final lightning = ref.watch(lightningAddressProvider);
    final freeAddress = ref.watch(freeAddressProvider);
    final lnbits = ref.watch(lnbitsAuthProvider);
    final cashu = ref.watch(cashuWalletProvider);

    // Accurate lightning address from LNbits pay links (or free address).
    final accurateAddress = lightning.primaryAddress ??
        (freeAddress != null ? '$freeAddress@${Env.lightningAddressDomain}' : null) ??
        auth.profile?.lud16;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // Active NWC connection
        if (nwcState.activeConnection != null)
          Card(
            color: colorScheme.primaryContainer,
            child: ListTile(
              leading: CircleAvatar(
                backgroundColor: colorScheme.primary,
                child: const Icon(Icons.check, color: Colors.white),
              ),
              title: Text(
                nwcState.activeConnection!.alias,
                style: TextStyle(
                  fontWeight: FontWeight.bold,
                  color: colorScheme.onPrimaryContainer,
                ),
              ),
              subtitle: Text(
                '${nwcState.activeConnection!.walletPubkey.substring(0, 12)}…'
                '${nwcState.balanceSats != null ? ' • ${nwcState.balanceSats} sats' : ''}',
                style: TextStyle(
                  color: colorScheme.onPrimaryContainer.withValues(alpha: 0.7),
                ),
              ),
            ),
          ),
        const SizedBox(height: 8),

        // Lightning Address — accurate, from the wallet itself
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(Icons.alternate_email, color: colorScheme.primary),
                    const SizedBox(width: 8),
                    Text(
                      'Lightning Address',
                      style: Theme.of(context).textTheme.titleMedium
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
                        icon: const Icon(Icons.copy, size: 20),
                        tooltip: 'Copy address',
                        onPressed: () {
                          Clipboard.setData(
                              ClipboardData(text: accurateAddress));
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                                content: Text('Lightning address copied')),
                          );
                        },
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  if (lightning.isLoading)
                    const LinearProgressIndicator()
                  else if (auth.profile?.lud16 == null)
                    Text(
                      'Not published to your Nostr profile yet.',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: colorScheme.onSurfaceVariant,
                          ),
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
        ),
        const SizedBox(height: 16),

        // Other wallets
        Card(
          child: Column(
            children: [
              ListTile(
                leading: CircleAvatar(
                  backgroundColor: lnbits.isConnected
                      ? Colors.green.withValues(alpha: 0.12)
                      : colorScheme.surfaceContainerHighest,
                  child: Icon(
                    lnbits.isConnected ? Icons.check : Icons.account_balance,
                    color: lnbits.isConnected
                        ? Colors.green
                        : colorScheme.onSurfaceVariant,
                    size: 20,
                  ),
                ),
                title: const Text('NostrFeed Wallet'),
                subtitle: Text(
                  lnbits.isConnected
                      ? '${lnbits.account?.wallets.length ?? 0} wallet${lnbits.account?.wallets.length == 1 ? '' : 's'} • ${lnbits.account?.wallets.fold(0, (s, w) => s + w.balanceSats) ?? 0} sats'
                      : 'Not connected',
                ),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.push('/wallet/lnbits'),
              ),
              const Divider(height: 1, indent: 72),
              ListTile(
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
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.push('/wallet/cashu'),
              ),
            ],
          ),
        ),
      ],
    );
  }

  // ── No wallet connected ──────────────────────────────────────────────

  Widget _noWalletView(BuildContext context, ColorScheme colorScheme) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // Create wallet CTA
        Card(
          clipBehavior: Clip.antiAlias,
          child: Container(
            width: double.infinity,
            padding:
                const EdgeInsets.symmetric(horizontal: 24, vertical: 48),
            decoration: BoxDecoration(
              color: colorScheme.surfaceContainerHighest
                  .withValues(alpha: 0.4),
            ),
            child: Column(
              children: [
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: colorScheme.primaryContainer,
                    borderRadius: BorderRadius.circular(24),
                  ),
                  child:
                      Icon(Icons.bolt, size: 32, color: colorScheme.primary),
                ),
                const SizedBox(height: 24),
                Text(
                  'Set up your wallet',
                  style:
                      Theme.of(context).textTheme.headlineMedium?.copyWith(
                            fontWeight: FontWeight.bold,
                          ),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 12),
                Text(
                  'One tap creates a lightning wallet and an address like',
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: colorScheme.onSurfaceVariant,
                      ),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 8),
                Text(
                  'you@ln.nostrfeed.com',
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        fontFamily: 'monospace',
                        fontWeight: FontWeight.bold,
                      ),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 8),
                Text(
                  'that people can zap from any Nostr client.',
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: colorScheme.onSurfaceVariant,
                      ),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 32),
                FilledButton.icon(
                  onPressed: () => context.push('/wallet/lnbits'),
                  icon: const Icon(Icons.account_balance_wallet),
                  label: const Text('Create my wallet'),
                  style: FilledButton.styleFrom(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 32, vertical: 16),
                  ),
                ),
                const SizedBox(height: 16),
                TextButton.icon(
                  onPressed: () => context.push('/wallet/nwc'),
                  icon: const Icon(Icons.link, size: 18),
                  label: const Text('Or connect a wallet you already have'),
                  style: TextButton.styleFrom(
                    foregroundColor: colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),

        // Cashu option
        Card(
          child: ListTile(
            leading: Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: Colors.teal.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(12),
              ),
              child: const Icon(Icons.eco, color: Colors.teal, size: 24),
            ),
            title: const Text('Cashu Ecash'),
            subtitle: const Text('Hold sats as private ecash instead'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.push('/wallet/cashu'),
          ),
        ),
      ],
    );
  }
}

/// Payments list inline (used in Activity tab).
class _PaymentsListInline extends ConsumerStatefulWidget {
  final String apiKey;

  const _PaymentsListInline({required this.apiKey});

  @override
  ConsumerState<_PaymentsListInline> createState() =>
      _PaymentsListInlineState();
}

class _PaymentsListInlineState extends ConsumerState<_PaymentsListInline> {
  List<LnbitsPayment>? _payments;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final service = LnbitsService();
      final payments = await service.getPayments(widget.apiKey);
      if (mounted) {
        setState(() {
          _payments = payments;
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = e.toString();
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final formatter = NumberFormat('#,###');

    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }

    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.error_outline, size: 48, color: colorScheme.error),
              const SizedBox(height: 12),
              Text(_error!, textAlign: TextAlign.center),
              const SizedBox(height: 12),
              FilledButton(onPressed: _load, child: const Text('Retry')),
            ],
          ),
        ),
      );
    }

    if (_payments == null || _payments!.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.receipt_long,
                size: 48, color: colorScheme.onSurfaceVariant),
            const SizedBox(height: 12),
            Text('No payments yet',
                style: TextStyle(color: colorScheme.onSurfaceVariant)),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.separated(
        padding: const EdgeInsets.symmetric(vertical: 4),
        itemCount: _payments!.length,
        separatorBuilder: (_, _) => const Divider(indent: 72),
        itemBuilder: (context, index) {
          final p = _payments![index];
          final isIncoming = p.isIncoming;
          final color = isIncoming ? Colors.green : colorScheme.error;

          return ListTile(
            leading: Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.12),
                shape: BoxShape.circle,
              ),
              child: Icon(
                isIncoming ? Icons.arrow_downward : Icons.arrow_upward,
                color: color,
                size: 18,
              ),
            ),
            title: Text(
              '${isIncoming ? '+' : '-'}${formatter.format(p.amountSats)} sats',
              style: TextStyle(
                fontWeight: FontWeight.w600,
                color: color,
              ),
            ),
            subtitle: p.memo != null
                ? Text(p.memo!,
                    maxLines: 1, overflow: TextOverflow.ellipsis)
                : null,
            trailing: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                if (p.timestampMs != null)
                  Text(
                    timeago.format(
                        DateTime.fromMillisecondsSinceEpoch(p.timestampMs!)),
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                if (p.isPending)
                  Text(
                    'Pending',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: Colors.orange,
                          fontWeight: FontWeight.w600,
                        ),
                  ),
              ],
            ),
          );
        },
      ),
    );
  }
}

/// Delegate to pin the TabBar.
class _TabBarDelegate extends SliverPersistentHeaderDelegate {
  final TabBar tabBar;
  final Color backgroundColor;

  _TabBarDelegate(this.tabBar, this.backgroundColor);

  @override
  double get minExtent => tabBar.preferredSize.height;
  @override
  double get maxExtent => tabBar.preferredSize.height;

  @override
  Widget build(
      BuildContext context, double shrinkOffset, bool overlapsContent) {
    return Container(color: backgroundColor, child: tabBar);
  }

  @override
  bool shouldRebuild(_TabBarDelegate oldDelegate) => false;
}
