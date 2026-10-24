import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

/// One shared QR scanner for the whole app.
///
/// Shows a full-screen sheet with the camera and a corner-bracket cutout,
/// and pops with the scanned string. Used by Send (scan a recipient) and
/// the LndHub connect flow (scan a wallet QR). NWC has its own inline
/// scanner already; new scan needs should come here instead of growing a
/// third copy.
///
/// Returns the scanned string, or null when dismissed without a scan.
Future<String?> showQrScanSheet(
  BuildContext context, {
  String title = 'Scan QR code',
  String? hint,
}) {
  return showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.black,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
    ),
    builder: (_) => _QrScanSheet(title: title, hint: hint),
  );
}

class _QrScanSheet extends StatefulWidget {
  final String title;
  final String? hint;
  const _QrScanSheet({required this.title, this.hint});

  @override
  State<_QrScanSheet> createState() => _QrScanSheetState();
}

class _QrScanSheetState extends State<_QrScanSheet> {
  final MobileScannerController _controller = MobileScannerController();
  bool _scanned = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: MediaQuery.sizeOf(context).height * 0.85,
      child: Column(
        children: [
          // Header
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 8, 8),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    widget.title,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 17,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.close, color: Colors.white),
                  tooltip: 'Close',
                  onPressed: () => Navigator.pop(context),
                ),
              ],
            ),
          ),
          if (widget.hint != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: Text(
                widget.hint!,
                style: TextStyle(
                  color: Colors.white.withValues(alpha: 0.7),
                  fontSize: 13,
                ),
              ),
            ),
          // Camera
          Expanded(
            child: MobileScanner(
              controller: _controller,
              onDetect: (capture) {
                if (_scanned) return;
                final code = capture.barcodes.firstOrNull?.rawValue;
                if (code != null && code.isNotEmpty) {
                  _scanned = true;
                  Navigator.pop(context, code);
                }
              },
              overlayBuilder: (context, constraints) {
                return Container(
                  decoration: ShapeDecoration(
                    shape: _ScannerOverlayShape(
                      borderColor: Theme.of(context).colorScheme.primary,
                    ),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

/// Corner-bracket cutout overlay (cosmetic — detection runs on the full
/// frame; a scan-window rect offset from the camera view was the bug that
/// made QRs "not scan" when the sheet sat part-way down a list).
class _ScannerOverlayShape extends ShapeBorder {
  final Color borderColor;
  const _ScannerOverlayShape({required this.borderColor});

  @override
  EdgeInsetsGeometry get dimensions => EdgeInsets.zero;

  @override
  Path getInnerPath(Rect rect, {TextDirection? textDirection}) => Path();

  @override
  Path getOuterPath(Rect rect, {TextDirection? textDirection}) => Path()
    ..addRect(rect);

  @override
  void paint(Canvas canvas, Rect rect, {TextDirection? textDirection}) {
    const cutOutSize = 240.0;
    const borderLength = 26.0;
    const borderWidth = 6.0;
    const borderRadius = 14.0;

    final cutOut = Rect.fromCenter(
      center: rect.center,
      width: cutOutSize,
      height: cutOutSize,
    );
    final rrect = RRect.fromRectAndRadius(
      cutOut,
      const Radius.circular(borderRadius),
    );

    final backgroundPaint = Paint()
      ..color = Colors.black.withValues(alpha: 0.55)
      ..style = PaintingStyle.fill;
    final backgroundPath = Path.combine(
      PathOperation.difference,
      Path()..addRect(rect),
      Path()..addRRect(rrect),
    );
    canvas.drawPath(backgroundPath, backgroundPaint);

    final paint = Paint()
      ..color = borderColor
      ..style = PaintingStyle.stroke
      ..strokeWidth = borderWidth
      ..strokeCap = StrokeCap.round;

    final path = Path();
    // Top-left
    path.moveTo(rrect.left, rrect.top + borderLength);
    path.lineTo(rrect.left, rrect.top + borderRadius);
    path.arcToPoint(
      Offset(rrect.left + borderRadius, rrect.top),
      radius: const Radius.circular(borderRadius),
    );
    path.lineTo(rrect.left + borderLength, rrect.top);
    // Top-right
    path.moveTo(rrect.right - borderLength, rrect.top);
    path.lineTo(rrect.right - borderRadius, rrect.top);
    path.arcToPoint(
      Offset(rrect.right, rrect.top + borderRadius),
      radius: const Radius.circular(borderRadius),
    );
    path.lineTo(rrect.right, rrect.top + borderLength);
    // Bottom-right
    path.moveTo(rrect.right, rrect.bottom - borderLength);
    path.lineTo(rrect.right, rrect.bottom - borderRadius);
    path.arcToPoint(
      Offset(rrect.right - borderRadius, rrect.bottom),
      radius: const Radius.circular(borderRadius),
    );
    path.lineTo(rrect.right - borderLength, rrect.bottom);
    // Bottom-left
    path.moveTo(rrect.left + borderLength, rrect.bottom);
    path.lineTo(rrect.left + borderRadius, rrect.bottom);
    path.arcToPoint(
      Offset(rrect.left, rrect.bottom - borderRadius),
      radius: const Radius.circular(borderRadius),
    );
    path.lineTo(rrect.left, rrect.bottom - borderLength);

    canvas.drawPath(path, paint);
  }

  @override
  ShapeBorder scale(double t) => this;
}
