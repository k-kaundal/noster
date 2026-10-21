import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/features/identity/providers/address_providers.dart';
import 'package:nostrfeed_mobile/features/wallet/providers/lnbits_providers.dart';
import 'package:nostrfeed_mobile/features/wallet/services/lnbits_service.dart';
import 'package:nostrfeed_mobile/features/wallet/widgets/invoice_qr.dart';

/// Amounts people actually ask for, so most requests need no typing.
const _presets = [1000, 5000, 21000, 100000];

/// "Receive sats" — two ways to be paid, in one sheet.
///
/// The LIGHTNING ADDRESS is shown first because it is reusable — it works
/// for any amount, any number of times, and needs nothing created first.
/// An invoice is the right answer only when a specific amount is requested,
/// so creating one is the second half, not the whole thing.
///
/// After an invoice is minted the sheet POLLS its status ("Waiting for X
/// sats…" → "Received ✓") so the person holding the phone out to be paid
/// actually sees the money land — the old dialog showed the QR and went
/// silent, which read as "invoice not showing / not working".
class ReceiveDialog extends ConsumerStatefulWidget {
  const ReceiveDialog({super.key});

  @override
  ConsumerState<ReceiveDialog> createState() => _ReceiveDialogState();
}

class _ReceiveDialogState extends ConsumerState<ReceiveDialog> {
  final _amountController = TextEditingController(text: '1000');
  final _memoController = TextEditingController();

  String? _invoice;
  String? _paymentHash;
  int? _invoiceSats;
  bool _isPaid = false;
  bool _isWorking = false;
  String? _errorMsg;

  Timer? _poll;

  @override
  void dispose() {
    _poll?.cancel();
    _amountController.dispose();
    _memoController.dispose();
    super.dispose();
  }

