import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/core/widgets/qr_scan_sheet.dart';
import 'package:nostrfeed_mobile/features/wallet/application/lnbits_providers.dart';
import 'package:nostrfeed_mobile/features/wallet/application/wallet_tools_providers.dart';
import 'package:nostrfeed_mobile/features/wallet/data/lnbits_service.dart';
import 'package:nostrfeed_mobile/features/wallet/data/lnurl_service.dart';
import 'package:nostrfeed_mobile/features/wallet/utils/payment_input.dart';
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';

/// "Send sats" — one box for every destination, because the string says
/// which it is (invoice / lightning address / LNURL).
///
/// An invoice that already names its amount hides the amount field — showing
/// an editable number that cannot change anything invites the belief that it
/// can. An amountless invoice, an address, or an LNURL needs one typed.
///
/// Pays out of the built-in LNbits wallet, and refreshes the balance after.
class SendDialog extends ConsumerStatefulWidget {
  final int balanceSats;
  const SendDialog({super.key, required this.balanceSats});

  @override
  ConsumerState<SendDialog> createState() => _SendDialogState();
}

class _SendDialogState extends ConsumerState<SendDialog> {
  final _destController = TextEditingController();
  final _amountController = TextEditingController();
  final _commentController = TextEditingController();

  bool _sending = false;
  String? _errorMsg;

  @override
  void dispose() {
    _destController.dispose();
    _amountController.dispose();
    _commentController.dispose();
    super.dispose();
  }

  PaymentTarget get _target => parsePaymentTarget(_destController.text);

  int? get _invoiceSats => _target.kind == PaymentTargetKind.invoice
      ? readInvoiceSats(_target.value)
      : null;

  /// The decoded invoice, when the target is a bolt11. Debounced — decoding
  /// on every keystroke would hammer the endpoint while an invoice is being
  /// pasted character by character.
  String? get _decodeKey {
    if (_target.kind != PaymentTargetKind.invoice) return null;
    final v = _target.value.trim();
    return v.length > 20 ? v : null;
  }

  bool get _needsAmount =>
      (_target.kind == PaymentTargetKind.invoice && _invoiceSats == null) ||
      _target.kind == PaymentTargetKind.address ||
      _target.kind == PaymentTargetKind.lnurl;

  int get _sats =>
      _invoiceSats ?? int.tryParse(_amountController.text.trim()) ?? 0;

  bool get _overBalance => _sats > widget.balanceSats;

  bool get _ready =>
      (_target.kind == PaymentTargetKind.invoice ||
          _target.kind == PaymentTargetKind.address ||
          _target.kind == PaymentTargetKind.lnurl) &&
      (!_needsAmount || _sats > 0) &&
      !_overBalance;

  Future<void> _paste() async {
    final data = await Clipboard.getData(Clipboard.kTextPlain);
    if (data?.text != null) {
      _destController.text = data!.text!;
      setState(() {});
    }
  }

  /// Scan a recipient QR — bolt11 invoice, lightning address, or LNURL.
  /// A wallet QR on a shop terminal is the commonest way to be handed one.
  Future<void> _scan() async {
    final scanned = await showQrScanSheet(
      context,
      title: 'Scan recipient',
      hint: 'Point at a bolt11 invoice, lightning address, or LNURL QR.',
    );
    if (scanned == null || !mounted) return;
    // QRs often come uppercased or wrapped in "lightning:" — normalize.
    var value = scanned.trim();
    if (value.toLowerCase().startsWith('lightning:')) {
      value = value.substring('lightning:'.length);
    }
    _destController.text = value;
    setState(() => _errorMsg = null);
  }

