import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/features/wallet/providers/lnbits_providers.dart';
import 'package:nostrfeed_mobile/features/wallet/services/lnbits_service.dart';
import 'package:nostrfeed_mobile/features/wallet/widgets/invoice_qr.dart';

/// "Receive Payment" — a proper two-state dialog (form → invoice QR).
///
/// Replaces the old `showDialog + StatefulBuilder` version that crashed with
/// `semantics.parentDataDirty` and showed a white box instead of the QR.
/// A real ConsumerStatefulWidget keeps the QR render in a stable subtree.
class ReceiveDialog extends ConsumerStatefulWidget {
  const ReceiveDialog({super.key});

  @override
  ConsumerState<ReceiveDialog> createState() => _ReceiveDialogState();
}

class _ReceiveDialogState extends ConsumerState<ReceiveDialog> {
  final _amountController = TextEditingController();
  final _memoController = TextEditingController();
  String? _invoice;
  bool _isWorking = false;
  String? _errorMsg;

  @override
  void dispose() {
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
      if (mounted) {
        setState(() {
          _invoice = inv.bolt11;
          _isWorking = false;
        });
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

  @override
  Widget build(BuildContext context) {
    final hasInvoice = _invoice != null;
    return AlertDialog(
      title: Text(hasInvoice ? 'Invoice created' : 'Receive Payment'),
      content: SizedBox(
        // Fixed width: QrImageView's internal LayoutBuilder can't compute
        // intrinsic dimensions (AlertDialog wraps content in IntrinsicWidth)
        // — this crashed the dialog with a white screen before.
        width: 280,
        child: SingleChildScrollView(
          child: hasInvoice
              ? InvoiceQrView(bolt11: _invoice!)
              : Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextField(
                    controller: _amountController,
                    autofocus: true,
                    decoration: const InputDecoration(
                      labelText: 'Amount (sats)',
                      hintText: '0',
                      prefixIcon: Icon(Icons.currency_bitcoin),
                    ),
                    keyboardType: TextInputType.number,
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _memoController,
                    decoration: const InputDecoration(
                      labelText: 'Memo (optional)',
                      prefixIcon: Icon(Icons.description),
                    ),
                  ),
                  if (_errorMsg != null) ...[
                    const SizedBox(height: 12),
                    Text(
                      _errorMsg!,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                        fontSize: 12,
                      ),
                      textAlign: TextAlign.center,
                    ),
                  ],
                ],
              ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _isWorking ? null : () => Navigator.pop(context),
          child: Text(hasInvoice ? 'Done' : 'Cancel'),
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
            label: Text(_isWorking ? 'Creating…' : 'Create Invoice'),
          ),
      ],
    );
  }
}
