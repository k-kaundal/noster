import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:nostrfeed_mobile/core/theme/app_shapes.dart';
import 'package:nostrfeed_mobile/core/theme/app_spacing.dart';
import 'package:nostrfeed_mobile/core/theme/app_theme.dart';
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/features/wallet/application/cashu_providers.dart';
import 'package:nostrfeed_mobile/features/wallet/data/cashu_service.dart';
import 'package:qr_flutter/qr_flutter.dart';

/// Cashu ecash wallet screen. Supports minting (Lightning → ecash),
/// sending (create token), receiving (redeem token), and melting
/// (ecash → Lightning).
/// Shorten a proof secret for display without splitting UTF-16 surrogates.
String _shortSecret(String secret) {
  if (secret.length <= 12) return secret;
  // Walk back from 12 so we never cut a surrogate pair in half.
  var end = 12;
  final codes = secret.codeUnits;
  if (end < codes.length &&
      codes[end - 1] >= 0xD800 &&
      codes[end - 1] <= 0xDBFF) {
    end--;
  }
  return '${secret.substring(0, end)}…';
}

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
            icon: const AppIcon('repost'),
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
            padding: const EdgeInsets.all(AppSpacing.xl),
            decoration: BoxDecoration(
              gradient: AppTheme.brandGradient,
              borderRadius: AppShapes.radiusXl,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    AppIcon('gift', color: Colors.white.withValues(alpha: 0.9), // token-guard: allow — on brand gradient
                        size: 20),
                    const SizedBox(width: 6),
                    Text(
                      'Ecash Balance',
                      style: Theme.of(context)
                          .textTheme
                          .bodyMedium
                          ?.copyWith(
                            color: Colors.white.withValues(alpha: 0.9), // token-guard: allow — on brand gradient
                          ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Text(
                  '${formatter.format(wallet.totalSats)} sats',
                  style: Theme.of(context)
                      .textTheme
                      .displaySmall
                      ?.copyWith(
                        color: Colors.white, // token-guard: allow — on brand gradient
                        fontWeight: FontWeight.bold,
                      ),
                ),
                const SizedBox(height: 4),
                Text(
                  '${wallet.data.proofs.length} proof${wallet.data.proofs.length == 1 ? '' : 's'}',
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: Colors.white.withValues(alpha: 0.75), // token-guard: allow — on brand gradient
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
                    AppIcon('eye_off', color: colorScheme.error),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        wallet.error!,
                        style: Theme.of(context)
                            .textTheme
                            .bodySmall
                            ?.copyWith(color: colorScheme.onErrorContainer),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
          ],

          // ── Action grid ──────────────────────────────────────────
          // Use a responsive aspect ratio so the cells always fit on
          // any screen width / text-scale-factor. Wider screens get a
          // wider (shorter) ratio; narrower screens get a taller one.
          Builder(builder: (context) {
            final screenWidth = MediaQuery.sizeOf(context).width;
            // Horizontal insets (16 + 16) + crossAxisSpacing (12).
            final cellWidth = (screenWidth - 44) / 2;
            // Compute an aspect ratio that guarantees at least 92 logical
            // pixels of height for the icon + two lines of text.
            final minCellHeight = 92.0 * MediaQuery.textScalerOf(context).scale(1.0);
            final aspect = (cellWidth / minCellHeight).clamp(1.0, 2.2);
            return GridView.count(
              crossAxisCount: 2,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              mainAxisSpacing: 12,
              crossAxisSpacing: 12,
              childAspectRatio: aspect,
            children: [
              _actionCard(
                context,
                icon: Icons.add_circle_outline,
                label: 'Mint',
                subtitle: 'Lightning → Ecash',
                color: AppStatusColors.success,
                onTap: () => _showMintDialog(context),
              ),
              _actionCard(
                context,
                icon: Icons.send,
                label: 'Send',
                subtitle: 'Create token',
                color: AppStatusColors.info,
                onTap: wallet.totalSats > 0
                    ? () => _showSendDialog(context)
                    : null,
              ),
              _actionCard(
                context,
                icon: Icons.download,
                label: 'Receive',
                subtitle: 'Redeem token',
                color: colorScheme.tertiary,
                onTap: () => _showReceiveDialog(context),
              ),
              _actionCard(
                context,
                icon: Icons.bolt,
                label: 'Pay',
                subtitle: 'Ecash → Lightning',
                color: AppActionColors.zap,
                onTap: wallet.totalSats > 0
                    ? () => _showMeltDialog(context)
                    : null,
              ),
              ],
            );
          }),
          const SizedBox(height: 24),

          // ── Mint info ────────────────────────────────────────────
          if (wallet.mintInfo != null) ...[
            Card(
              child: ListTile(
                leading: const AppIcon('wallet'),
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
                    leading: const AppIcon('key', size: 18),
                    title: Text(
                      '${proof.amount} sat${proof.amount == 1 ? '' : 's'}',
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                    subtitle: Text(
                      _shortSecret(proof.secret),
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
                    AppIcon('gift', size: 48, color: colorScheme.onSurfaceVariant),
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
            icon: const AppIcon('eye_off', size: 18),
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
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon,
                  color: enabled ? color : colorScheme.onSurfaceVariant,
                  size: 26),
              const SizedBox(height: 4),
              Flexible(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.bold,
                        color: enabled ? null : colorScheme.onSurfaceVariant,
                      ),
                ),
              ),
              Flexible(
                child: Text(
                  subtitle,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: colorScheme.onSurfaceVariant,
                        fontSize: 11,
                      ),
                  textAlign: TextAlign.center,
                ),
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
                      prefixIcon: AppIcon('zap', size: AppIconSize.md),
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
                      color: Colors.white, // token-guard: allow — on brand gradient
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: QrImageView(
                      data: quote!.request.toUpperCase(),
                      size: 180,
                      backgroundColor: Colors.white, // token-guard: allow — on brand gradient
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
                          if (!ctx.mounted) return;
                          setState(() {
                            quote = q;
                            isWorking = false;
                          });
                        } catch (e) {
                          if (!ctx.mounted) return;
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
                    : const AppIcon('plus'),
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
                          if (context.mounted) {
                            AppToast.success(context, 'Ecash minted');
                          }
                        } catch (e) {
                          if (!ctx.mounted) return;
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
                    : const AppIcon('check'),
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
                      prefixIcon: AppIcon('zap', size: AppIconSize.md),
                    ),
                    keyboardType: TextInputType.number,
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: memoController,
                    decoration: const InputDecoration(
                      labelText: 'Memo (optional)',
                      prefixIcon: AppIcon('comment', size: AppIconSize.md),
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
                          if (!ctx.mounted) return;
                          setState(() {
                            token = t;
                            isWorking = false;
                          });
                        } catch (e) {
                          if (!ctx.mounted) return;
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
                    : const AppIcon('send'),
                label: const Text('Create Token'),
              )
            else ...[
              TextButton.icon(
                onPressed: () {
                  Clipboard.setData(ClipboardData(text: token!));
                  AppToast.success(context, 'Token copied');
                },
                icon: const AppIcon('edit', size: AppIconSize.md),
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
                  prefixIcon: const AppIcon('key', size: AppIconSize.md),
                  suffixIcon: IconButton(
                    icon: const AppIcon('edit', size: AppIconSize.md),
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
                        if (context.mounted) {
                          AppToast.success(context, 'Received $sats sats');
                        }
                      } catch (e) {
                        if (!ctx.mounted) return;
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
                  : const AppIcon('download'),
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
                  prefixIcon: AppIcon('zap', size: AppIconSize.md),
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
                          if (context.mounted) {
                            AppToast.success(context, 'Invoice paid');
                          }
                        } else {
                          if (!ctx.mounted) return;
                          setState(() {
                            isWorking = false;
                            errorMsg = 'Payment not completed: ${result.state}';
                          });
                        }
                      } catch (e) {
                        if (!ctx.mounted) return;
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
                  : const AppIcon('zap'),
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