  Future<void> _send() async {
    if (!_ready) return;
    setState(() {
      _sending = true;
      _errorMsg = null;
    });
    try {
      final wallet = ref.read(lnbitsAuthProvider).activeWallet;
      if (wallet?.adminkey == null) {
        throw const LnbitsException('Admin key required to send', 0);
      }
      final service = LnbitsService();

      String bolt11 = _target.value;
      if (_target.kind != PaymentTargetKind.invoice) {
        // Address / LNURL → resolve, request an invoice, then pay it.
        final info = await resolveLnurlPay(_target.value);
        if (info == null) {
          throw const LnbitsException(
            'Could not resolve that address to a payable invoice',
            0,
          );
        }
        if (_sats < info.minSats || _sats > info.maxSats) {
          throw LnbitsException(
            'That address takes ${info.minSats}–${info.maxSats} sats',
            0,
          );
        }
        final invoice = await fetchInvoice(
          info: info,
          sats: _sats,
          comment: _commentController.text.trim().isEmpty
              ? null
              : _commentController.text.trim(),
        );
        if (invoice == null || invoice.isEmpty) {
          throw const LnbitsException(
            'The recipient did not return an invoice',
            0,
          );
        }
        bolt11 = invoice;
      }

      await service.payInvoice(apiKey: wallet!.adminkey!, bolt11: bolt11);

      if (mounted) {
        Navigator.pop(context);
        AppToast.success(context, 'Sent ${_formatSats(_sats)} sats');
      }
      // Refresh balance + activity.
      await ref.read(lnbitsAuthProvider.notifier).refresh();
    } catch (e) {
      if (mounted) {
        setState(() {
          _sending = false;
          _errorMsg = e.toString();
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final target = _target;
    final invoiceSats = _invoiceSats;
    // "≈ $X" for the amount about to be sent (and the balance), so a number
    // in sats reads as money. null when the server has no rate — hidden then.
    final fiat = _sats > 0
        ? ref.watch(satsAsFiatProvider((_sats, 'USD'))).valueOrNull
        : null;
    final balanceFiat = ref
        .watch(satsAsFiatProvider((widget.balanceSats, 'USD')))
        .valueOrNull;

    return AlertDialog(
      title: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(6),
            decoration: BoxDecoration(
              color: scheme.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(8),
            ),
            child: const AppIcon('arrow_up', size: 16),
          ),
          const SizedBox(width: 10),
          const Text('Send sats'),
        ],
      ),
      content: SizedBox(
        width: 300,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Recipient — one box for everything, plus paste and scan.
              TextField(
                controller: _destController,
                decoration: InputDecoration(
                  labelText: 'Recipient',
                  hintText: 'name@domain.com · lnbc… · lnurl…',
                  prefixIcon: AppIcon('zap', size: AppIconSize.md),
                  suffixIcon: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      IconButton(
                        icon: const AppIcon('edit', size: 18),
                        tooltip: 'Paste',
                        onPressed: _paste,
                      ),
                      IconButton(
                        icon: const Icon(
                          Icons.qr_code_scanner_rounded,
                          size: 18,
                        ),
                        tooltip: 'Scan QR',
                        onPressed: _scan,
                      ),
                    ],
                  ),
                ),
                maxLines: 3,
                minLines: 1,
                style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
                onChanged: (_) => setState(() {
                  _errorMsg = null;
                }),
              ),
              const SizedBox(height: 8),
              _TargetHint(target: target, invoiceSats: invoiceSats),

              // Decoded invoice card — who and what is about to be paid,
              // from the server's decoder (GetZap Decoder), so a malformed
              // or surprising invoice is caught before the sats leave.
              if (_decodeKey != null) _DecodedInvoiceCard(invoice: _decodeKey!),

              // Amount — only when the destination doesn't already name it.
              if (_needsAmount) ...[
                const SizedBox(height: 12),
                TextField(
                  controller: _amountController,
                  decoration: const InputDecoration(
                    labelText: 'Amount (sats)',
                    prefixIcon: AppIcon('zap', size: AppIconSize.md),
                  ),
                  keyboardType: TextInputType.number,
                  onChanged: (_) => setState(() {}),
                ),
              ],

              // Comment for address/LNURL payments.
              if (target.kind == PaymentTargetKind.address ||
                  target.kind == PaymentTargetKind.lnurl) ...[
                const SizedBox(height: 12),
                TextField(
                  controller: _commentController,
                  decoration: const InputDecoration(
                    labelText: 'Message (optional)',
                    prefixIcon: AppIcon('comment', size: AppIconSize.md),
                  ),
                ),
              ],

              // Balance + over-balance warning.
              const SizedBox(height: 14),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 10,
                ),
                decoration: BoxDecoration(
                  color: _overBalance
                      ? scheme.errorContainer.withValues(alpha: 0.4)
                      : scheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Row(
                  children: [
                    Icon(
                      Icons.account_balance_wallet_outlined,
                      size: 16,
                      color: _overBalance
                          ? scheme.error
                          : scheme.onSurfaceVariant,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        _overBalance
                            ? 'Not enough balance (${_formatSats(widget.balanceSats)} sats${balanceFiat != null ? ' $balanceFiat' : ''})'
                            : '${_formatSats(widget.balanceSats)} sats available${balanceFiat != null ? ' $balanceFiat' : ''}',
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: _overBalance
                              ? scheme.onErrorContainer
                              : scheme.onSurfaceVariant,
                        ),
                      ),
                    ),
                    if (_sats > 0 && !_overBalance)
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          Text(
                            '− ${_formatSats(_sats)}',
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.bold,
                              color: scheme.error,
                            ),
                          ),
                          if (fiat != null)
                            Text(
                              fiat,
                              style: TextStyle(
                                fontSize: 10,
                                color: scheme.error.withValues(alpha: 0.8),
                              ),
                            ),
                        ],
                      ),
                  ],
                ),
              ),

              if (_errorMsg != null) ...[
                const SizedBox(height: 12),
                Text(
                  _errorMsg!,
                  style: TextStyle(color: scheme.error, fontSize: 12),
                  textAlign: TextAlign.center,
                ),
              ],
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _sending ? null : () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
        FilledButton.icon(
          onPressed: _sending || !_ready ? null : _send,
          icon: _sending
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const AppIcon('send', size: 18),
          label: Text(
            _sending
                ? 'Sending…'
                : _sats > 0
                ? 'Send ${_formatSats(_sats)} sats'
                : 'Send',
          ),
        ),
      ],
    );
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
}