  Future<void> _createInvoice() async {
    final amount = int.tryParse(_amountController.text.trim());
    if (amount == null || amount <= 0) {
      setState(() => _errorMsg = 'Enter a valid amount in sats');
      return;
    }
    setState(() {
      _isWorking = true;
      _errorMsg = null;
    });
    try {
      final wallet = ref.read(lnbitsAuthProvider).account?.wallets.first;
      if (wallet?.inkey == null) {
        throw const LnbitsException('No invoice key available', 0);
      }
      final service = LnbitsService();
      final inv = await service.createInvoice(
        apiKey: wallet!.inkey!,
        amountSats: amount,
        memo: _memoController.text.trim().isEmpty
            ? null
            : _memoController.text.trim(),
      );
      if (inv.bolt11.isEmpty) {
        throw const LnbitsException('The wallet returned no invoice', 0);
      }
      if (mounted) {
        setState(() {
          _invoice = inv.bolt11;
          _paymentHash = inv.paymentHash;
          _invoiceSats = amount;
          _isWorking = false;
        });
        _startPolling(wallet.inkey!);
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _isWorking = false;
          _errorMsg = e.toString();
        });
      }
    }
  }

  /// Polls the invoice until it settles. Bounded (~2 min) — a forgotten
  /// sheet should not poll forever.
  void _startPolling(String apiKey) {
    _poll?.cancel();
    final hash = _paymentHash;
    if (hash == null || hash.isEmpty) return;
    final service = LnbitsService();
    var attempts = 0;
    _poll = Timer.periodic(const Duration(seconds: 3), (timer) async {
      attempts++;
      if (attempts > 40 || !mounted) {
        timer.cancel();
        return;
      }
      try {
        final paid = await service.getInvoiceStatus(apiKey, hash);
        if (paid && mounted) {
          timer.cancel();
          setState(() => _isPaid = true);
          // Refresh balance + activity so the received sats show up.
          unawaited(ref.read(lnbitsAuthProvider.notifier).refresh());
        }
      } catch (_) {
        // A failed check is not a failure of the invoice — keep polling.
      }
    });
  }

  void _reset() {
    _poll?.cancel();
    setState(() {
      _invoice = null;
      _paymentHash = null;
      _invoiceSats = null;
      _isPaid = false;
      _errorMsg = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final hasInvoice = _invoice != null;
    final lightning = ref.watch(lightningAddressProvider);
    final freeAddress = ref.watch(freeAddressProvider);
    final address = lightning.primaryAddress ??
        (freeAddress != null ? '$freeAddress@ln.nostrfeed.com' : null);

    return AlertDialog(
      title: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(6),
            decoration: BoxDecoration(
              color: Colors.green.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(8),
            ),
            child: const Icon(Icons.arrow_downward,
                size: 16, color: Colors.green),
          ),
          const SizedBox(width: 10),
          Text(hasInvoice ? 'Invoice' : 'Receive sats'),
        ],
      ),
      content: SizedBox(
        // Fixed width: QrImageView's internal LayoutBuilder can't compute
        // intrinsic dimensions (AlertDialog wraps content in IntrinsicWidth)
        // — this crashed the dialog with a white screen before.
        width: 300,
        child: SingleChildScrollView(
          child: hasInvoice ? _invoiceView() : _formView(address),
        ),
      ),
      actions: [
        if (hasInvoice)
          TextButton(onPressed: _reset, child: Text(_isPaid ? 'Receive again' : 'Change amount'))
        else
          TextButton(
            onPressed: _isWorking ? null : () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
        if (!hasInvoice)
          FilledButton.icon(
            onPressed: _isWorking ? null : _createInvoice,
            icon: _isWorking
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.add),
            label: Text(_isWorking ? 'Creating…' : 'Create invoice'),
          )
        else
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Done'),
          ),
      ],
    );
  }

  // ── Form: amount + memo (+ the reusable address on top) ─────────────

  Widget _formView(String? address) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final sats = int.tryParse(_amountController.text.trim()) ?? 0;

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // The standing address — reusable, no invoice needed.
        if (address != null) ...[
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Colors.green.withValues(alpha: 0.06),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: Colors.green.withValues(alpha: 0.2)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'YOUR LIGHTNING ADDRESS',
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 1.1,
                    color: scheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 6),
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        address,
                        style: const TextStyle(
                          fontFamily: 'monospace',
                          fontWeight: FontWeight.w600,
                          fontSize: 13,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.copy_rounded, size: 16),
                      tooltip: 'Copy address',
                      visualDensity: VisualDensity.compact,
                      onPressed: () {
                        Clipboard.setData(ClipboardData(text: address));
                        AppToast.success(context, 'Address copied');
                      },
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  'Any amount, any number of times — no invoice needed.',
                  style: TextStyle(fontSize: 11, color: scheme.onSurfaceVariant),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(child: Divider(color: scheme.outlineVariant)),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 10),
                child: Text('or request a set amount',
                    style: TextStyle(fontSize: 11, color: scheme.onSurfaceVariant)),
              ),
              Expanded(child: Divider(color: scheme.outlineVariant)),
            ],
          ),
          const SizedBox(height: 16),
        ],

        // Amount + presets.
        TextField(
          controller: _amountController,
          autofocus: address == null,
          decoration: const InputDecoration(
            labelText: 'Amount (sats)',
            hintText: '0',
            prefixIcon: Icon(Icons.currency_bitcoin),
          ),
          keyboardType: TextInputType.number,
          onChanged: (_) => setState(() {}),
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 6,
          children: [
            for (final preset in _presets)
              ChoiceChip(
                label: Text('${preset ~/ 1000}k'),
                selected: sats == preset,
                onSelected: (_) {
                  _amountController.text = '$preset';
                  setState(() {});
                },
              ),
          ],
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _memoController,
          decoration: const InputDecoration(
            labelText: 'Description (optional)',
            hintText: 'Coffee, donation…',
            prefixIcon: Icon(Icons.description_outlined),
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
    );
  }

  // ── Invoice: QR + live paid status ──────────────────────────────────

  Widget _invoiceView() {
    final scheme = Theme.of(context).colorScheme;
    final sats = _invoiceSats ?? 0;

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        InvoiceQrView(bolt11: _invoice!),
        const SizedBox(height: 14),
        // Live status — the piece that was missing: without it the QR just
        // sat there and "the invoice didn't show" (nothing confirmed).
        AnimatedContainer(
          duration: const Duration(milliseconds: 250),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: BoxDecoration(
            color: _isPaid
                ? Colors.green.withValues(alpha: 0.1)
                : scheme.surfaceContainerHighest,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(
              color: _isPaid
                  ? Colors.green.withValues(alpha: 0.4)
                  : scheme.outlineVariant,
            ),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              if (_isPaid)
                const Icon(Icons.check_circle, color: Colors.green, size: 18)
              else
                const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              const SizedBox(width: 8),
              Text(
                _isPaid
                    ? 'Received ${_formatSats(sats)} sats'
                    : 'Waiting for ${_formatSats(sats)} sats…',
                style: TextStyle(
                  fontWeight: FontWeight.w600,
                  fontSize: 13,
                  color: _isPaid ? Colors.green.shade700 : scheme.onSurfaceVariant,
                ),
              ),
            ],
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
