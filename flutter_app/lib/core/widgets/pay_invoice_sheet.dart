import 'dart:async';

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

class _PayInvoiceSheetState extends ConsumerState<_PayInvoiceSheet>
    with WidgetsBindingObserver {
  bool _paying = false;
  bool _checking = false;

  /// Auto-poll: the fix for "paid, closed the sheet, credits never landed".
  ///
  /// Lightning settle + the issuer's `paid=true` is NOT instant — a single
  /// check right after paying (the old flow) usually returned false, the
  /// sheet said "use I've paid", and a user who just closed it lost the
  /// credit even though the sats left their wallet.
  ///
  /// Now the sheet polls [checkPaid] itself:
  ///  - after every in-app payment attempt, until confirmed (bounded ~2 min),
  ///  - passively every [_pollInterval] while the sheet is open, so an
  ///    external QR payment also closes the sheet on its own,
  ///  - again on app resume (a wallet app switched away to pay).
  Timer? _pollTimer;
  bool _pollInFlight = false;
  bool _awaitingPayment = false;

  /// How often the sheet re-checks settlement. Cheap: one GET on the
  /// invoice-status endpoint per tick, only while this sheet is open.
  static const _pollInterval = Duration(seconds: 2);

  /// Hard bound on the post-payment wait so a stuck invoice doesn't spin
  /// forever — after this the user gets the manual "I've paid" path back.
  static const _pollDeadline = Duration(minutes: 2);
  DateTime? _pollUntil;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    // Passive polling covers external QR payments: no button press needed.
    _startPolling();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _pollTimer?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Coming back from the wallet app (or the OS killed our socket while
    // backgrounded) — check immediately rather than waiting for the tick.
    if (state == AppLifecycleState.resumed) _pollOnce();
  }

  void _startPolling() {
    _pollTimer?.cancel();
    _pollTimer = Timer.periodic(_pollInterval, (_) => _pollOnce());
  }

  /// One settlement check, serialized (a slow status endpoint must never
  /// stack overlapping polls). Silent: only acts on `true`.
  Future<void> _pollOnce() async {
    if (_pollInFlight || !mounted) return;
    _pollInFlight = true;
    try {
      final settled = await widget.checkPaid();
      if (!mounted) return;
      if (settled) {
        _pollTimer?.cancel();
        Navigator.of(context).pop(InvoicePayResult.paid);
      }
    } catch (_) {
      // A flaky status endpoint must not kill the poll loop — next tick.
    } finally {
      _pollInFlight = false;
    }
  }

  Future<void> _payWith(WalletOption option) async {
    if (_paying) return;
    setState(() => _paying = true);
    try {
      final ok = await payWithWallet(ref.read, option.kind, widget.bolt11);
      if (!mounted) return;
      if (!ok) {
        AppToast.error(
          context,
          '${option.label} could not pay (check balance / connection) — try another wallet or scan the QR.',
        );
        return;
      }
      // Payment left the wallet — confirm it actually settled before closing.
      // Not instant: poll until the issuer confirms (bounded), instead of the
      // old one-shot check that told the user to come back and press a button.
      setState(() {
        _awaitingPayment = true;
        _pollUntil = DateTime.now().add(_pollDeadline);
      });
      await _pollUntilSettled();
    } finally {
      if (mounted) {
        setState(() {
          _paying = false;
          _awaitingPayment = false;
          _pollUntil = null;
        });
      }
    }
  }

  /// Actively polls right after an in-app payment until settled or the
  /// deadline passes. The passive timer keeps running underneath; this just
  /// gives immediate feedback + the waiting spinner.
  Future<void> _pollUntilSettled() async {
    while (mounted) {
      final settled = await widget.checkPaid().catchError((_) => false);
      if (!mounted) return;
      if (settled) {
        _pollTimer?.cancel();
        Navigator.of(context).pop(InvoicePayResult.paid);
        return;
      }
      final until = _pollUntil;
      if (until == null || DateTime.now().isAfter(until)) {
        AppToast.info(
          context,
          'Payment sent — waiting for it to confirm. It will close on its own once it lands, or use "I\'ve paid".',
        );
        return;
      }
      await Future<void>.delayed(_pollInterval);
    }
  }

  Future<void> _checkManually() async {
    if (_checking) return;
    setState(() => _checking = true);
    try {
      final settled = await widget.checkPaid();
      if (!mounted) return;
      if (settled) {
        _pollTimer?.cancel();
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
    final wallets = availableWallets(ref.read);

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

            // Wallet picker — pay from any CONNECTED in-app wallet.
            if (wallets.isNotEmpty) ...[
              for (final option in wallets) ...[
                _WalletPayTile(
                  option: option,
                  busy: _paying,
                  amountSats: widget.amountSats,
                  onTap: () => _payWith(option),
                ),
                const SizedBox(height: 8),
              ],
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(child: Divider(color: scheme.outlineVariant)),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 10),
                    child: Text(
                      'or scan with any wallet',
                      style: TextStyle(
                          fontSize: 12, color: scheme.onSurfaceVariant),
                    ),
                  ),
                  Expanded(child: Divider(color: scheme.outlineVariant)),
                ],
              ),
              const SizedBox(height: 14),
            ],

            // QR for external wallets.
            Center(child: InvoiceQrView(bolt11: widget.bolt11)),
            const SizedBox(height: 16),

            // Post-payment wait: payment left the wallet, the issuer hasn't
            // confirmed yet — the sheet is polling and will close itself.
            if (_awaitingPayment) ...[
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                decoration: BoxDecoration(
                  color: scheme.primaryContainer,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Row(
                  children: [
                    SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: scheme.onPrimaryContainer,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        'Payment sent — confirming… this closes on its own.',
                        style: TextStyle(
                          fontSize: 13,
                          color: scheme.onPrimaryContainer,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 12),
            ],

            // Manual confirmation for external payments.
            OutlinedButton.icon(
              onPressed: (_checking || _awaitingPayment) ? null : _checkManually,
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

/// One wallet in the picker: its name + balance, tap to pay the invoice
/// from it.
class _WalletPayTile extends StatelessWidget {
  final WalletOption option;
  final bool busy;
  final int? amountSats;
  final VoidCallback onTap;

  const _WalletPayTile({
    required this.option,
    required this.busy,
    required this.amountSats,
    required this.onTap,
  });

  IconData get _icon => switch (option.kind) {
        WalletKind.lnbits => Icons.account_balance_wallet_outlined,
        WalletKind.nwc => Icons.link_rounded,
        WalletKind.cashu => Icons.eco_outlined,
        WalletKind.lndhub => Icons.hub_rounded,
      };

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Material(
      color: scheme.surfaceContainerHighest,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: busy ? null : onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          child: Row(
            children: [
              Icon(_icon, color: scheme.primary, size: 22),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      option.label,
                      style: const TextStyle(
                        fontWeight: FontWeight.w600,
                        fontSize: 14,
                      ),
                    ),
                    if (option.detail != null)
                      Text(
                        option.detail!,
                        style: TextStyle(
                          fontSize: 12,
                          color: scheme.onSurfaceVariant,
                        ),
                      ),
                  ],
                ),
              ),
              if (busy)
                const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              else
                Icon(Icons.bolt_rounded, size: 18, color: scheme.primary),
            ],
          ),
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
