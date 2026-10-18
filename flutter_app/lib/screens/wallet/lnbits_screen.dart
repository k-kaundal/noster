import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:timeago/timeago.dart' as timeago;

import '../../providers/app_providers.dart';
import '../../providers/lnbits_providers.dart';
import '../../services/lnbits_service.dart';

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
          ? _loginPrompt(context, colorScheme)
          : lnbits.isLoading
              ? _loadingView(context)
              : !lnbits.isConnected
                  ? _createWalletView(context, colorScheme, lnbits)
                  : _connectedWalletView(context, colorScheme, lnbits),
    );
  }

  // ── Not logged in ────────────────────────────────────────────────────

  Widget _loginPrompt(BuildContext context, ColorScheme colorScheme) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding: const EdgeInsets.all(24),
              decoration: BoxDecoration(
                color: colorScheme.primaryContainer.withValues(alpha: 0.4),
                shape: BoxShape.circle,
              ),
              child: Icon(Icons.account_balance_wallet_outlined,
                  size: 64, color: colorScheme.primary),
            ),
            const SizedBox(height: 24),
            Text(
              'Log in to open your wallet',
              style: Theme.of(context).textTheme.titleLarge?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 12),
            Text(
              'Your wallet belongs to your Nostr key, so it follows you '
              'to any device you sign in on.',
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: colorScheme.onSurfaceVariant,
                  ),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }

  // ── Loading ──────────────────────────────────────────────────────────

  Widget _loadingView(BuildContext context) {
    return const Center(child: CircularProgressIndicator());
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

                    // Error
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
                              'Couldn\'t create your wallet',
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
                      onPressed: () =>
                          Navigator.pushNamed(context, '/wallet/nwc'),
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
      builder: (ctx) => _ExistingWalletSignInDialog(),
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
          delegate: _TabBarDelegate(
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
              onPressed: () => _showReceiveDialog(context),
              icon: const Icon(Icons.arrow_downward),
              label: const Text('Receive'),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: FilledButton.tonalIcon(
              onPressed:
                  balance > 0 ? () => _showSendDialog(context) : null,
              icon: const Icon(Icons.arrow_upward),
              label: const Text('Send'),
            ),
          ),
        ],
      ),
    );
  }

  // ── Activity tab ─────────────────────────────────────────────────────

  Widget _activityTab(BuildContext context, LnbitsWallet? wallet) {
    if (wallet == null) {
      return const Center(child: Text('No wallet on account'));
    }

    return _PaymentsList(
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
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(Icons.alternate_email,
                        color: colorScheme.primary),
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
                Text(
                  'Publish this on your Nostr profile so people can zap you.',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: colorScheme.onSurfaceVariant,
                      ),
                ),
                const SizedBox(height: 16),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: colorScheme.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          account.username != null
                              ? '${account.username}@ln.nostrfeed.com'
                              : 'Set a username first',
                          style: const TextStyle(
                            fontFamily: 'monospace',
                            fontSize: 14,
                          ),
                        ),
                      ),
                      if (account.username != null)
                        IconButton(
                          icon: const Icon(Icons.copy, size: 18),
                          onPressed: () {
                            Clipboard.setData(ClipboardData(
                                text:
                                    '${account.username}@ln.nostrfeed.com'));
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(
                                  content: Text('Address copied')),
                            );
                          },
                        ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
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

  void _showReceiveDialog(BuildContext context) {
    final amountController = TextEditingController();
    final memoController = TextEditingController();
    String? invoice;
    bool isWorking = false;
    String? errorMsg;

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setState) => AlertDialog(
          title: const Text('Receive Payment'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (invoice == null) ...[
                  TextField(
                    controller: amountController,
                    decoration: const InputDecoration(
                      labelText: 'Amount (sats)',
                      hintText: '0',
                      prefixIcon: Icon(Icons.currency_bitcoin),
                    ),
                    keyboardType: TextInputType.number,
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: memoController,
                    decoration: const InputDecoration(
                      labelText: 'Memo (optional)',
                      prefixIcon: Icon(Icons.description),
                    ),
                  ),
                ] else ...[
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: QrImageView(
                      data: invoice!.toUpperCase(),
                      size: 200,
                      backgroundColor: Colors.white,
                    ),
                  ),
                  const SizedBox(height: 12),
                  SelectableText(
                    invoice!,
                    style: Theme.of(ctx).textTheme.bodySmall,
                    maxLines: 3,
                  ),
                ],
                if (errorMsg != null) ...[
                  const SizedBox(height: 12),
                  Text(errorMsg!,
                      style: TextStyle(
                          color: Theme.of(ctx).colorScheme.error,
                          fontSize: 12),
                      textAlign: TextAlign.center),
                ],
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: isWorking ? null : () => Navigator.pop(ctx),
              child: Text(invoice == null ? 'Cancel' : 'Close'),
            ),
            if (invoice == null)
              FilledButton.icon(
                onPressed: isWorking
                    ? null
                    : () async {
                        final amount =
                            int.tryParse(amountController.text.trim());
                        if (amount == null || amount <= 0) return;
                        setState(() {
                          isWorking = true;
                          errorMsg = null;
                        });
                        try {
                          final wallet = ref
                              .read(lnbitsAuthProvider)
                              .account
                              ?.wallets
                              .first;
                          if (wallet?.inkey == null) {
                            throw const LnbitsException(
                                'No invoice key available', 0);
                          }
                          final service = LnbitsService();
                          final inv = await service.createInvoice(
                            apiKey: wallet!.inkey!,
                            amountSats: amount,
                            memo: memoController.text.trim().isEmpty
                                ? null
                                : memoController.text.trim(),
                          );
                          setState(() {
                            invoice = inv.bolt11;
                            isWorking = false;
                          });
                        } catch (e) {
                          setState(() {
                            isWorking = false;
                            errorMsg = e.toString();
                          });
                        }
                      },
                icon: isWorking
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.add),
                label: const Text('Create Invoice'),
              )
            else
              TextButton.icon(
                onPressed: () {
                  Clipboard.setData(ClipboardData(text: invoice!));
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Invoice copied')),
                  );
                },
                icon: const Icon(Icons.copy),
                label: const Text('Copy'),
              ),
          ],
        ),
      ),
    );
  }

  void _showSendDialog(BuildContext context) {
    final invoiceController = TextEditingController();
    bool isSending = false;
    String? errorMsg;

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setState) => AlertDialog(
          title: const Text('Send Payment'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: invoiceController,
                decoration: const InputDecoration(
                  labelText: 'BOLT11 Invoice',
                  hintText: 'lnbc…',
                  prefixIcon: Icon(Icons.bolt),
                ),
                maxLines: 3,
                minLines: 1,
              ),
              if (errorMsg != null) ...[
                const SizedBox(height: 12),
                Text(errorMsg!,
                    style: TextStyle(
                        color: Theme.of(ctx).colorScheme.error,
                        fontSize: 12),
                    textAlign: TextAlign.center),
              ],
            ],
          ),
          actions: [
            TextButton(
              onPressed: isSending ? null : () => Navigator.pop(ctx),
              child: const Text('Cancel'),
            ),
            FilledButton.icon(
              onPressed: isSending
                  ? null
                  : () async {
                      final invoice = invoiceController.text.trim();
                      if (invoice.isEmpty) return;
                      setState(() {
                        isSending = true;
                        errorMsg = null;
                      });
                      try {
                        final wallet = ref
                            .read(lnbitsAuthProvider)
                            .account
                            ?.wallets
                            .first;
                        if (wallet?.adminkey == null) {
                          throw const LnbitsException(
                              'Admin key required to send', 0);
                        }
                        final service = LnbitsService();
                        await service.payInvoice(
                          apiKey: wallet!.adminkey!,
                          bolt11: invoice,
                        );
                        if (ctx.mounted) Navigator.pop(ctx);
                        if (mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                                content: Text('Payment sent')),
                          );
                        }
                        // Refresh balance
                        ref.read(lnbitsAuthProvider.notifier).refresh();
                      } catch (e) {
                        setState(() {
                          isSending = false;
                          errorMsg = e.toString();
                        });
                      }
                    },
              icon: isSending
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.send),
              label: const Text('Send'),
            ),
          ],
        ),
      ),
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
      if (ok && mounted) {
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

// ── Existing wallet sign-in dialog ───────────────────────────────────────

class _ExistingWalletSignInDialog extends ConsumerStatefulWidget {
  @override
  ConsumerState<_ExistingWalletSignInDialog> createState() =>
      _ExistingWalletSignInDialogState();
}

class _ExistingWalletSignInDialogState
    extends ConsumerState<_ExistingWalletSignInDialog>
    with SingleTickerProviderStateMixin {
  late final TabController _tabController;
  final _linkController = TextEditingController();
  final _usernameController = TextEditingController();
  final _passwordController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    _linkController.dispose();
    _usernameController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final lnbits = ref.watch(lnbitsAuthProvider);

    return AlertDialog(
      title: const Text('Sign in to your wallet'),
      content: SizedBox(
        width: double.maxFinite,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'This opens whichever account the details belong to. If it '
              'isn\'t linked to the Nostr key you\'re signed in with, '
              'the wallet page will say so and offer to link them.',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color:
                        Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
            ),
            const SizedBox(height: 16),
            TabBar(
              controller: _tabController,
              tabs: const [
                Tab(text: 'Wallet link'),
                Tab(text: 'Password'),
              ],
            ),
            SizedBox(
              height: 200,
              child: TabBarView(
                controller: _tabController,
                children: [
                  // Wallet link tab
                  Padding(
                    padding: const EdgeInsets.only(top: 16),
                    child: Column(
                      children: [
                        TextField(
                          controller: _linkController,
                          decoration: const InputDecoration(
                            labelText: 'Your wallet address',
                            hintText: 'https://…/wallet?usr=…',
                            prefixIcon: Icon(Icons.link),
                          ),
                          maxLines: 2,
                          minLines: 1,
                        ),
                        const SizedBox(height: 8),
                        Text(
                          'Paste the whole address. Only the account id '
                          'inside it is used, and it never leaves this device.',
                          style:
                              Theme.of(context).textTheme.bodySmall?.copyWith(
                                    color: Theme.of(context)
                                        .colorScheme
                                        .onSurfaceVariant,
                                  ),
                        ),
                        const SizedBox(height: 16),
                        SizedBox(
                          width: double.infinity,
                          child: FilledButton.icon(
                            onPressed: lnbits.isLoading
                                ? null
                                : () async {
                                    final ok = await ref
                                        .read(lnbitsAuthProvider
                                            .notifier)
                                        .connectWithLink(
                                            _linkController.text.trim());
                                    if (ok && context.mounted) {
                                      Navigator.pop(context);
                                    }
                                  },
                            icon: lnbits.isLoading
                                ? const SizedBox(
                                    width: 18,
                                    height: 18,
                                    child: CircularProgressIndicator(
                                        strokeWidth: 2),
                                  )
                                : const Icon(Icons.link),
                            label: const Text('Sign in'),
                          ),
                        ),
                      ],
                    ),
                  ),

                  // Password tab
                  Padding(
                    padding: const EdgeInsets.only(top: 16),
                    child: Column(
                      children: [
                        TextField(
                          controller: _usernameController,
                          decoration: const InputDecoration(
                            labelText: 'Username',
                            hintText: 'satoshi',
                            prefixIcon: Icon(Icons.person),
                          ),
                        ),
                        const SizedBox(height: 12),
                        TextField(
                          controller: _passwordController,
                          decoration: const InputDecoration(
                            labelText: 'Password',
                            prefixIcon: Icon(Icons.lock),
                          ),
                          obscureText: true,
                        ),
                        const SizedBox(height: 16),
                        SizedBox(
                          width: double.infinity,
                          child: FilledButton.icon(
                            onPressed: lnbits.isLoading
                                ? null
                                : () async {
                                    final ok = await ref
                                        .read(lnbitsAuthProvider
                                            .notifier)
                                        .connectWithPassword(
                                          username:
                                              _usernameController.text
                                                  .trim(),
                                          password:
                                              _passwordController.text,
                                        );
                                    if (ok && context.mounted) {
                                      Navigator.pop(context);
                                    }
                                  },
                            icon: lnbits.isLoading
                                ? const SizedBox(
                                    width: 18,
                                    height: 18,
                                    child: CircularProgressIndicator(
                                        strokeWidth: 2),
                                  )
                                : const Icon(Icons.key),
                            label: const Text('Sign in'),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
      ],
    );
  }
}

// ── Payments list ────────────────────────────────────────────────────────

class _PaymentsList extends ConsumerStatefulWidget {
  final String apiKey;

  const _PaymentsList({super.key, required this.apiKey});

  @override
  ConsumerState<_PaymentsList> createState() => _PaymentsListState();
}

class _PaymentsListState extends ConsumerState<_PaymentsList> {
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
              Icon(Icons.error_outline,
                  size: 48, color: colorScheme.error),
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
