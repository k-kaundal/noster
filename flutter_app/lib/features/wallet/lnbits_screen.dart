import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/features/wallet/providers/lnbits_providers.dart';
import 'package:nostrfeed_mobile/features/wallet/services/lnbits_service.dart';
import 'package:nostrfeed_mobile/features/wallet/widgets/buy_name_section.dart';
import 'package:nostrfeed_mobile/features/wallet/widgets/current_address_section.dart';
import 'package:nostrfeed_mobile/features/wallet/widgets/existing_wallet_sign_in_dialog.dart';
import 'package:nostrfeed_mobile/features/wallet/widgets/receive_dialog.dart';
import 'package:nostrfeed_mobile/features/wallet/widgets/send_dialog.dart';
import 'package:nostrfeed_mobile/features/wallet/widgets/free_address_section.dart';
import 'package:nostrfeed_mobile/features/wallet/widgets/payments_list.dart';
import 'package:nostrfeed_mobile/features/wallet/widgets/wallet_login_prompt.dart';

/// LNbits wallet screen matching the web WalletPage flow.
///
/// - Not logged in → prompt to log in with Nostr
/// - Logged in, no wallet → "Set up your wallet" create card
/// - Connected → balance, send/receive, account settings tabs
class LnbitsScreen extends ConsumerStatefulWidget {
  const LnbitsScreen({super.key});

  @override
  ConsumerState<LnbitsScreen> createState() => _LnbitsScreenState();
}

