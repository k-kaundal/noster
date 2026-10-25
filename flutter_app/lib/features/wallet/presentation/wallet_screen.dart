import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/theme/app_shapes.dart';
import 'package:nostrfeed_mobile/core/theme/app_spacing.dart';
import 'package:nostrfeed_mobile/core/theme/app_theme.dart'
    show AppActionColors;
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';
import 'package:nostrfeed_mobile/features/ai/application/ai_providers.dart';
import 'package:nostrfeed_mobile/features/ai/presentation/widgets/ai_top_up_sheet.dart';
import 'package:nostrfeed_mobile/features/wallet/application/cashu_providers.dart';
import 'package:nostrfeed_mobile/features/wallet/application/lnbits_providers.dart';
import 'package:nostrfeed_mobile/features/wallet/application/lndhub_providers.dart';
import 'package:nostrfeed_mobile/features/wallet/application/nwc_providers.dart';
import 'package:nostrfeed_mobile/features/wallet/data/lnbits_service.dart';
import 'package:nostrfeed_mobile/features/wallet/data/nwc_service.dart';
import 'package:nostrfeed_mobile/features/wallet/presentation/widgets/invoice_qr.dart';
import 'package:nostrfeed_mobile/features/wallet/presentation/widgets/lightning_address_card.dart';
import 'package:nostrfeed_mobile/features/wallet/presentation/widgets/wallet_connection_tiles.dart';
import 'package:nostrfeed_mobile/features/wallet/presentation/widgets/wallet_login_prompt.dart';
import 'package:timeago/timeago.dart' as timeago;

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
    _tabController = TabController(length: 4, vsync: this);
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

    // AppBar is owned by AppShell (hamburger → drawer). The wallet's own
    // settings live in the TabBar's "Settings" tab — NO separate settings
    // icon at the top (redundant + reads as clutter, per review).
    return Scaffold(
      body: Column(
        children: [
          Expanded(
            child: !auth.isLoggedIn
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
          ),
        ],
      ),
    );
  }

  // ── LNbits wallet view (primary) ─────────────────────────────────────

  Widget _lnbitsWalletView(
    BuildContext context,
    LnbitsAuthState lnbits,
    ColorScheme colorScheme,
  ) {
    final account = lnbits.account!;
    final wallet = lnbits.activeWallet;
    final balance = wallet?.balanceSats ?? 0;
    final formatter = NumberFormat('#,###');

    return NestedScrollView(
      headerSliverBuilder: (context, innerBoxIsScrolled) => [
        SliverToBoxAdapter(
          child: Container(
            margin: const EdgeInsets.all(AppSpacing.md),
            padding: const EdgeInsets.all(AppSpacing.xl),
            decoration: BoxDecoration(
              // Refined: a quiet dark-ink statement card (no gradient — that's
              // reserved for the logo mark). White text reads on ink.
              color: colorScheme.inverseSurface,
              borderRadius: AppShapes.radiusXl,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text(
                      'SPENDING BALANCE',
                      style: TextStyle(
                        color: colorScheme.onInverseSurface.withValues(
                          alpha: 0.6,
                        ),
                        fontSize: 11,
                        fontWeight: FontWeight.bold,
                        letterSpacing: 1.2,
                      ),
                    ),
                    const Spacer(),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 6,
                        vertical: 2,
                      ),
                      decoration: BoxDecoration(
                        color: colorScheme.onInverseSurface.withValues(
                          alpha: 0.12,
                        ),
                        borderRadius: AppShapes.radiusXs,
                      ),
                      child: Text(
                        'ln.nostrfeed.com',
                        style: TextStyle(
                          color: colorScheme.onInverseSurface.withValues(
                            alpha: 0.7,
                          ),
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
                  style: TextStyle(
                    color: colorScheme.onInverseSurface,
                    fontSize: 36,
                    fontWeight: FontWeight.bold,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
                if (account.username != null)
                  Text(
                    'as ${account.username}',
                    style: TextStyle(
                      color: colorScheme.onInverseSurface.withValues(
                        alpha: 0.6,
                      ),
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
                    icon: const AppIcon('link', size: AppIconSize.md),
                    label: const Text('Open Wallet'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: FilledButton.tonalIcon(
                    onPressed: () => context.push('/wallet/nwc'),
                    icon: const AppIcon('link', size: AppIconSize.lg),
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
                Tab(text: 'Earn'),
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
          _earnTab(context),
          _activityTab(context, wallet, colorScheme),
          _settingsTab(context, colorScheme),
        ],
      ),
    );
  }

  /// The Earn tab (Wallet Hub 2.0): the Earn / Creator / Trade quick-rails
  /// as a FIRST-CLASS tab — visible, not buried at the bottom of the wallets
  /// list. One tap jumps to the money feature.
  Widget _earnTab(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: const [
        _QuickRail(
          title: 'Earn',
          items: [
            _RailItem('gift', 'Sats Drops', 'claim daily', '/sats-drops'),
            _RailItem('target', 'Bounties', 'earn sats', '/bounties'),
            _RailItem('zap', 'Zap Goals', 'get funded', '/studio'),
          ],
        ),
        _QuickRail(
          title: 'Creator',
          items: [
            _RailItem('chart', 'Studio', 'earnings', '/studio'),
            _RailItem('users', 'Memberships', 'subscribers', '/memberships'),
            _RailItem('verified', 'Premium', 'upgrade', '/premium'),
          ],
        ),
        _QuickRail(
          title: 'Trade',
          items: [
            _RailItem('shopping', 'Market', 'buy & sell', '/market'),
            _RailItem('repost', 'P2P', 'peer trade', '/p2p'),
            _RailItem('at', 'Names', 'buy NIP-05', '/wallet/buy-name'),
          ],
        ),
      ],
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
        // LNbits wallet (primary) — the ACTIVE wallet when the account
        // holds several, named so the user can tell them apart.
        _walletCard(
          context,
          icon: Icons.account_balance_wallet,
          title: lnbits.activeWallet?.name ?? 'NostrFeed Wallet',
          subtitle: lnbits.account != null && lnbits.account!.wallets.length > 1
              ? 'ln.nostrfeed.com · ${lnbits.account!.wallets.length} wallets'
              : 'ln.nostrfeed.com',
          balance: lnbits.activeWallet?.balanceSats ?? 0,
          isActive: true,
          color: colorScheme.primary,
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
          color: colorScheme.secondary,
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
          color: colorScheme.tertiary,
          onTap: () => context.push('/wallet/cashu'),
        ),
        const SizedBox(height: 8),

        // LndHub wallet (BlueWallet/Zeus/Alby-style custodial QR)
        _walletCard(
          context,
          icon: Icons.hub_rounded,
          title: 'LndHub',
          subtitle: ref.watch(lndHubProvider).isConnected
              ? ref
                    .watch(lndHubProvider)
                    .credentials!
                    .host
                    .replaceFirst('https://', '')
              : 'BlueWallet / Zeus / Alby QR',
          balance: ref.watch(lndHubProvider).balanceSats ?? 0,
          isActive: ref.watch(lndHubProvider).isConnected,
          color: colorScheme.primary,
          onTap: () => context.push('/wallet/lndhub'),
        ),

        // AI credits — money too, shown with the wallets (not a wallet:
        // balance is the on-device AI credit ledger, tap → top up).
        if (ref.watch(aiAvailableProvider)) ...[
          const SizedBox(height: 8),
          _aiCreditsCard(context, ref, colorScheme),
        ],
      ],
    );
  }

  Widget _aiCreditsCard(
    BuildContext context,
    WidgetRef ref,
    ColorScheme colorScheme,
  ) {
    final formatter = NumberFormat('#,###');
    final balance = ref.watch(aiCreditsProvider).valueOrNull?.balance ?? 0;
    final trialLeft = ref.watch(aiTrialRemainingProvider);

    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => showAiTopUpSheet(context),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: AppActionColors.zap.withValues(alpha: 0.14),
                  borderRadius: AppShapes.radiusMd,
                ),
                child: const AppIcon(
                  'sparkle',
                  size: 24,
                  color: AppActionColors.zap,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'AI Credits',
                      style: TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: 15,
                      ),
                    ),
                    Text(
                      trialLeft > 0
                          ? '$trialLeft free messages left today · tap to top up'
                          : 'Pays for AI messages · tap to top up',
                      style: Theme.of(context).textTheme.bodySmall
                          ?.copyWith(color: colorScheme.onSurfaceVariant),
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
                    'tokens',
                    style: Theme.of(context).textTheme.bodySmall
                        ?.copyWith(color: colorScheme.onSurfaceVariant),
                  ),
                ],
              ),
              const SizedBox(width: 8),
              AppIcon('plus', color: colorScheme.onSurfaceVariant, size: 20),
            ],
          ),
        ),
      ),
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
                            decoration: const BoxDecoration(
                              color: Colors.green,
                              shape: BoxShape.circle,
                            ),
                          ),
                        ],
                      ],
                    ),
                    Text(
                      subtitle,
                      style: Theme.of(context).textTheme.bodySmall
                          ?.copyWith(color: colorScheme.onSurfaceVariant),
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
                    style: Theme.of(context).textTheme.bodySmall
                        ?.copyWith(color: colorScheme.onSurfaceVariant),
                  ),
                ],
              ),
              const SizedBox(width: 8),
              AppIcon(
                'chevron_r',
                color: colorScheme.onSurfaceVariant,
                size: 20,
              ),
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
        child: Text(
          'No wallet activity',
          style: TextStyle(color: colorScheme.onSurfaceVariant),
        ),
      );
    }
    return _PaymentsListInline(apiKey: wallet.inkey ?? wallet.adminkey ?? '');
  }

  Widget _settingsTab(BuildContext context, ColorScheme colorScheme) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: const [
        // Lightning Address — accurate, from the wallet itself
        LightningAddressCard(),
        SizedBox(height: 16),

        // Wallet connections summary — accurate status
        Card(
          child: Column(
            children: [
              LnbitsConnectionTile(),
              Divider(height: 1, indent: 72),
              NwcConnectionTile(),
              Divider(height: 1, indent: 72),
              CashuConnectionTile(),
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
              // Refined: quiet dark-ink statement card (no gradient).
              color: colorScheme.inverseSurface,
              borderRadius: AppShapes.radiusXl,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    AppIcon(
                      'zap',
                      color: colorScheme.onInverseSurface.withValues(
                        alpha: 0.9,
                      ),
                      size: 20,
                    ),
                    const SizedBox(width: 6),
                    Text(
                      nwcState.activeConnection?.alias ?? 'NWC Wallet',
                      style: TextStyle(
                        color: colorScheme.onInverseSurface.withValues(
                          alpha: 0.9,
                        ),
                        fontSize: 14,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                balance != null
                    ? Text(
                        '${formatter.format(balance)} sats',
                        style: TextStyle(
                          color: colorScheme.onInverseSurface,
                          fontSize: 36,
                          fontWeight: FontWeight.bold,
                          fontFeatures: const [FontFeature.tabularFigures()],
                        ),
                      )
                    : Text(
                        'Loading…',
                        style: TextStyle(
                          color: colorScheme.onInverseSurface.withValues(
                            alpha: 0.6,
                          ),
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
                    icon: const AppIcon('link', size: AppIconSize.lg),
                    label: const Text('Manage NWC'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: FilledButton.tonalIcon(
                    onPressed: () => context.push('/wallet/lnbits'),
                    icon: const AppIcon('wallet', size: AppIconSize.lg),
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
                Tab(text: 'Earn'),
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
          _earnTab(context),
          _nwcTransactionList(nwcState.transactions ?? [], colorScheme),
          _nwcTransactionList(
            (nwcState.transactions ?? []).where((t) => t.isIncoming).toList(),
            colorScheme,
          ),
          _nwcSettingsTab(context, nwcState, colorScheme),
        ],
      ),
    );
  }

  Widget _nwcTransactionList(
    List<NwcTransaction> txs,
    ColorScheme colorScheme,
  ) {
    if (txs.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            AppIcon('article', size: 48, color: colorScheme.onSurfaceVariant),
            const SizedBox(height: 12),
            Text(
              'No transactions yet',
              style: TextStyle(color: colorScheme.onSurfaceVariant),
            ),
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
    BuildContext context,
    NwcTransaction tx,
    ColorScheme colorScheme,
  ) {
    final formatter = NumberFormat('#,###');
    final isIncoming = tx.isIncoming;
    final amountColor = isIncoming ? Colors.green : colorScheme.error;

    // Pending incoming transactions are tappable → re-show the invoice QR
    // (the wallet activity tab shares the same InvoiceQrView as LNbits).
    final showQr = !tx.isSettled && isIncoming && tx.invoice != null;
    return ListTile(
      onTap: showQr ? () => showInvoiceQrDialog(context, tx.invoice!) : null,
      leading: Container(
        padding: const EdgeInsets.all(8),
        decoration: BoxDecoration(
          color: amountColor.withValues(alpha: 0.12),
          shape: BoxShape.circle,
        ),
        child: AppIcon(
          isIncoming ? 'arrow_down' : 'arrow_up',
          color: amountColor,
          size: 20,
        ),
      ),
      title: Text(
        '${isIncoming ? '+' : '-'}${formatter.format(tx.amountSats)} sats',
        style: TextStyle(fontWeight: FontWeight.w600, color: amountColor),
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
              DateTime.fromMillisecondsSinceEpoch(tx.createdAt * 1000),
            ),
            style: Theme.of(context).textTheme.bodySmall,
          ),
          if (!tx.isSettled)
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const AppIcon('qr', size: 12, color: Colors.orange),
                const SizedBox(width: 3),
                Text(
                  showQr ? 'Pending · tap for QR' : 'Pending',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: Colors.orange.shade700,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
        ],
      ),
    );
  }

  Widget _nwcSettingsTab(
    BuildContext context,
    NwcState nwcState,
    ColorScheme colorScheme,
  ) {
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
                child: const AppIcon(
                  'check',
                  size: AppIconSize.md,
                  color: Colors.white,
                ),
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
        const LightningAddressCard(),
        const SizedBox(height: 16),

        // Other wallets
        const Card(
          child: Column(
            children: [
              LnbitsConnectionTile(),
              Divider(height: 1, indent: 72),
              CashuConnectionTile(),
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
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 48),
            decoration: BoxDecoration(
              color: colorScheme.surfaceContainerHighest.withValues(alpha: 0.4),
            ),
            child: Column(
              children: [
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: colorScheme.primaryContainer,
                    borderRadius: BorderRadius.circular(24),
                  ),
                  child: AppIcon('zap', size: 32, color: colorScheme.primary),
                ),
                const SizedBox(height: 24),
                Text(
                  'Set up your wallet',
                  style: Theme.of(context).textTheme.headlineMedium
                      ?.copyWith(fontWeight: FontWeight.bold),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 12),
                Text(
                  'One tap creates a lightning wallet and an address like',
                  style: Theme.of(context).textTheme.bodyMedium
                      ?.copyWith(color: colorScheme.onSurfaceVariant),
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
                  style: Theme.of(context).textTheme.bodyMedium
                      ?.copyWith(color: colorScheme.onSurfaceVariant),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 32),
                FilledButton.icon(
                  onPressed: () => context.push('/wallet/lnbits'),
                  icon: const AppIcon('wallet', size: AppIconSize.lg),
                  label: const Text('Create my wallet'),
                  style: FilledButton.styleFrom(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 32,
                      vertical: 16,
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                OutlinedButton.icon(
                  onPressed: () => context.push('/wallet/nwc'),
                  icon: const AppIcon('link', size: 18),
                  label: const Text('Connect an external wallet'),
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 24,
                      vertical: 14,
                    ),
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  'Alby · Zeus · Wallet of Satoshi · Mutiny · Phoenix · Breez',
                  style: Theme.of(context).textTheme.bodySmall
                      ?.copyWith(color: colorScheme.onSurfaceVariant),
                  textAlign: TextAlign.center,
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
              child: const AppIcon('gift', color: Colors.teal, size: 24),
            ),
            title: const Text('Cashu Ecash'),
            subtitle: const Text('Hold sats as private ecash instead'),
            trailing: const AppIcon('chevron_r'),
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
              AppIcon('eye_off', size: 48, color: colorScheme.error),
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
            AppIcon('article', size: 48, color: colorScheme.onSurfaceVariant),
            const SizedBox(height: 12),
            Text(
              'No payments yet',
              style: TextStyle(color: colorScheme.onSurfaceVariant),
            ),
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
              child: AppIcon(
                isIncoming ? 'arrow_down' : 'arrow_up',
                color: color,
                size: 18,
              ),
            ),
            title: Text(
              '${isIncoming ? '+' : '-'}${formatter.format(p.amountSats)} sats',
              style: TextStyle(fontWeight: FontWeight.w600, color: color),
            ),
            subtitle: p.memo != null
                ? Text(p.memo!, maxLines: 1, overflow: TextOverflow.ellipsis)
                : null,
            trailing: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                if (p.timestampMs != null)
                  Text(
                    timeago.format(
                      DateTime.fromMillisecondsSinceEpoch(p.timestampMs!),
                    ),
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
    BuildContext context,
    double shrinkOffset,
    bool overlapsContent,
  ) {
    return Container(color: backgroundColor, child: tabBar);
  }

  @override
  bool shouldRebuild(_TabBarDelegate oldDelegate) => false;
}

// ─── Quick-rails (Wallet Hub 2.0) ─────────────────────────────────────

/// One horizontal rail of quick-nav cards ("Earn" / "Creator" / "Trade").
/// Surfaces the money features that otherwise hide in the drawer — a single
/// tap jumps straight to the feature route.
class _QuickRail extends StatelessWidget {
  final String title;
  final List<_RailItem> items;

  const _QuickRail({required this.title, required this.items});

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(2, 0, 2, 8),
          child: Text(
            title.toUpperCase(),
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
              fontWeight: FontWeight.w700,
              color: colorScheme.onSurfaceVariant,
              letterSpacing: 1.2,
            ),
          ),
        ),
        SizedBox(
          height: 92,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: items.length,
            separatorBuilder: (_, _) => const SizedBox(width: 8),
            itemBuilder: (context, i) => _RailCard(item: items[i]),
          ),
        ),
        const SizedBox(height: 14),
      ],
    );
  }
}

class _RailItem {
  final String icon;
  final String label;
  final String sub;
  final String route;
  const _RailItem(this.icon, this.label, this.sub, this.route);
}

class _RailCard extends StatelessWidget {
  final _RailItem item;
  const _RailCard({required this.item});

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return InkWell(
      onTap: () {
        HapticFeedback.lightImpact();
        context.push(item.route);
      },
      borderRadius: AppShapes.radiusMd,
      child: Container(
        width: 112,
        padding: const EdgeInsets.all(11),
        decoration: BoxDecoration(
          color: colorScheme.surfaceContainerLowest,
          border: Border.all(color: colorScheme.outlineVariant, width: 1),
          borderRadius: AppShapes.radiusMd,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 30,
              height: 30,
              decoration: BoxDecoration(
                color: colorScheme.primaryContainer.withValues(alpha: 0.5),
                borderRadius: AppShapes.radiusSm,
              ),
              child: Center(
                child: AppIcon(
                  item.icon,
                  size: AppIconSize.sm,
                  color: colorScheme.primary,
                ),
              ),
            ),
            const Spacer(),
            Text(
              item.label,
              style: Theme.of(context).textTheme.labelLarge
                  ?.copyWith(fontSize: 12, fontWeight: FontWeight.w700),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            Text(
              item.sub,
              style: Theme.of(context).textTheme.bodySmall
                  ?.copyWith(fontSize: 10, color: colorScheme.onSurfaceVariant),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ),
      ),
    );
  }
}
