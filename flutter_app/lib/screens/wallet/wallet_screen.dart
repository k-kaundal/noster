import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:timeago/timeago.dart' as timeago;
import 'package:intl/intl.dart';

import '../../providers/app_providers.dart';
import '../../services/auth_service.dart';

/// Lightning wallet screen with balance, send/receive/zap actions, and
/// transaction history. Currently uses placeholder data for UI demo.
class WalletScreen extends ConsumerStatefulWidget {
  const WalletScreen({super.key});

  @override
  ConsumerState<WalletScreen> createState() => _WalletScreenState();
}

class _WalletScreenState extends ConsumerState<WalletScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabController;

  // Placeholder balance
  static const _balanceSats = 125430;

  // Placeholder transactions
  static final _transactions = <WalletTransaction>[
    WalletTransaction(
      id: 'tx1',
      amount: 5000,
      type: 'receive',
      memo: 'Zap from @alice',
      timestamp: DateTime.now().subtract(const Duration(hours: 2)),
    ),
    WalletTransaction(
      id: 'tx2',
      amount: 2100,
      type: 'zap',
      memo: 'Zapped post by @bob',
      timestamp: DateTime.now().subtract(const Duration(hours: 5)),
    ),
    WalletTransaction(
      id: 'tx3',
      amount: 10000,
      type: 'send',
      memo: 'Payment to merchant',
      timestamp: DateTime.now().subtract(const Duration(days: 1)),
    ),
    WalletTransaction(
      id: 'tx4',
      amount: 500,
      type: 'receive',
      memo: 'Split payment',
      timestamp: DateTime.now().subtract(const Duration(days: 2)),
    ),
    WalletTransaction(
      id: 'tx5',
      amount: 21000,
      type: 'zap',
      memo: 'Zapped article by @carol',
      timestamp: DateTime.now().subtract(const Duration(days: 3)),
    ),
    WalletTransaction(
      id: 'tx6',
      amount: 1000,
      type: 'send',
      memo: 'Coffee',
      timestamp: DateTime.now().subtract(const Duration(days: 4)),
    ),
  ];

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
    final colorScheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Wallet'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: 'Refresh',
            onPressed: () {},
          ),
        ],
      ),
      body: NestedScrollView(
        headerSliverBuilder: (context, innerBoxIsScrolled) => [
          SliverToBoxAdapter(child: _balanceCard(context)),
          SliverToBoxAdapter(child: _actionButtons(context)),
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
            _transactionList(_transactions),
            _transactionList(
                _transactions.where((t) => t.type == 'zap').toList()),
            _walletSettings(context, auth),
          ],
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Balance card
  // ---------------------------------------------------------------------------

  Widget _balanceCard(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final formatter = NumberFormat('#,###');

    return Container(
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
              Icon(Icons.bolt, color: Colors.white.withValues(alpha: 0.9), size: 20),
              const SizedBox(width: 6),
              Text(
                'Lightning Balance',
                style: TextStyle(
                  color: Colors.white.withValues(alpha: 0.9),
                  fontSize: 14,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            '${formatter.format(_balanceSats)} sats',
            style: const TextStyle(
              color: Colors.white,
              fontSize: 36,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            '≈ \$${(_balanceSats * 0.0004).toStringAsFixed(2)} USD',
            style: TextStyle(
              color: Colors.white.withValues(alpha: 0.75),
              fontSize: 14,
            ),
          ),
        ],
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Action buttons
  // ---------------------------------------------------------------------------

  Widget _actionButtons(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
        children: [
          _actionButton(
            context,
            icon: Icons.arrow_upward,
            label: 'Send',
            onTap: () => _showSendDialog(context),
          ),
          _actionButton(
            context,
            icon: Icons.arrow_downward,
            label: 'Receive',
            onTap: () => _showReceiveDialog(context),
          ),
          _actionButton(
            context,
            icon: Icons.bolt,
            label: 'Zap',
            onTap: () => _showZapDialog(context),
          ),
        ],
      ),
    );
  }

  Widget _actionButton(BuildContext context,
      {required IconData icon,
      required String label,
      required VoidCallback onTap}) {
    final colorScheme = Theme.of(context).colorScheme;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: colorScheme.primaryContainer,
                shape: BoxShape.circle,
              ),
              child:
                  Icon(icon, color: colorScheme.onPrimaryContainer, size: 24),
            ),
            const SizedBox(height: 6),
            Text(label, style: Theme.of(context).textTheme.labelMedium),
          ],
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Transaction list
  // ---------------------------------------------------------------------------

  Widget _transactionList(List<WalletTransaction> txs) {
    if (txs.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.receipt_long,
                size: 48,
                color: Theme.of(context).colorScheme.onSurfaceVariant),
            const SizedBox(height: 12),
            Text(
              'No transactions yet',
              style: TextStyle(
                  color: Theme.of(context).colorScheme.onSurfaceVariant),
            ),
          ],
        ),
      );
    }
    return ListView.separated(
      padding: const EdgeInsets.symmetric(vertical: 4),
      itemCount: txs.length,
      separatorBuilder: (_, _) => const Divider(indent: 72),
      itemBuilder: (context, index) => _transactionTile(context, txs[index]),
    );
  }

  Widget _transactionTile(BuildContext context, WalletTransaction tx) {
    final colorScheme = Theme.of(context).colorScheme;
    final isIncoming = tx.type == 'receive' || tx.type == 'zap';
    final formatter = NumberFormat('#,###');

    IconData icon;
    Color iconColor;
    switch (tx.type) {
      case 'send':
        icon = Icons.arrow_upward;
        iconColor = colorScheme.error;
        break;
      case 'receive':
        icon = Icons.arrow_downward;
        iconColor = Colors.green;
        break;
      case 'zap':
        icon = Icons.bolt;
        iconColor = Colors.amber.shade700;
        break;
      default:
        icon = Icons.swap_horiz;
        iconColor = colorScheme.onSurfaceVariant;
    }

    return ListTile(
      leading: Container(
        padding: const EdgeInsets.all(8),
        decoration: BoxDecoration(
          color: iconColor.withValues(alpha: 0.12),
          shape: BoxShape.circle,
        ),
        child: Icon(icon, color: iconColor, size: 20),
      ),
      title: Text(
        '${isIncoming ? '+' : '-'}${formatter.format(tx.amount)} sats',
        style: TextStyle(
          fontWeight: FontWeight.w600,
          color: isIncoming ? Colors.green : colorScheme.error,
        ),
      ),
      subtitle: tx.memo != null
          ? Text(tx.memo!, maxLines: 1, overflow: TextOverflow.ellipsis)
          : null,
      trailing: Text(
        timeago.format(tx.timestamp),
        style: Theme.of(context).textTheme.bodySmall,
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Wallet settings tab
  // ---------------------------------------------------------------------------

  Widget _walletSettings(BuildContext context, AuthState auth) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        ListTile(
          leading: const Icon(Icons.link),
          title: const Text('Lightning Address'),
          subtitle: Text(auth.profile?.lud16 ?? 'Not set'),
          trailing: IconButton(
            icon: const Icon(Icons.copy, size: 20),
            onPressed: auth.profile?.lud16 != null
                ? () {
                    Clipboard.setData(
                        ClipboardData(text: auth.profile!.lud16!));
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                          content: Text('Lightning address copied')),
                    );
                  }
                : null,
          ),
        ),
        const Divider(),
        ListTile(
          leading: const Icon(Icons.account_balance_wallet),
          title: const Text('Connect NWC Wallet'),
          subtitle: const Text('Nostr Wallet Connect'),
          trailing: const Icon(Icons.chevron_right),
          onTap: () {},
        ),
        ListTile(
          leading: const Icon(Icons.bolt),
          title: const Text('WebLN'),
          subtitle: const Text('Browser wallet'),
          trailing: Switch(value: false, onChanged: (_) {}),
        ),
        const Divider(),
        ListTile(
          leading: const Icon(Icons.history),
          title: const Text('Export Transaction History'),
          trailing: const Icon(Icons.chevron_right),
          onTap: () {},
        ),
      ],
    );
  }

  // ---------------------------------------------------------------------------
  // Dialogs
  // ---------------------------------------------------------------------------

  void _showSendDialog(BuildContext context) {
    final invoiceController = TextEditingController();
    final amountController = TextEditingController();

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Send Payment'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: invoiceController,
              decoration: const InputDecoration(
                labelText: 'Invoice / Lightning Address',
                hintText: 'lnbc… or user@domain.com',
                prefixIcon: Icon(Icons.bolt),
              ),
              maxLines: 2,
              minLines: 1,
            ),
            const SizedBox(height: 16),
            TextField(
              controller: amountController,
              decoration: const InputDecoration(
                labelText: 'Amount (sats)',
                hintText: '0',
                prefixIcon: Icon(Icons.currency_bitcoin),
              ),
              keyboardType: TextInputType.number,
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          FilledButton.icon(
            onPressed: () {
              Navigator.pop(ctx);
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Payment sent (demo)')),
              );
            },
            icon: const Icon(Icons.send),
            label: const Text('Send'),
          ),
        ],
      ),
    );
  }

  void _showReceiveDialog(BuildContext context) {
    final auth = ref.read(authStateProvider);
    final lightningAddress =
        auth.profile?.lud16 ?? 'user@walletofsatoshi.com';

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Receive Payment'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(12),
              ),
              child: QrImageView(
                data: 'lightning:$lightningAddress',
                version: QrVersions.auto,
                size: 200,
                backgroundColor: Colors.white,
              ),
            ),
            const SizedBox(height: 16),
            Text(
              lightningAddress,
              style: Theme.of(ctx).textTheme.bodyMedium,
              textAlign: TextAlign.center,
            ),
          ],
        ),
        actions: [
          TextButton.icon(
            onPressed: () {
              Clipboard.setData(ClipboardData(text: lightningAddress));
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Address copied')),
              );
            },
            icon: const Icon(Icons.copy),
            label: const Text('Copy'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Done'),
          ),
        ],
      ),
    );
  }

  void _showZapDialog(BuildContext context) {
    final amountController = TextEditingController();
    final messageController = TextEditingController();

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Row(
          children: [
            Icon(Icons.bolt, color: Colors.amber),
            SizedBox(width: 8),
            Text('Send Zap'),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: amountController,
              decoration: const InputDecoration(
                labelText: 'Amount (sats)',
                hintText: '21',
                prefixIcon: Icon(Icons.currency_bitcoin),
              ),
              keyboardType: TextInputType.number,
            ),
            const SizedBox(height: 16),
            TextField(
              controller: messageController,
              decoration: const InputDecoration(
                labelText: 'Message (optional)',
                hintText: 'Great post!',
                prefixIcon: Icon(Icons.message),
              ),
              maxLines: 2,
              minLines: 1,
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          FilledButton.icon(
            onPressed: () {
              Navigator.pop(ctx);
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Zap sent! (demo)')),
              );
            },
            icon: const Icon(Icons.bolt),
            label: const Text('Zap'),
          ),
        ],
      ),
    );
  }
}

/// Delegate to pin the TabBar below the balance card.
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

/// A single Lightning wallet transaction.
class WalletTransaction {
  final String id;
  final int amount; // in sats
  final String type; // 'send', 'receive', 'zap'
  final String? memo;
  final DateTime timestamp;
  final String? peerPubkey;
  const WalletTransaction({
    required this.id,
    required this.amount,
    required this.type,
    this.memo,
    required this.timestamp,
    this.peerPubkey,
  });
}
