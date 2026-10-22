import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/services/wallet_payment.dart';
import 'package:nostrfeed_mobile/core/widgets/app_sheet.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/features/wallet/presentation/widgets/invoice_qr.dart';

/// Result of [showPayInvoiceSheet] — how the invoice got settled (or didn't).
enum InvoicePayResult {
  /// Paid (in-app wallet, or confirmed externally via "I've paid").
  paid,

  /// The sheet was closed without a confirmed payment.
  cancelled,
}

/// One shared "pay this invoice" flow for the whole app.
///
/// Layout:
///  - A primary **Pay** button whenever an in-app wallet can attempt payment
///    (LNbits → NWC → Cashu, tried in that order by [payWithAnyWallet]).
///  - The bolt11 QR + copy, so ANY external wallet can pay the same invoice.
///  - "I've paid — check" for external payments: polls the caller's
///    [checkPaid] (each purchase knows its own confirmation route).
///
/// Used by the NIP-05 name purchase and the paid-relay admission — both are
/// "mint invoice → pay → confirm → unlock", and two hand-rolled copies of
/// that flow had already drifted apart (one had no pay button at all).
///
/// [checkPaid] must return true only when the payment is confirmed by whoever
/// issued the invoice — never from a local record.
Future<InvoicePayResult> showPayInvoiceSheet(
  BuildContext context, {
  required String title,
  required String bolt11,
  int? amountSats,
  String? memo,
  required Future<bool> Function() checkPaid,
}) async {
  final result = await AppSheet.show<InvoicePayResult>(
    context,
    isDismissible: false,
    child: _PayInvoiceSheet(
      title: title,
      bolt11: bolt11,
      amountSats: amountSats,
      memo: memo,
      checkPaid: checkPaid,
    ),
  );
  return result ?? InvoicePayResult.cancelled;
}

class _PayInvoiceSheet extends ConsumerStatefulWidget {
  final String title;
  final String bolt11;
  final int? amountSats;
  final String? memo;
  final Future<bool> Function() checkPaid;

  const _PayInvoiceSheet({
    required this.title,
    required this.bolt11,
    this.amountSats,
    this.memo,
    required this.checkPaid,
  });

  @override
  ConsumerState<_PayInvoiceSheet> createState() => _PayInvoiceSheetState();
}

class _PayInvoiceSheetState extends ConsumerState<_PayInvoiceSheet> {
  bool _paying = false;
  bool _checking = false;

  Future<void> _payInApp() async {
    if (_paying) return;
    setState(() => _paying = true);
    try {
      final wallet = await payWithAnyWallet(ref.read, widget.bolt11);
      if (!mounted) return;
      if (wallet == null) {
        AppToast.error(
          context,
          'No in-app wallet could pay (check balance), or none is connected — scan the QR with any wallet instead.',
        );
        return;
      }
      // Payment left the wallet — confirm it actually settled before closing.
      final settled = await widget.checkPaid();
      if (!mounted) return;
      if (settled) {
        Navigator.of(context).pop(InvoicePayResult.paid);
      } else {
        AppToast.info(
          context,
          'Payment sent — waiting for it to confirm. Use "I\'ve paid" in a moment.',
        );
      }
    } finally {
      if (mounted) setState(() => _paying = false);
    }
  }

  Future<void> _checkManually() async {
    if (_checking) return;
    setState(() => _checking = true);
    try {
      final settled = await widget.checkPaid();
      if (!mounted) return;
      if (settled) {
        Navigator.of(context).pop(InvoicePayResult.paid);
      } else {
        AppToast.info(context, 'Payment not confirmed yet — try again shortly');
      }
    } finally {
      if (mounted) setState(() => _checking = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final theme = Theme.of(context);
    final canPayInApp = hasPayingWallet(ref.read);

    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Header
            Row(
              children: [
                Expanded(
                  child: Text(
                    widget.title,
                    style: theme.textTheme.titleLarge
                        ?.copyWith(fontWeight: FontWeight.bold),
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.close),
                  tooltip: 'Close',
                  onPressed: () =>
                      Navigator.of(context).pop(InvoicePayResult.cancelled),
                ),
              ],
            ),
            if (widget.amountSats != null || widget.memo != null) ...[
              const SizedBox(height: 2),
              Text(
                [
                  if (widget.amountSats != null)
                    '${_formatSats(widget.amountSats!)} sats',
                  ?widget.memo,
                ].join(' • '),
                style: TextStyle(fontSize: 13, color: scheme.onSurfaceVariant),
              ),
            ],
            const SizedBox(height: 16),

            // Primary action: pay from an in-app wallet.
            if (canPayInApp) ...[
              FilledButton.icon(
                onPressed: _paying ? null : _payInApp,
                icon: _paying
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.bolt_rounded, size: 18),
                label: Text(
                  _paying
                      ? 'Paying…'
                      : widget.amountSats != null
                          ? 'Pay ${_formatSats(widget.amountSats!)} sats'
                          : 'Pay now',
                ),
                style: FilledButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 14),
                ),
              ),
              const SizedBox(height: 14),
              Row(
                children: [
                  Expanded(child: Divider(color: scheme.outlineVariant)),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 10),
                    child: Text(
                      'or pay with any wallet',
                      style: TextStyle(
                          fontSize: 12, color: scheme.onSurfaceVariant),
                    ),
                  ),
                  Expanded(child: Divider(color: scheme.outlineVariant)),
                ],
              ),
              const SizedBox(height: 14),
            ],

            // QR fallback for external wallets.
            Center(child: InvoiceQrView(bolt11: widget.bolt11)),
            const SizedBox(height: 16),

            // Manual confirmation for external payments.
            OutlinedButton.icon(
              onPressed: _checking ? null : _checkManually,
              icon: _checking
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.check_rounded, size: 18),
              label: const Text("I've paid — check"),
            ),
          ],
        ),
      ),
    );
  }
}

String _formatSats(int sats) {
  final s = sats.toString();
  final buf = StringBuffer();
  for (var i = 0; i < s.length; i++) {
    final idx = s.length - i;
    buf.write(s[i]);
    if (idx > 1 && idx % 3 == 1) buf.write(',');
  }
  return buf.toString();
}
