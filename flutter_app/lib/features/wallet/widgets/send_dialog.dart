import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/features/wallet/providers/lnbits_providers.dart';
import 'package:nostrfeed_mobile/features/wallet/services/lnbits_service.dart';
import 'package:nostrfeed_mobile/features/wallet/services/lnurl_service.dart';
import 'package:nostrfeed_mobile/features/wallet/utils/payment_input.dart';

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

  Future<void> _send() async {
    if (!_ready) return;
    setState(() {
      _sending = true;
      _errorMsg = null;
    });
    try {
      final wallet = ref.read(lnbitsAuthProvider).account?.wallets.first;
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
              'Could not resolve that address to a payable invoice', 0);
        }
        if (_sats < info.minSats || _sats > info.maxSats) {
          throw LnbitsException(
              'That address takes ${info.minSats}–${info.maxSats} sats', 0);
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
              'The recipient did not return an invoice', 0);
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

    return AlertDialog(
      title: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(6),
            decoration: BoxDecoration(
              color: scheme.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(8),
            ),
            child: const Icon(Icons.arrow_upward, size: 16),
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
              // Recipient — one box for everything.
              TextField(
                controller: _destController,
                decoration: InputDecoration(
                  labelText: 'Recipient',
                  hintText: 'name@domain.com · lnbc… · lnurl…',
                  prefixIcon: const Icon(Icons.bolt),
                  suffixIcon: IconButton(
                    icon: const Icon(Icons.content_paste_rounded, size: 18),
                    tooltip: 'Paste',
                    onPressed: _paste,
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

              // Amount — only when the destination doesn't already name it.
              if (_needsAmount) ...[
                const SizedBox(height: 12),
                TextField(
                  controller: _amountController,
                  decoration: const InputDecoration(
                    labelText: 'Amount (sats)',
                    prefixIcon: Icon(Icons.currency_bitcoin),
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
                    prefixIcon: Icon(Icons.chat_bubble_outline),
                  ),
                ),
              ],

              // Balance + over-balance warning.
              const SizedBox(height: 14),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                decoration: BoxDecoration(
                  color: _overBalance
                      ? scheme.errorContainer.withValues(alpha: 0.4)
                      : scheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Row(
                  children: [
                    Icon(Icons.account_balance_wallet_outlined,
                        size: 16,
                        color: _overBalance
                            ? scheme.error
                            : scheme.onSurfaceVariant),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        _overBalance
                            ? 'Not enough balance (${_formatSats(widget.balanceSats)} sats)'
                            : '${_formatSats(widget.balanceSats)} sats available',
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
                      Text(
                        '− ${_formatSats(_sats)}',
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.bold,
                          color: scheme.error,
                        ),
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
              : const Icon(Icons.send_rounded, size: 18),
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
      PaymentTargetKind.lnurl => (
          Icons.link,
          'LNURL',
          scheme.primary,
        ),
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
            style: TextStyle(fontSize: 12, color: color, fontWeight: FontWeight.w500),
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
