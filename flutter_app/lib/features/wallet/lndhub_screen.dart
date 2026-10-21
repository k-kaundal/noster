import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/core/widgets/detail_scaffold.dart';
import 'package:nostrfeed_mobile/core/widgets/qr_scan_sheet.dart';
import 'package:nostrfeed_mobile/features/wallet/providers/lndhub_providers.dart';

/// LndHub wallet: connect by scanning a `lndhub://` QR (the BlueWallet /
/// Zeus / Alby / Umbrel / BTCPay "connect wallet" code), see the balance,
/// and use it for payments through the shared pay flow.
class LndHubScreen extends ConsumerWidget {
  const LndHubScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final hub = ref.watch(lndHubProvider);
    final scheme = Theme.of(context).colorScheme;
    final formatter = NumberFormat('#,###');

    return DetailScaffold(
      title: 'LndHub Wallet',
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (hub.isConnected) ...[
            // Connected state
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [Colors.blue.shade800, Colors.indigo.shade600],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(18),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Icon(Icons.hub_rounded,
                          color: Colors.white, size: 20),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          hub.credentials!.host.replaceFirst('https://', ''),
                          style: TextStyle(
                            color: Colors.white.withValues(alpha: 0.8),
                            fontSize: 12,
                            fontFamily: 'monospace',
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  Text(
                    hub.balanceSats != null
                        ? '${formatter.format(hub.balanceSats)} sats'
                        : '…',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 32,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () =>
                        ref.read(lndHubProvider.notifier).refresh(),
                    icon: const Icon(Icons.refresh_rounded, size: 18),
                    label: const Text('Refresh'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: FilledButton.tonalIcon(
                    onPressed: () => _confirmDisconnect(context, ref),
                    icon: const Icon(Icons.link_off_rounded, size: 18),
                    label: const Text('Disconnect'),
                  ),
                ),
              ],
            ),
            if (hub.error != null) ...[
              const SizedBox(height: 12),
              Text(
                hub.error!,
                style: TextStyle(color: scheme.error, fontSize: 12),
              ),
            ],
            const SizedBox(height: 20),
            Text(
              'This wallet pays through the normal Send flow — it is offered '
              'after LNbits, NWC and Cashu when you pay an invoice.',
              style: TextStyle(
                fontSize: 12,
                color: scheme.onSurfaceVariant,
                height: 1.4,
              ),
            ),
          ] else ...[
            // Connect card
            Card(
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      children: [
                        Icon(Icons.hub_rounded, color: scheme.primary),
                        const SizedBox(width: 8),
                        Text(
                          'Connect an LndHub wallet',
                          style:
                              Theme.of(context).textTheme.titleMedium?.copyWith(
                                    fontWeight: FontWeight.bold,
                                  ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    Text(
                      'Scan the QR your hub shows: BlueWallet export, Zeus '
                      'LNDhub account, Alby LNDhub, Umbrel, or a BTCPay '
                      '"LNDhub API" code.',
                      style: TextStyle(
                        fontSize: 13,
                        color: scheme.onSurfaceVariant,
                        height: 1.45,
                      ),
                    ),
                    const SizedBox(height: 16),
                    FilledButton.icon(
                      onPressed: () => _scan(context, ref),
                      icon: const Icon(Icons.qr_code_scanner_rounded),
                      label: const Text('Scan LndHub QR'),
                      style: FilledButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 14),
                      ),
                    ),
                    const SizedBox(height: 10),
                    OutlinedButton.icon(
                      onPressed: () => _paste(context, ref),
                      icon: const Icon(Icons.content_paste_rounded),
                      label: const Text('Paste lndhub:// URI'),
                    ),
                    if (hub.error != null) ...[
                      const SizedBox(height: 12),
                      Text(
                        hub.error!,
                        style: TextStyle(color: scheme.error, fontSize: 12),
                        textAlign: TextAlign.center,
                      ),
                    ],
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
            Card(
              color: scheme.surfaceContainerHighest,
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Icon(Icons.shield_outlined,
                            size: 18, color: scheme.onSurfaceVariant),
                        const SizedBox(width: 8),
                        Text(
                          'What is LndHub?',
                          style: Theme.of(context).textTheme.titleSmall,
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'LndHub is BlueWallet\'s custodial-account protocol. The '
                      'QR holds a login + password that mints a session token — '
                      'it can SPEND, so only scan a hub you trust, and keep '
                      'the balance small.',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: scheme.onSurfaceVariant,
                            height: 1.4,
                          ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Future<void> _scan(BuildContext context, WidgetRef ref) async {
    final scanned = await showQrScanSheet(
      context,
      title: 'Scan LndHub QR',
      hint: 'The lndhub:// code from BlueWallet, Zeus, Alby, Umbrel or BTCPay.',
    );
    if (scanned == null || !context.mounted) return;
    final ok = await ref.read(lndHubProvider.notifier).connect(scanned);
    if (context.mounted && ok) {
      AppToast.success(context, 'LndHub wallet connected');
    }
  }

  Future<void> _paste(BuildContext context, WidgetRef ref) async {
    final data = await Clipboard.getData(Clipboard.kTextPlain);
    final text = data?.text?.trim() ?? '';
    if (text.isEmpty) {
      AppToast.warning(context, 'Clipboard is empty');
      return;
    }
    final ok = await ref.read(lndHubProvider.notifier).connect(text);
    if (context.mounted && ok) {
      AppToast.success(context, 'LndHub wallet connected');
    }
  }

  void _confirmDisconnect(BuildContext context, WidgetRef ref) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Disconnect LndHub?'),
        content: const Text(
          'The credentials are removed from this device. The account itself '
          '(and its balance) is untouched — reconnect by scanning the QR again.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () async {
              await ref.read(lndHubProvider.notifier).disconnect();
              if (ctx.mounted) Navigator.pop(ctx);
            },
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(ctx).colorScheme.error,
            ),
            child: const Text('Disconnect'),
          ),
        ],
      ),
    );
  }
}
