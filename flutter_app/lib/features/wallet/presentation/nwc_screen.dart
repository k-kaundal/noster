import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import 'package:nostrfeed_mobile/features/wallet/application/nwc_providers.dart';
import 'package:nostrfeed_mobile/features/wallet/data/nwc_service.dart';

/// NWC Wallet Connect screen: paste URI, scan QR, or select from stored
/// connections. Shows active connection status and lets user disconnect.
class NwcScreen extends ConsumerStatefulWidget {
  const NwcScreen({super.key});

  @override
  ConsumerState<NwcScreen> createState() => _NwcScreenState();
}

class _NwcScreenState extends ConsumerState<NwcScreen> {
  final _uriController = TextEditingController();
  final _aliasController = TextEditingController();
  bool _showScanner = false;

  @override
  void dispose() {
    _uriController.dispose();
    _aliasController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final nwcState = ref.watch(nwcNotifierProvider);
    final colorScheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Nostr Wallet Connect'),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // ── Active connection card ─────────────────────────────────
          if (nwcState.isConnected && nwcState.activeConnection != null)
            _activeConnectionCard(context, nwcState, colorScheme),

          // ── Error display ───────────────────────────────────────────
          if (nwcState.error != null) ...[
            Card(
              color: colorScheme.errorContainer,
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Row(
                  children: [
                    Icon(Icons.error_outline, color: colorScheme.error),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        nwcState.error!,
                        style: TextStyle(color: colorScheme.onErrorContainer),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
          ],

          // ── Connect new wallet ──────────────────────────────────────
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      Icon(Icons.link, color: colorScheme.primary),
                      const SizedBox(width: 8),
                      Text(
                        'Connect Wallet',
                        style: Theme.of(context).textTheme.titleMedium
                            ?.copyWith(fontWeight: FontWeight.bold),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  TextField(
                    controller: _uriController,
                    decoration: InputDecoration(
                      labelText: 'NWC Connection URI',
                      hintText: 'nostr+walletconnect://…',
                      prefixIcon: const Icon(Icons.bolt),
                      suffixIcon: IconButton(
                        icon: const Icon(Icons.paste),
                        tooltip: 'Paste',
                        onPressed: () async {
                          final data = await Clipboard.getData('text/plain');
                          if (data?.text != null) {
                            _uriController.text = data!.text!;
                          }
                        },
                      ),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                    maxLines: 2,
                    minLines: 1,
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _aliasController,
                    decoration: InputDecoration(
                      labelText: 'Alias (optional)',
                      hintText: 'My Alby Wallet',
                      prefixIcon: const Icon(Icons.label_outline),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                  ),
                  const SizedBox(height: 8),
                  // Supported external wallets hint — users know what to paste.
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: colorScheme.primaryContainer.withValues(alpha: 0.3),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Icon(Icons.info_outline_rounded,
                                size: 15, color: colorScheme.primary),
                            const SizedBox(width: 6),
                            Text(
                              'Works with any NWC wallet',
                              style: TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w600,
                                color: colorScheme.primary,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'Alby · Zeus · Wallet of Satoshi · Mutiny · Phoenix · Breez · Alby Hub\n'
                          'In your wallet: find "Nostr Wallet Connect" → copy the connection URI or QR.',
                          style: TextStyle(
                            fontSize: 11,
                            height: 1.4,
                            color: colorScheme.onSurfaceVariant,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: () =>
                              setState(() => _showScanner = !_showScanner),
                          icon: Icon(
                              _showScanner ? Icons.close : Icons.qr_code_scanner),
                          label:
                              Text(_showScanner ? 'Hide Scanner' : 'Scan QR'),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: FilledButton.icon(
                          onPressed: nwcState.isLoading
                              ? null
                              : () => _connect(context),
                          icon: nwcState.isLoading
                              ? const SizedBox(
                                  width: 18,
                                  height: 18,
                                  child: CircularProgressIndicator(
                                      strokeWidth: 2),
                                )
                              : const Icon(Icons.link),
                          label: const Text('Connect'),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),

          // ── QR Scanner ──────────────────────────────────────────────
          if (_showScanner) ...[
            const SizedBox(height: 16),
            Card(
              clipBehavior: Clip.antiAlias,
              child: SizedBox(
                height: 280,
                child: _QrScannerView(
                  onScanned: (value) {
                    _uriController.text = value;
                    setState(() => _showScanner = false);
                    // Connect straight away — the scan IS the intent. Filling
                    // the field and stopping made the flow look broken: the QR
                    // scanned and then nothing happened.
                    _connect(context);
                  },
                ),
              ),
            ),
          ],

          const SizedBox(height: 24),

          // ── Stored connections ──────────────────────────────────────
          if (nwcState.connections.isNotEmpty) ...[
            Text(
              'Saved Connections',
              style: Theme.of(context).textTheme.titleSmall?.copyWith(
                    color: colorScheme.onSurfaceVariant,
                    fontWeight: FontWeight.bold,
                  ),
            ),
            const SizedBox(height: 8),
            ...nwcState.connections.map(
              (conn) => _connectionTile(context, conn, nwcState, colorScheme),
            ),
          ],

          // ── Help section ────────────────────────────────────────────
          const SizedBox(height: 24),
          Card(
            color: colorScheme.surfaceContainerHighest,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(Icons.info_outline,
                          size: 18, color: colorScheme.onSurfaceVariant),
                      const SizedBox(width: 8),
                      Text(
                        'What is NWC?',
                        style: Theme.of(context).textTheme.titleSmall,
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Nostr Wallet Connect (NIP-47) lets you connect a remote '
                    'Lightning wallet (Alby, Mutiny, Umbrel, etc.) and pay '
                    'invoices or receive zaps without leaving the app.',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: colorScheme.onSurfaceVariant,
                        ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  // ── Widgets ──────────────────────────────────────────────────────────

  Widget _activeConnectionCard(
    BuildContext context,
    NwcState state,
    ColorScheme colorScheme,
  ) {
    final conn = state.activeConnection!;
    final service = state.service;
    return Card(
      color: colorScheme.primaryContainer,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.check_circle, color: colorScheme.primary),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    conn.alias,
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.bold,
                          color: colorScheme.onPrimaryContainer,
                        ),
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.close),
                  tooltip: 'Disconnect',
                  onPressed: () => _disconnect(conn.id),
                ),
              ],
            ),
            if (service?.info != null) ...[
              const SizedBox(height: 8),
              Text(
                'Network: ${service!.info!.network ?? "unknown"} • '
                '${service.info!.methods.length} methods',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: colorScheme.onPrimaryContainer
                          .withValues(alpha: 0.7),
                    ),
              ),
            ],
            if (state.balanceSats != null) ...[
              const SizedBox(height: 8),
              Text(
                'Balance: ${state.balanceSats} sats',
                style: Theme.of(context).textTheme.titleSmall?.copyWith(
                      color: colorScheme.onPrimaryContainer,
                      fontWeight: FontWeight.w600,
                    ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _connectionTile(
    BuildContext context,
    NwcConnection conn,
    NwcState state,
    ColorScheme colorScheme,
  ) {
    final isActive = state.activeId == conn.id;
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: isActive
              ? colorScheme.primaryContainer
              : colorScheme.surfaceContainerHighest,
          child: Icon(
            isActive ? Icons.check : Icons.account_balance_wallet_outlined,
            color: isActive ? colorScheme.primary : colorScheme.onSurfaceVariant,
            size: 20,
          ),
        ),
        title: Text(
          conn.alias,
          style: TextStyle(
            fontWeight: isActive ? FontWeight.bold : FontWeight.normal,
          ),
        ),
        subtitle: Text(
          '${conn.walletPubkey.substring(0, 8)}…${conn.walletPubkey.substring(conn.walletPubkey.length - 4)}',
          style: Theme.of(context).textTheme.bodySmall,
        ),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (!isActive)
              TextButton(
                onPressed: () =>
                    ref.read(nwcNotifierProvider.notifier).setActive(conn.id),
                child: const Text('Switch'),
              ),
            IconButton(
              icon: const Icon(Icons.delete_outline, size: 20),
              tooltip: 'Remove',
              onPressed: () => _remove(conn.id),
            ),
          ],
        ),
        onTap: isActive
            ? null
            : () => ref.read(nwcNotifierProvider.notifier).setActive(conn.id),
      ),
    );
  }

  // ── Actions ──────────────────────────────────────────────────────────

  Future<void> _connect(BuildContext context) async {
    final uri = _uriController.text.trim();
    if (uri.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please enter a NWC URI')),
      );
      return;
    }

    // Validate format before calling the service
    if (NwcService.parseUri(uri) == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content:
                Text('Invalid NWC URI format. Expected nostr+walletconnect://…')),
      );
      return;
    }

    final alias = _aliasController.text.trim().isEmpty
        ? null
        : _aliasController.text.trim();

    final ok = await ref
        .read(nwcNotifierProvider.notifier)
        .addConnection(uri, alias: alias);

    if (ok && context.mounted) {
      _uriController.clear();
      _aliasController.clear();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Wallet connected')),
      );
    }
  }