/// The decoded invoice: destination, amount, description, expiry — the
/// answer to "what am I actually paying", from the server's decoder.
class _DecodedInvoiceCard extends ConsumerWidget {
  final String invoice;
  const _DecodedInvoiceCard({required this.invoice});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final decoded = ref.watch(decodePaymentProvider(invoice));

    return decoded.when(
      loading: () => const Padding(
        padding: EdgeInsets.symmetric(vertical: 8),
        child: Center(
          child: SizedBox(
            width: 18,
            height: 18,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
        ),
      ),
      error: (_, _) => Padding(
        padding: const EdgeInsets.only(top: 8),
        child: Row(
          children: [
            AppIcon('eye_off', size: 14, color: scheme.error),
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                'Could not decode this invoice — check it before paying.',
                style: TextStyle(fontSize: 12, color: scheme.error),
              ),
            ),
          ],
        ),
      ),
      data: (payment) {
        if (payment.amountSats == null && payment.destination == null) {
          return const SizedBox.shrink();
        }
        return Container(
          margin: const EdgeInsets.only(top: 10),
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: scheme.primaryContainer.withValues(alpha: 0.35),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(
                    Icons.verified_outlined,
                    size: 14,
                    color: scheme.primary,
                  ),
                  const SizedBox(width: 6),
                  Text(
                    'DECODED INVOICE',
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w700,
                      letterSpacing: 1.1,
                      color: scheme.primary,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              if (payment.description != null &&
                  payment.description!.isNotEmpty)
                _row(context, 'For', payment.description!),
              if (payment.destination != null &&
                  payment.destination!.isNotEmpty)
                _row(context, 'To', _shorten(payment.destination!)),
              if (payment.expirySeconds != null)
                _row(context, 'Expires in', _expiry(payment.expirySeconds!)),
            ],
          ),
        );
      },
    );
  }

  Widget _row(BuildContext context, String label, String value) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 72,
            child: Text(
              label,
              style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }

  String _shorten(String s) => s.length > 24 ? '${s.substring(0, 24)}…' : s;

  String _expiry(int seconds) {
    if (seconds < 120) return '$seconds seconds';
    if (seconds < 7200) return '${seconds ~/ 60} minutes';
    return '${seconds ~/ 3600} hours';
  }
}

/// A one-line read of what the pasted string was understood to be.
class _TargetHint extends StatelessWidget {
  final PaymentTarget target;
  final int? invoiceSats;
  const _TargetHint({required this.target, required this.invoiceSats});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final sats = invoiceSats;
    final (icon, text, color) = switch (target.kind) {
      PaymentTargetKind.invoice => (
        Icons.receipt_long,
        sats != null
            ? 'Invoice • ${_formatSats(sats)} sats'
            : 'Invoice • any amount',
        Colors.green.shade700,
      ),
      PaymentTargetKind.address => (
        Icons.alternate_email,
        'Lightning address',
        scheme.primary,
      ),
      PaymentTargetKind.lnurl => (Icons.link, 'LNURL', scheme.primary),
      PaymentTargetKind.empty => (
        Icons.info_outline,
        'Paste an invoice, lightning address, or LNURL',
        scheme.onSurfaceVariant,
      ),
      PaymentTargetKind.unknown => (
        Icons.error_outline,
        "That doesn't look payable",
        scheme.error,
      ),
    };
    return Row(
      children: [
        Icon(icon, size: 14, color: color),
        const SizedBox(width: 6),
        Expanded(
          child: Text(
            text,
            style: TextStyle(
              fontSize: 12,
              color: color,
              fontWeight: FontWeight.w500,
            ),
          ),
        ),
      ],
    );
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
}
