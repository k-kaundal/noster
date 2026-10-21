import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:timeago/timeago.dart' as timeago;
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/widgets/empty_state.dart';

class SatsDropsScreen extends ConsumerStatefulWidget {
  const SatsDropsScreen({super.key});

  @override
  ConsumerState<SatsDropsScreen> createState() => _SatsDropsScreenState();
}

class _SatsDropsScreenState extends ConsumerState<SatsDropsScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authStateProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Sats Drops'),
        bottom: TabBar(
          controller: _tabController,
          tabs: const [
            Tab(text: 'Active Drops'),
            Tab(text: 'Claim History'),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          _ActiveDropsTab(isLoggedIn: auth.isLoggedIn),
          const _ClaimHistoryTab(),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _showCreateDropSheet(context),
        icon: const Icon(Icons.water_drop),
        label: const Text('New Drop'),
      ),
    );
  }

  void _showCreateDropSheet(BuildContext context) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (context) => const _CreateDropSheet(),
    );
  }
}

class _ActiveDropsTab extends StatelessWidget {
  final bool isLoggedIn;
  const _ActiveDropsTab({required this.isLoggedIn});

  // Sample drops for UI preview
  static const _sampleDrops = [
    _Drop(id: '1', amount: 1000, claimed: 12, total: 50, label: 'Nostr Meetup'),
    _Drop(id: '2', amount: 500, claimed: 8, total: 20, label: 'Podcast Bonus'),
  ];

  @override
  Widget build(BuildContext context) {
    if (_sampleDrops.isEmpty) {
      return const EmptyState(
        icon: Icons.water_drop_outlined,
        title: 'No active drops',
        subtitle: 'Create a drop to share sats via QR code.',
      );
    }

    return ListView.separated(
      padding: const EdgeInsets.all(16),
      itemCount: _sampleDrops.length,
      separatorBuilder: (_, _) => const SizedBox(height: 12),
      itemBuilder: (context, i) => _DropCard(drop: _sampleDrops[i]),
    );
  }
}

class _Drop {
  final String id;
  final int amount;
  final int claimed;
  final int total;
  final String label;
  const _Drop({
    required this.id,
    required this.amount,
    required this.claimed,
    required this.total,
    required this.label,
  });
}

class _DropCard extends StatelessWidget {
  final _Drop drop;
  const _DropCard({required this.drop});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final progress = drop.claimed / drop.total;

    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            // QR placeholder
            Container(
              width: 72,
              height: 72,
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: scheme.outlineVariant),
              ),
              child: QrImageView(
                data: 'LNURL1DP68GURN8GHJ7MRWW4EXCTNDD93K2EM0W4HK6ANPV5SK6CTYDSYXXCT8D3SK2CT9V5SK2CTYDSYXXCTYDSYXXCT8D3SK2CT9V5SK2CT8DSYXXCTYDSYXXCT8D3SK2CT9V5SK2CTYDSYXXCTYDSYXXCT8D3SK2CT9V5SK2CT8DSYXX',
                size: 64,
                padding: const EdgeInsets.all(4),
              ),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    drop.label,
                    style: const TextStyle(
                        fontWeight: FontWeight.bold, fontSize: 14),
                  ),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      Icon(Icons.bolt, size: 14, color: scheme.primary),
                      Text(
                        '${drop.amount} sats each',
                        style: TextStyle(
                            fontSize: 13,
                            color: scheme.primary,
                            fontWeight: FontWeight.w600),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  LinearProgressIndicator(
                    value: progress,
                    backgroundColor: scheme.surfaceContainerHighest,
                    color: scheme.primary,
                    borderRadius: BorderRadius.circular(4),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '${drop.claimed}/${drop.total} claimed',
                    style: TextStyle(
                        fontSize: 11, color: scheme.onSurfaceVariant),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 10),
            IconButton(
              icon: const Icon(Icons.share),
              onPressed: () {},
              tooltip: 'Share drop',
            ),
          ],
        ),
      ),
    );
  }
}

class _ClaimHistoryTab extends StatelessWidget {
  const _ClaimHistoryTab();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final now = DateTime.now();

    // Sample history
    final history = [
      (label: 'Nostr Meetup Drop', amount: 1000, time: now.subtract(const Duration(hours: 3))),
      (label: 'Podcast Bonus', amount: 500, time: now.subtract(const Duration(days: 1))),
      (label: 'Conference Swag', amount: 2100, time: now.subtract(const Duration(days: 5))),
    ];

    if (history.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.history, size: 56, color: scheme.primary),
            const SizedBox(height: 12),
            Text('No claims yet',
                style: Theme.of(context).textTheme.titleMedium),
          ],
        ),
      );
    }

    return ListView.separated(
      padding: const EdgeInsets.all(16),
      itemCount: history.length,
      separatorBuilder: (_, _) => const Divider(height: 1),
      itemBuilder: (context, i) {
        final item = history[i];
        return ListTile(
          leading: CircleAvatar(
            backgroundColor: scheme.primaryContainer,
            child: Icon(Icons.water_drop,
                color: scheme.onPrimaryContainer, size: 18),
          ),
          title: Text(item.label,
              style:
                  const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
          subtitle: Text(timeago.format(item.time),
              style: const TextStyle(fontSize: 12)),
          trailing: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.bolt, size: 14, color: scheme.primary),
              Text(
                '${item.amount}',
                style: TextStyle(
                    fontWeight: FontWeight.bold, color: scheme.primary),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _CreateDropSheet extends StatefulWidget {
  const _CreateDropSheet();

  @override
  State<_CreateDropSheet> createState() => _CreateDropSheetState();
}

class _CreateDropSheetState extends State<_CreateDropSheet> {
  final _labelCtrl = TextEditingController();
  final _amountCtrl = TextEditingController();
  final _countCtrl = TextEditingController();

  @override
  void dispose() {
    _labelCtrl.dispose();
    _amountCtrl.dispose();
    _countCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 8,
        bottom: MediaQuery.of(context).viewInsets.bottom + 20,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Create Sats Drop',
              style: Theme.of(context)
                  .textTheme
                  .titleLarge
                  ?.copyWith(fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          TextField(
            controller: _labelCtrl,
            decoration: const InputDecoration(
                labelText: 'Label', hintText: 'e.g. Conference Giveaway'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _amountCtrl,
            decoration: const InputDecoration(
                labelText: 'Amount per claim (sats)', hintText: 'e.g. 1000'),
            keyboardType: TextInputType.number,
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _countCtrl,
            decoration: const InputDecoration(
                labelText: 'Number of claims', hintText: 'e.g. 50'),
            keyboardType: TextInputType.number,
          ),
          const SizedBox(height: 20),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: () => Navigator.pop(context),
              icon: const Icon(Icons.qr_code),
              label: const Text('Generate Drop QR'),
            ),
          ),
        ],
      ),
    );
  }
}