  Future<void> _disconnect(String id) async {
    await ref.read(nwcNotifierProvider.notifier).removeConnection(id);
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Wallet disconnected')),
      );
    }
  }

  Future<void> _remove(String id) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Remove Connection'),
        content: const Text(
            'Remove this wallet connection? This does not affect the wallet itself.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      await ref.read(nwcNotifierProvider.notifier).removeConnection(id);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Connection removed')),
        );
      }
    }
  }
}

/// QR code scanner view using mobile_scanner (actively maintained, works on
/// iOS/Android including arm64 simulators, compatible with modern AGP).
class _QrScannerView extends StatefulWidget {
  final ValueChanged<String> onScanned;

  const _QrScannerView({required this.onScanned});

  @override
  State<_QrScannerView> createState() => _QrScannerViewState();
}

class _QrScannerViewState extends State<_QrScannerView> {
  final MobileScannerController _controller = MobileScannerController();
  bool _scanned = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // NO scanWindow. The old one was built from the SCREEN's centre
    // (MediaQuery.size.center), but this scanner lives in a 280px card part
    // way down a ListView — so the detection rect sat offset from the camera
    // view and any QR outside that offset never scanned. Scanning the full
    // frame and letting the overlay just *look* like a window is both simpler
    // and correct; the overlay is cosmetic, the detection is not.
    return MobileScanner(
      controller: _controller,
      onDetect: (capture) {
        if (_scanned) return;
        final barcode = capture.barcodes.firstOrNull;
        final code = barcode?.rawValue;
        if (code != null && code.isNotEmpty) {
          _scanned = true;
          widget.onScanned(code);
        }
      },
      overlayBuilder: (context, constraints) {
        return Container(
          decoration: ShapeDecoration(
            shape: QrScannerOverlayShape(
              borderColor: Theme.of(context).colorScheme.primary,
              borderRadius: 12,
              borderLength: 24,
              borderWidth: 6,
              cutOutSize: 220,
            ),
          ),
        );
      },
    );
  }
}

