import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../providers/cashu_providers.dart';
import '../../services/cashu_service.dart';

/// Cashu ecash wallet screen. Supports minting (Lightning → ecash),
/// sending (create token), receiving (redeem token), and melting
/// (ecash → Lightning).
class CashuWalletScreen extends ConsumerStatefulWidget {
  const CashuWalletScreen({super.key});

  @override
  ConsumerState<CashuWalletScreen> createState() =>
      _CashuWalletScreenState();
}

class _CashuWalletScreenState extends ConsumerState<CashuWalletScreen> {
  @override
  Widget build(BuildContext context) {
    final wallet = ref.watch(cashuWalletProvider);
    final colorScheme = Theme.of(context).colorScheme;
    final formatter = NumberFormat('#,###');

    return Scaffold(
      appBar: AppBar(
        title: const Text('Cashu Wallet'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () =>
                ref.read(cashuWalletProvider.notifier).refresh(),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // ── Balance card ─────────────────────────────────────────
          Container(
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [Colors.teal.shade700, Colors.cyan.shade600],
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
                    Icon(Icons.eco,
                        color: Colors.white.withValues(alpha: 0.9),
                        size: 20),
                    const SizedBox(width: 6),
                    Text(
                      'Ecash Balance',
                      style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.9),
                        fontSize: 14,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Text(
                  '${formatter.format(wallet.totalSats)} sats',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 36,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  '${wallet.data.proofs.length} proof${wallet.data.proofs.length == 1 ? '' : 's'}',
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.75),
                    fontSize: 14,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),

          // ── Error banner ─────────────────────────────────────────
          if (wallet.error != null) ...[
            Card(
              color: colorScheme.errorContainer,
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Row(
                  children: [
                    Icon(Icons.error_outline, color: colorScheme.error),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        wallet.error!,
                        style: TextStyle(
                            color: colorScheme.onErrorContainer,
                            fontSize: 13),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
          ],

          // ── Action grid ──────────────────────────────────────────
          GridView.count(
            crossAxisCount: 2,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: 12,
            crossAxisSpacing: 12,
            childAspectRatio: 1.6,
            children: [
              _actionCard(
                context,
                icon: Icons.add_circle_outline,
                label: 'Mint',
                subtitle: 'Lightning → Ecash',
                color: Colors.green,
                onTap: () => _showMintDialog(context),
              ),
              _actionCard(
                context,
                icon: Icons.send,
                label: 'Send',
                subtitle: 'Create token',
                color: Colors.blue,
                onTap: wallet.totalSats > 0
                    ? () => _showSendDialog(context)
                    : null,
              ),
              _actionCard(
                context,
                icon: Icons.download,
                label: 'Receive',
                subtitle: 'Redeem token',
                color: Colors.purple,
                onTap: () => _showReceiveDialog(context),
              ),
              _actionCard(
                context,
                icon: Icons.bolt,
                label: 'Pay',
                subtitle: 'Ecash → Lightning',
                color: Colors.orange,
                onTap: wallet.totalSats > 0
                    ? () => _showMeltDialog(context)
                    : null,
              ),
            ],
          ),
          const SizedBox(height: 24),

          // ── Mint info ────────────────────────────────────────────
          if (wallet.mintInfo != null) ...[
            Card(
              child: ListTile(
                leading: const Icon(Icons.account_balance),
                title: Text(wallet.mintInfo!.name),
                subtitle: Text(
                  wallet.mintInfo!.description ??
                      'Version ${wallet.mintInfo!.version ?? "unknown"}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ),
            const SizedBox(height: 16),
          ],

          // ── Proofs list ──────────────────────────────────────────
          if (wallet.data.proofs.isNotEmpty) ...[
            Text(
              'Proofs (${wallet.data.proofs.length})',
              style: Theme.of(context).textTheme.titleSmall?.copyWith(
                    color: colorScheme.onSurfaceVariant,
                    fontWeight: FontWeight.bold,
                  ),
            ),
            const SizedBox(height: 8),
            Card(
              child: ListView.separated(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                itemCount: wallet.data.proofs.length,
                separatorBuilder: (_, _) => const Divider(height: 1),
                itemBuilder: (context, idx) {
                  final proof = wallet.data.proofs[idx];
                  return ListTile(
                    dense: true,
                    leading: const Icon(Icons.lock_outline, size: 18),
                    title: Text(
                      '${proof.amount} sat${proof.amount == 1 ? '' : 's'}',
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                    subtitle: Text(
                      '${proof.secret.substring(0, 12)}…',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  );
                },
              ),
            ),
          ] else ...[
            Card(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  children: [
                    Icon(Icons.eco,
                        size: 48, color: colorScheme.onSurfaceVariant),
                    const SizedBox(height: 12),
                    Text(
                      'No ecash yet',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Mint some by paying a Lightning invoice, or receive a token.',
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: colorScheme.onSurfaceVariant,
                          ),
                    ),
                  ],
                ),
              ),
            ),
          ],

          // ── Reset ───────────────────────────────────────────────
          const SizedBox(height: 16),
          TextButton.icon(
            onPressed: wallet.totalSats == 0
                ? () => _confirmReset(context)
                : null,
            icon: const Icon(Icons.delete_forever, size: 18),
            label: const Text('Reset Wallet'),
            style: TextButton.styleFrom(foregroundColor: colorScheme.error),
          ),
        ],
      ),
    );
  }

  // ── Widgets ──────────────────────────────────────────────────────────

  Widget _actionCard(
    BuildContext context, {
    required IconData icon,
    required String label,
    required String subtitle,
    required Color color,
    VoidCallback? onTap,
  }) {
    final colorScheme = Theme.of(context).colorScheme;
    final enabled = onTap != null;
    return Card(
      clipBehavior: Clip.antiAlias,
      color: enabled ? color.withValues(alpha: 0.1) : colorScheme.surfaceContainerHighest,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon,
                  color: enabled ? color : colorScheme.onSurfaceVariant,
                  size: 28),
              const SizedBox(height: 6),
              Text(
                label,
                style: Theme.of(context).textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.bold,
                      color: enabled ? null : colorScheme.onSurfaceVariant,
                    ),
              ),
              Text(
                subtitle,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: colorScheme.onSurfaceVariant,
                      fontSize: 11,
                    ),
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ── Dialogs ─────────────────────────────────────────────────────────

  void _showMintDialog(BuildContext context) {
    final amountController = TextEditingController();
    MintQuote? quote;
    bool isWorking = false;
    String? errorMsg;

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setState) => AlertDialog(
          title: const Text('Mint Ecash'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (quote == null) ...[
                  TextField(
                    controller: amountController,
                    decoration: const InputDecoration(
                      labelText: 'Amount (sats)',
                      hintText: '100',
                      prefixIcon: Icon(Icons.currency_bitcoin),
                    ),
                    keyboardType: TextInputType.number,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'A Lightning invoice will be generated. Pay it to mint ecash.',
                    style: Theme.of(ctx).textTheme.bodySmall,
                  ),
                ] else ...[
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: QrImageView(
                      data: quote!.request.toUpperCase(),
                      size: 180,
                      backgroundColor: Colors.white,
                    ),
                  ),
                  const SizedBox(height: 12),
                  Text(
                    'Pay this Lightning invoice, then tap "I Paid".',
                    style: Theme.of(ctx).textTheme.bodySmall,
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 8),
                  SelectableText(
                    quote!.request,
                    style: Theme.of(ctx).textTheme.bodySmall,
                    maxLines: 2,
                  ),
                ],
                if (errorMsg != null) ...[
                  const SizedBox(height: 12),
                  Text(
                    errorMsg!,
                    style: TextStyle(
                        color: Theme.of(ctx).colorScheme.error, fontSize: 12),
                    textAlign: TextAlign.center,
                  ),
                ],
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: isWorking ? null : () => Navigator.pop(ctx),
              child: const Text('Cancel'),
            ),
            if (quote == null)
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
                          final q = await ref
                              .read(cashuWalletProvider.notifier)
                              .requestMintQuote(amount);
                          setState(() {
                            quote = q;
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
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.add),
                label: const Text('Get Invoice'),
              )
            else
              FilledButton.icon(
                onPressed: isWorking
                    ? null
                    : () async {
                        final amount =
                            int.tryParse(amountController.text.trim()) ?? 0;
                        setState(() {
                          isWorking = true;
                          errorMsg = null;
                        });
                        try {
                          await ref
                              .read(cashuWalletProvider.notifier)
                              .claimMintProofs(
                                quoteId: quote!.quote,
                                amountSats: amount,
                              );
                          if (ctx.mounted) Navigator.pop(ctx);
                          if (mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(content: Text('Ecash minted')),
                            );
                          }
                        } catch (e) {
                          setState(() {
                            isWorking = false;
                            errorMsg = e.toString();
                          });
                        }
                      },
                icon: isWorking
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.check),
                label: const Text('I Paid'),
              ),
          ],
        ),
      ),
    );
  }

  void _showSendDialog(BuildContext context) {
    final amountController = TextEditingController();
    final memoController = TextEditingController();
    String? token;
    bool isWorking = false;
    String? errorMsg;

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setState) => AlertDialog(
          title: const Text('Send Ecash'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (token == null) ...[
                  TextField(
                    controller: amountController,
                    decoration: const InputDecoration(
                      labelText: 'Amount (sats)',
                      prefixIcon: Icon(Icons.currency_bitcoin),
                    ),
                    keyboardType: TextInputType.number,
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: memoController,
                    decoration: const InputDecoration(
                      labelText: 'Memo (optional)',
                      prefixIcon: Icon(Icons.message_outlined),
                    ),
                  ),
                ] else ...[
                  SelectableText(
                    token!,
                    style: Theme.of(ctx).textTheme.bodySmall,
                    maxLines: 4,
                  ),
                  const SizedBox(height: 12),
                  Text(
                    'Share this Cashu token. The receiver can redeem it on the same mint.',
                    style: Theme.of(ctx).textTheme.bodySmall,
                    textAlign: TextAlign.center,
                  ),
                ],
                if (errorMsg != null) ...[
                  const SizedBox(height: 12),
                  Text(
                    errorMsg!,
                    style: TextStyle(
                        color: Theme.of(ctx).colorScheme.error, fontSize: 12),
                    textAlign: TextAlign.center,
                  ),
                ],
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: isWorking ? null : () => Navigator.pop(ctx),
              child: const Text('Cancel'),
            ),
            if (token == null)
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
                          final t = await ref
                              .read(cashuWalletProvider.notifier)
                              .createSendToken(
                                amount,
                                memo: memoController.text.trim().isEmpty
                                    ? null
                                    : memoController.text.trim(),
                              );
                          setState(() {
                            token = t;
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
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.send),
                label: const Text('Create Token'),
              )
            else ...[
              TextButton.icon(
                onPressed: () {
                  Clipboard.setData(ClipboardData(text: token!));
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Token copied')),
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
          ],
        ),
      ),
    );
  }

  void _showReceiveDialog(BuildContext context) {
    final tokenController = TextEditingController();
    bool isWorking = false;
    String? errorMsg;

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setState) => AlertDialog(
          title: const Text('Receive Ecash'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: tokenController,
                decoration: InputDecoration(
                  labelText: 'Cashu Token',
                  hintText: 'cashuA…',
                  prefixIcon: const Icon(Icons.token),
                  suffixIcon: IconButton(
                    icon: const Icon(Icons.paste),
                    onPressed: () async {
                      final data = await Clipboard.getData('text/plain');
                      if (data?.text != null) {
                        tokenController.text = data!.text!;
                      }
                    },
                  ),
                ),
                maxLines: 3,
                minLines: 1,
              ),
              if (errorMsg != null) ...[
                const SizedBox(height: 12),
                Text(
                  errorMsg!,
                  style: TextStyle(
                      color: Theme.of(ctx).colorScheme.error, fontSize: 12),
                  textAlign: TextAlign.center,
                ),
              ],
            ],
          ),
          actions: [
            TextButton(
              onPressed: isWorking ? null : () => Navigator.pop(ctx),
              child: const Text('Cancel'),
            ),
            FilledButton.icon(
              onPressed: isWorking
                  ? null
                  : () async {
                      final token = tokenController.text.trim();
                      if (token.isEmpty) return;
                      setState(() {
                        isWorking = true;
                        errorMsg = null;
                      });
                      try {
                        final sats = await ref
                            .read(cashuWalletProvider.notifier)
                            .receiveToken(token);
                        if (ctx.mounted) Navigator.pop(ctx);
                        if (mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(
                                content: Text('Received $sats sats')),
                          );
                        }
                      } catch (e) {
                        setState(() {
                          isWorking = false;
                          errorMsg = e.toString();
                        });
                      }
                    },
              icon: isWorking
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.download),
              label: const Text('Redeem'),
            ),
          ],
        ),
      ),
    );
  }

  void _showMeltDialog(BuildContext context) {
    final invoiceController = TextEditingController();
    bool isWorking = false;
    String? errorMsg;

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setState) => AlertDialog(
          title: const Text('Pay Lightning Invoice'),
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
              const SizedBox(height: 8),
              Text(
                'Your ecash will be melted to pay this Lightning invoice.',
                style: Theme.of(ctx).textTheme.bodySmall,
              ),
              if (errorMsg != null) ...[
                const SizedBox(height: 12),
                Text(
                  errorMsg!,
                  style: TextStyle(
                      color: Theme.of(ctx).colorScheme.error, fontSize: 12),
                  textAlign: TextAlign.center,
                ),
              ],
            ],
          ),
          actions: [
            TextButton(
              onPressed: isWorking ? null : () => Navigator.pop(ctx),
              child: const Text('Cancel'),
            ),
            FilledButton.icon(
              onPressed: isWorking
                  ? null
                  : () async {
                      final invoice = invoiceController.text.trim();
                      if (invoice.isEmpty) return;
                      setState(() {
                        isWorking = true;
                        errorMsg = null;
                      });
                      try {
                        final result = await ref
                            .read(cashuWalletProvider.notifier)
                            .meltInvoice(invoice);
                        if (result.paid) {
                          if (ctx.mounted) Navigator.pop(ctx);
                          if (mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(content: Text('Invoice paid')),
                            );
                          }
                        } else {
                          setState(() {
                            isWorking = false;
                            errorMsg = 'Payment not completed: ${result.state}';
                          });
                        }
                      } catch (e) {
                        setState(() {
                          isWorking = false;
                          errorMsg = e.toString();
                        });
                      }
                    },
              icon: isWorking
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.bolt),
              label: const Text('Pay'),
            ),
          ],
        ),
      ),
    );
  }

  void _confirmReset(BuildContext context) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Reset Wallet'),
        content: const Text(
            'This will permanently delete all locally stored ecash proofs. '
            'They cannot be recovered.'),
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
              await ref.read(cashuWalletProvider.notifier).reset();
              if (ctx.mounted) Navigator.pop(ctx);
            },
            child: const Text('Delete'),
          ),
        ],
      ),
    );
  }
}
