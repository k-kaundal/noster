import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:share_plus/share_plus.dart';

/// Displays a BOLT11 invoice: QR code + the invoice string + copy action.
/// Extracted from the receive dialog so both the dialog and the Activity
/// list (tap a pending payment → re-show QR) share one implementation.
class InvoiceQrView extends StatelessWidget {
  final String bolt11;

  const InvoiceQrView({super.key, required this.bolt11});

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return SizedBox(
      // FIXED WIDTH: AlertDialog wraps content in IntrinsicWidth, and
      // QrImageView's internal LayoutBuilder can't compute intrinsic
      // dimensions ("LayoutBuilder does not support returning intrinsic
      // dimensions") — which crashed the whole dialog (white screen +
      // semantics errors). A sized box sidesteps intrinsic sizing entirely.
      width: 280,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: colorScheme.outlineVariant),
          ),
          child: QrImageView(
            data: bolt11.toUpperCase(),
            size: 220,
            backgroundColor: Colors.white,
            errorCorrectionLevel: QrErrorCorrectLevel.M,
          ),
        ),
        const SizedBox(height: 14),
        Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: colorScheme.surfaceContainerHighest,
            borderRadius: BorderRadius.circular(10),
          ),
          child: SelectableText(
            bolt11,
            style: const TextStyle(fontFamily: 'monospace', fontSize: 11),
            maxLines: 4,
          ),
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: FilledButton.tonalIcon(
                onPressed: () {
                  Clipboard.setData(ClipboardData(text: bolt11));
                  AppToast.success(context, 'Invoice copied');
                },
                icon: const AppIcon('edit', size: 18),
                label: const Text('Copy'),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: OutlinedButton.icon(
                onPressed: () => _share(context),
                icon: const AppIcon('share', size: 18),
                label: const Text('Share'),
              ),
            ),
          ],
        ),
        ],
      ),
    );
  }

  /// Share the invoice as `lightning:<bolt11>` — the form wallets scan.
  void _share(BuildContext context) {
    final box = context.findRenderObject() as RenderBox?;
    final origin = box != null
        ? box.localToGlobal(Offset.zero) & box.size
        : const Rect.fromLTWH(0, 0, 100, 100);
    SharePlus.instance.share(
      ShareParams(
        text: 'lightning:$bolt11',
        sharePositionOrigin: origin,
      ),
    );
  }
}

/// A simple dialog that shows an invoice's QR. Used by the Activity list:
/// tap a pending incoming payment → re-show its QR so it can still be paid.
Future<void> showInvoiceQrDialog(BuildContext context, String bolt11) {
  return showDialog<void>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: const Text('Invoice'),
      content: SizedBox(
        width: 280,
        child: SingleChildScrollView(
          child: InvoiceQrView(bolt11: bolt11),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(ctx),
          child: const Text('Close'),
        ),
      ],
    ),
  );
}