/// Overlay shape that paints a transparent cut-out with corner brackets,
/// mimicking the classic QR scanner look.
class QrScannerOverlayShape extends ShapeBorder {
  final Color borderColor;
  final double borderRadius;
  final double borderLength;
  final double borderWidth;
  final double cutOutSize;

  const QrScannerOverlayShape({
    required this.borderColor,
    this.borderRadius = 12,
    this.borderLength = 24,
    this.borderWidth = 6,
    this.cutOutSize = 220,
  });

  @override
  EdgeInsetsGeometry get dimensions => EdgeInsets.zero;

  @override
  Path getInnerPath(Rect rect, {TextDirection? textDirection}) => Path();

  @override
  Path getOuterPath(Rect rect, {TextDirection? textDirection}) {
    final cutOut = Rect.fromCenter(
      center: rect.center,
      width: cutOutSize,
      height: cutOutSize,
    );
    return Path.combine(
      PathOperation.difference,
      Path()..addRect(rect),
      Path()
        ..addRRect(
          RRect.fromRectAndRadius(cutOut, Radius.circular(borderRadius)),
        ),
    );
  }

  @override
  void paint(Canvas canvas, Rect rect, {TextDirection? textDirection}) {
    final cutOut = Rect.fromCenter(
      center: rect.center,
      width: cutOutSize,
      height: cutOutSize,
    );
    final rrect = RRect.fromRectAndRadius(
      cutOut,
      Radius.circular(borderRadius),
    );

    // Dim background outside cut-out.
    final backgroundPaint = Paint()
      ..color = Colors.black.withValues(alpha: 0.5)
      ..style = PaintingStyle.fill;
    final backgroundPath = Path.combine(
      PathOperation.difference,
      Path()..addRect(rect),
      Path()..addRRect(rrect),
    );
    canvas.drawPath(backgroundPath, backgroundPaint);

    // Corner brackets.
    final bracketPaint = Paint()
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
      radius: Radius.circular(borderRadius),
    );
    path.lineTo(rrect.left + borderLength, rrect.top);
    // Top-right
    path.moveTo(rrect.right - borderLength, rrect.top);
    path.lineTo(rrect.right - borderRadius, rrect.top);
    path.arcToPoint(
      Offset(rrect.right, rrect.top + borderRadius),
      radius: Radius.circular(borderRadius),
    );
    path.lineTo(rrect.right, rrect.top + borderLength);
    // Bottom-right
    path.moveTo(rrect.right, rrect.bottom - borderLength);
    path.lineTo(rrect.right, rrect.bottom - borderRadius);
    path.arcToPoint(
      Offset(rrect.right - borderRadius, rrect.bottom),
      radius: Radius.circular(borderRadius),
    );
    path.lineTo(rrect.right - borderLength, rrect.bottom);
    // Bottom-left
    path.moveTo(rrect.left + borderLength, rrect.bottom);
    path.lineTo(rrect.left + borderRadius, rrect.bottom);
    path.arcToPoint(
      Offset(rrect.left, rrect.bottom - borderRadius),
      radius: Radius.circular(borderRadius),
    );
    path.lineTo(rrect.left, rrect.bottom - borderLength);

    canvas.drawPath(path, bracketPaint);
  }

  @override
  ShapeBorder scale(double t) => this;
}