class _LnbitsScreenState extends ConsumerState<LnbitsScreen>
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
    final auth = ref.watch(authStateProvider);
    final lnbits = ref.watch(lnbitsAuthProvider);
    final colorScheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Wallet'),
        actions: [
          if (lnbits.isConnected)
            IconButton(
              icon: const Icon(Icons.refresh),
              onPressed: () =>
                  ref.read(lnbitsAuthProvider.notifier).refresh(),
            ),
        ],
      ),
      body: !auth.isLoggedIn
          ? const WalletLoginPrompt()
          : lnbits.isLoading && !lnbits.isConnected
              ? _loadingView(context)
              : !lnbits.isConnected
                  ? _createWalletView(context, colorScheme, lnbits)
                  : _connectedWalletView(context, colorScheme, lnbits),
    );
  }


  // ── Loading ──────────────────────────────────────────────────────────

  Widget _loadingView(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const CircularProgressIndicator(),
          const SizedBox(height: 16),
          Text(
            'Connecting to your wallet…',
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
          ),
        ],
      ),
    );
  }

  // ── Create wallet offer (logged in, no wallet yet) ───────────────────

  Widget _createWalletView(
      BuildContext context, ColorScheme colorScheme, LnbitsAuthState lnbits) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Card(
          clipBehavior: Clip.antiAlias,
          child: Column(
            children: [
              // Header
              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(
                    horizontal: 24, vertical: 48),
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
                      child: Icon(Icons.bolt,
                          size: 32, color: colorScheme.primary),
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

                    // Create button
                    FilledButton.icon(
                      onPressed: lnbits.isLoading
                          ? null
                          : () async {
                              final ok = await ref
                                  .read(lnbitsAuthProvider.notifier)
                                  .connect();
                              if (ok && context.mounted) {
                                ScaffoldMessenger.of(context).showSnackBar(
                                  const SnackBar(
                                      content: Text(
                                          'Your wallet is ready!')),
                                );
                              }
                            },
                      icon: lnbits.isLoading
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(
                                  strokeWidth: 2),
                            )
                          : const Icon(Icons.account_balance_wallet),
                      label: Text(
                        lnbits.isLoading
                            ? 'Connecting…'
                            : 'Create my wallet',
                      ),
                      style: FilledButton.styleFrom(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 32, vertical: 16),
                      ),
                    ),

                    // Error — shown for both new wallet creation failures and
                    // session restore failures (existing users whose wallet
                    // fetch hit a network or server error on app start).
                    if (lnbits.error != null) ...[
                      const SizedBox(height: 24),
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: colorScheme.errorContainer,
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(
                              color: colorScheme.error
                                  .withValues(alpha: 0.3)),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Couldn\'t connect your wallet',
                              style: TextStyle(
                                fontWeight: FontWeight.bold,
                                color: colorScheme.onErrorContainer,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              lnbits.error!,
                              style: TextStyle(
                                fontSize: 12,
                                color: colorScheme.onErrorContainer
                                    .withValues(alpha: 0.8),
                              ),
                            ),
                            const SizedBox(height: 8),
                            TextButton(
                              onPressed: () => ref
                                  .read(lnbitsAuthProvider.notifier)
                                  .refresh(),
                              child: const Text('Retry'),
                            ),
                          ],
                        ),
                      ),
                    ],

                    const SizedBox(height: 24),

                    // Existing wallet sign-in
                    TextButton.icon(
                      onPressed: () => _showExistingWalletDialog(context),
                      icon: const Icon(Icons.login, size: 18),
                      label: const Text('I already have a wallet'),
                    ),

                    // NWC alternative
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

              // Feature details
              Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  children: [
                    _featureDetail(
                      context,
                      icon: Icons.key,
                      title: 'No password',
                      body:
                          'Your Nostr key is the account. Sign once to prove it\'s yours — the key itself never leaves your signer.',
                      colorScheme: colorScheme,
                    ),
                    const SizedBox(height: 16),
                    _featureDetail(
                      context,
                      icon: Icons.bolt,
                      title: 'Receive zaps immediately',
                      body:
                          'Get a lightning address to publish on your profile. Zaps land in your wallet instantly.',
                      colorScheme: colorScheme,
                    ),
                    const SizedBox(height: 16),
                    _featureDetail(
                      context,
                      icon: Icons.shield,
                      title: 'Custodial — keep it small',
                      body:
                          'Balances are held at ln.nostrfeed.com. Treat it like cash in a pocket, not savings.',
                      colorScheme: colorScheme,
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _featureDetail(
    BuildContext context, {
    required IconData icon,
    required String title,
    required String body,
    required ColorScheme colorScheme,
  }) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            color: colorScheme.primaryContainer.withValues(alpha: 0.5),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Icon(icon, size: 16, color: colorScheme.primary),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: const TextStyle(
                  fontWeight: FontWeight.bold,
                  fontSize: 14,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                body,
                style: TextStyle(
                  fontSize: 12,
                  color: colorScheme.onSurfaceVariant,
                  height: 1.4,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  // ── Existing wallet sign-in dialog ───────────────────────────────────

  void _showExistingWalletDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (ctx) => const ExistingWalletSignInDialog(),
    );
  }

  // ── Connected wallet view ────────────────────────────────────────────

  Widget _connectedWalletView(
      BuildContext context, ColorScheme colorScheme, LnbitsAuthState lnbits) {
    final account = lnbits.account!;
    final formatter = NumberFormat('#,###');
    final wallet = account.wallets.isEmpty ? null : account.wallets.first;
    final balance = wallet?.balanceSats ?? 0;

    return NestedScrollView(
      headerSliverBuilder: (context, innerBoxIsScrolled) => [
        SliverToBoxAdapter(
          child: _balanceCard(
              context, colorScheme, lnbits, wallet, balance, formatter),
        ),
        SliverToBoxAdapter(
          child: _actionButtons(context, balance, lnbits),
        ),
        const SliverToBoxAdapter(child: SizedBox(height: 8)),
        SliverPersistentHeader(
          pinned: true,
          delegate: TabBarDelegate(
            TabBar(
              controller: _tabController,
              tabs: const [
                Tab(text: 'Activity'),
                Tab(text: 'Addresses'),
                Tab(text: 'Account'),
              ],
            ),
            colorScheme.surface,
          ),
        ),
      ],
      body: TabBarView(
        controller: _tabController,
        children: [
          _activityTab(context, wallet),
          _addressesTab(context, account),
          _accountTab(context, lnbits),
        ],
      ),
    );
  }

  Widget _balanceCard(
    BuildContext context,
    ColorScheme colorScheme,
    LnbitsAuthState lnbits,
    LnbitsWallet? wallet,
    int balance,
    NumberFormat formatter,
  ) {
    return Container(
      margin: const EdgeInsets.all(16),
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [Colors.blue.shade700, Colors.purple.shade600],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(20),
        boxShadow: [
          BoxShadow(
            color: Colors.blue.shade900.withValues(alpha: 0.3),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
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
                padding:
                    const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
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
          if (lnbits.account?.username != null)
            Text(
              'as ${lnbits.account!.username}',
              style: TextStyle(
                color: Colors.white.withValues(alpha: 0.7),
                fontSize: 13,
              ),
            ),
          const SizedBox(height: 8),
          // Wallet count indicator when multiple wallets exist
          if (lnbits.account != null && lnbits.account!.wallets.length > 1)
            Text(
              '${lnbits.account!.wallets.length} wallets',
              style: TextStyle(
                color: Colors.white.withValues(alpha: 0.5),
                fontSize: 12,
              ),
            ),
        ],
      ),
    );
  }

  Widget _actionButtons(
      BuildContext context, int balance, LnbitsAuthState lnbits) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Row(
        children: [
          Expanded(
            child: FilledButton.icon(
              onPressed: () => showDialog(context: context, builder: (_) => const ReceiveDialog()),
              icon: const Icon(Icons.arrow_downward),
              label: const Text('Receive'),
              style: FilledButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 14),
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: FilledButton.tonalIcon(
              onPressed:
                  balance > 0 ? () => _showSendDialog(context, balance) : null,
              icon: const Icon(Icons.arrow_upward),
              label: const Text('Send'),
              style: FilledButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 14),
              ),
            ),
          ),
        ],
      ),
    );
  }

  // ── Activity tab ─────────────────────────────────────────────────────

  Widget _activityTab(BuildContext context, LnbitsWallet? wallet) {
    if (wallet == null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.account_balance_wallet_outlined,
                size: 48, color: Theme.of(context).colorScheme.onSurfaceVariant),
            const SizedBox(height: 12),
            Text(
              'No wallet on this account yet',
              style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant),
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: () => ref.read(lnbitsAuthProvider.notifier).refresh(),
              child: const Text('Refresh'),
            ),
          ],
        ),
      );
    }

    return PaymentsList(
      key: ValueKey(wallet.id),
      apiKey: wallet.inkey ?? wallet.adminkey ?? '',
    );
  }

  // ── Addresses tab ────────────────────────────────────────────────────

  Widget _addressesTab(BuildContext context, LnbitsUser account) {
    final colorScheme = Theme.of(context).colorScheme;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // 1. Current lightning address (what people can zap at right now)
        const CurrentAddressSection(),
        const SizedBox(height: 16),

        // 2. Free address (assigned from key, always available)
        const FreeAddressSection(),
        const SizedBox(height: 16),

        // 3. Buy a verified name (NIP-05 with domain and price)
        const BuyNameSection(),
        const SizedBox(height: 16),

        // Nostr key link status
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(Icons.fingerprint, color: colorScheme.primary),
                    const SizedBox(width: 8),
                    Text(
                      'Nostr Key',
                      style: Theme.of(context)
                          .textTheme
                          .titleMedium
                          ?.copyWith(fontWeight: FontWeight.bold),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Text(
                  account.pubkey != null
                      ? 'Linked to ${account.pubkey!.substring(0, 16)}…'
                      : 'No Nostr key linked',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                if (account.pubkey == null) ...[
                  const SizedBox(height: 12),
                  OutlinedButton.icon(
                    onPressed: () => _linkPubkey(context),
                    icon: const Icon(Icons.link, size: 18),
                    label: const Text('Link current Nostr key'),
                  ),
                ],
              ],
            ),
          ),
        ),
      ],
    );
  }

  // ── Account tab ──────────────────────────────────────────────────────

  Widget _accountTab(BuildContext context, LnbitsAuthState lnbits) {
    final account = lnbits.account!;
    final colorScheme = Theme.of(context).colorScheme;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // Account info
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(Icons.person, color: colorScheme.primary),
                    const SizedBox(width: 8),
                    Text(
                      'Account',
                      style: Theme.of(context)
                          .textTheme
                          .titleMedium
                          ?.copyWith(fontWeight: FontWeight.bold),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                _infoRow('User ID', account.id),
                _infoRow('Username', account.username ?? 'Not set'),
                _infoRow('Email', account.email ?? 'Not set'),
                _infoRow(
                    'Password', account.hasPassword ? 'Set' : 'Not set'),
                _infoRow('Wallets', '${account.wallets.length}'),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),

        // Edit account
        Card(
          child: Column(
            children: [
              ListTile(
                leading: const Icon(Icons.edit),
                title: const Text('Edit Profile'),
                subtitle: const Text('Username, notifications'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => _showEditProfileDialog(context, account),
              ),
              const Divider(height: 1),
              ListTile(
                leading: const Icon(Icons.lock),
                title: const Text('Set Password'),
                subtitle: Text(account.hasPassword
                    ? 'Change your password'
                    : 'Add a second way to sign in'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => _showSetPasswordDialog(context, account),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),

        // Custodial notice
        Card(
          color: colorScheme.surfaceContainerHighest,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Custodial wallet',
                  style: Theme.of(context).textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                ),
                const SizedBox(height: 8),
                Text(
                  'Balance held at ln.nostrfeed.com'
                  '${account.username != null ? ' as ${account.username}' : ''}. '
                  'Keep only what you plan to spend.',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: colorScheme.onSurfaceVariant,
                        height: 1.4,
                      ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),

        // Disconnect
        OutlinedButton.icon(
          onPressed: () => _confirmDisconnect(context),
          icon: const Icon(Icons.logout),
          label: const Text('Disconnect account'),
          style: OutlinedButton.styleFrom(
            foregroundColor: colorScheme.error,
            side: BorderSide(color: colorScheme.error),
          ),
        ),
      ],
    );
  }

  Widget _infoRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 100,
            child: Text(
              label,
              style: TextStyle(
                fontSize: 13,
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(fontSize: 13),
            ),
          ),
        ],
      ),
    );
  }

  // ── Dialogs ──────────────────────────────────────────────────────────

  void _showSendDialog(BuildContext context, int balanceSats) {
    showDialog(
      context: context,
      builder: (_) => SendDialog(balanceSats: balanceSats),
    );
  }

  void _showEditProfileDialog(BuildContext context, LnbitsUser account) {
    final usernameController =
        TextEditingController(text: account.username ?? '');
    final emailController = TextEditingController(
        text: account.extra?['notifications']?['email_address'] ?? '');
    final telegramController = TextEditingController(
        text: account.extra?['notifications']?['telegram_chat_id'] ??
            '');
    final nostrController = TextEditingController(
        text: account.extra?['notifications']?['nostr_identifier'] ??
            '');
    bool isSaving = false;

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setState) => AlertDialog(
          title: const Text('Edit Profile'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: usernameController,
                  decoration: const InputDecoration(
                    labelText: 'Username',
                    hintText: 'satoshi',
                    prefixIcon: Icon(Icons.person),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: emailController,
                  decoration: const InputDecoration(
                    labelText: 'Notification email',
                    prefixIcon: Icon(Icons.email),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: telegramController,
                  decoration: const InputDecoration(
                    labelText: 'Telegram chat ID',
                    prefixIcon: Icon(Icons.telegram),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: nostrController,
                  decoration: const InputDecoration(
                    labelText: 'Nostr NIP-05 identifier',
                    hintText: 'you@domain.com',
                    prefixIcon: Icon(Icons.alternate_email),
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: isSaving ? null : () => Navigator.pop(ctx),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: isSaving
                  ? null
                  : () async {
                      setState(() => isSaving = true);
                      final ok = await ref
                          .read(lnbitsAuthProvider.notifier)
                          .updateProfile(
                            username: usernameController.text.trim(),
                            email: emailController.text.trim(),
                            telegram: telegramController.text.trim(),
                            nostrIdentifier: nostrController.text.trim(),
                          );
                      if (ok && ctx.mounted) {
                        Navigator.pop(ctx);
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('Account updated')),
                        );
                      } else {
                        setState(() => isSaving = false);
                      }
                    },
              child: const Text('Save'),
            ),
          ],
        ),
      ),
    );
  }

  void _showSetPasswordDialog(BuildContext context, LnbitsUser account) {
    final usernameController =
        TextEditingController(text: account.username ?? '');
    final passwordController = TextEditingController();
    final repeatController = TextEditingController();
    final currentController = TextEditingController();
    bool isSaving = false;
    String? errorMsg;

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setState) => AlertDialog(
          title: Text(account.hasPassword
              ? 'Change Password'
              : 'Set Password'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: usernameController,
                  decoration: const InputDecoration(
                    labelText: 'Username',
                    prefixIcon: Icon(Icons.person),
                  ),
                ),
                const SizedBox(height: 12),
                if (account.hasPassword) ...[
                  TextField(
                    controller: currentController,
                    decoration: const InputDecoration(
                      labelText: 'Current password',
                      prefixIcon: Icon(Icons.lock_open),
                    ),
                    obscureText: true,
                  ),
                  const SizedBox(height: 12),
                ],
                TextField(
                  controller: passwordController,
                  decoration: const InputDecoration(
                    labelText: 'New password',
                    prefixIcon: Icon(Icons.lock),
                  ),
                  obscureText: true,
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: repeatController,
                  decoration: const InputDecoration(
                    labelText: 'Repeat password',
                    prefixIcon: Icon(Icons.lock_outline),
                  ),
                  obscureText: true,
                ),
                if (errorMsg != null) ...[
                  const SizedBox(height: 12),
                  Text(errorMsg!,
                      style: TextStyle(
                          color: Theme.of(ctx).colorScheme.error,
                          fontSize: 12)),
                ],
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: isSaving ? null : () => Navigator.pop(ctx),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: isSaving
                  ? null
                  : () async {
                      if (passwordController.text !=
                          repeatController.text) {
                        setState(() =>
                            errorMsg = 'Passwords do not match');
                        return;
                      }
                      setState(() {
                        isSaving = true;
                        errorMsg = null;
                      });
                      final ok = await ref
                          .read(lnbitsAuthProvider.notifier)
                          .setPassword(
                            username: usernameController.text.trim(),
                            password: passwordController.text,
                            passwordRepeat: repeatController.text,
                            currentPassword:
                                currentController.text.isEmpty
                                    ? null
                                    : currentController.text,
                          );
                      if (ok && ctx.mounted) {
                        Navigator.pop(ctx);
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('Password set')),
                        );
                      } else {
                        setState(() {
                          isSaving = false;
                          errorMsg =
                              ref.read(lnbitsAuthProvider).error;
                        });
                      }
                    },
              child: const Text('Save'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _linkPubkey(BuildContext context) async {
    final auth = ref.read(authStateProvider);
    if (auth.pubkey == null) return;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Link Nostr Key'),
        content: Text(
            'Link this wallet to your current Nostr key (${auth.pubkey!.substring(0, 16)}…)?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Link'),
          ),
        ],
      ),
    );

    if (confirmed == true && mounted) {
      final ok = await ref
          .read(lnbitsAuthProvider.notifier)
          .linkPubkey(auth.pubkey!);
      if (ok && context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Nostr key linked')),
        );
      }
    }
  }

  void _confirmDisconnect(BuildContext context) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Disconnect Wallet'),
        content: const Text(
            'Remove the session token and sign out of your wallet? '
            'You can sign back in with your Nostr key anytime.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(context).colorScheme.error,
            ),
            onPressed: () async {
              await ref.read(lnbitsAuthProvider.notifier).logout();
              if (ctx.mounted) Navigator.pop(ctx);
            },
            child: const Text('Disconnect'),
          ),
        ],
      ),
    );
  }
}
