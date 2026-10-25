import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import 'package:nostrfeed_mobile/core/theme/app_shapes.dart';
import 'package:nostrfeed_mobile/core/theme/app_spacing.dart';
import 'package:nostrfeed_mobile/core/theme/app_theme.dart';
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/features/wallet/application/nwc_providers.dart';
import 'package:nostrfeed_mobile/features/wallet/data/nwc_service.dart';

/// NWC Wallet Connect screen: paste URI, scan QR, or pick a saved
/// connection. Redesigned for attractiveness + every device:
///
/// - **Adaptive**: content centers with a 560dp max width on tablets /
///   desktop (mobile uses full width) — never a stretched-out form on a
///   12" screen.
/// - **Larger**: hero header, comfortable type, 48dp touch targets (the
///   "make it bigger" ask) — still token-based, never magic numbers.
/// - **Attractive**: a brand-gradient hero card + wallet-brand chips +
///   clearer visual hierarchy (connect → scan → saved → about).
class NwcScreen extends ConsumerStatefulWidget {
  const NwcScreen({super.key});

  @override
  ConsumerState<NwcScreen> createState() => _NwcScreenState();
}

class _NwcScreenState extends ConsumerState<NwcScreen> {
  final _uriController = TextEditingController();
  final _aliasController = TextEditingController();
  bool _showScanner = false;

  /// Content max width on large screens (tablet/desktop) — the form reads
  /// at a comfortable measure instead of stretching edge-to-edge.
  static const double _contentMaxWidth = 560;

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
        title: const Text('Wallet Connect'),
      ),
      body: LayoutBuilder(
        builder: (context, constraints) {
          final isWide = constraints.maxWidth > _contentMaxWidth + 2 * 32;
          return Align(
            alignment: Alignment.topCenter,
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: _contentMaxWidth),
              child: ListView(
                padding: EdgeInsets.symmetric(
                  horizontal: isWide ? AppSpacing.lg : AppSpacing.md,
                  vertical: AppSpacing.md,
                ),
                children: [
                  _heroCard(colorScheme: colorScheme),

                  // ── Active connection ───────────────────────────────
                  if (nwcState.isConnected &&
                      nwcState.activeConnection != null) ...[
                    AppSpacing.gapMd,
                    _activeConnectionCard(context, nwcState, colorScheme),
                  ],

                  // ── Error ───────────────────────────────────────────
                  if (nwcState.error != null) ...[
                    AppSpacing.gapMd,
                    _errorCard(context, nwcState, colorScheme),
                  ],

                  AppSpacing.gapMd,
                  _connectCard(context, nwcState, colorScheme),

                  // ── QR Scanner ──────────────────────────────────────
                  if (_showScanner) ...[
                    AppSpacing.gapMd,
                    Card(
                      clipBehavior: Clip.antiAlias,
                      child: SizedBox(
                        height: 300,
                        child: _QrScannerView(
                          onScanned: (value) {
                            _uriController.text = value;
                            setState(() => _showScanner = false);
                            _connect(context);
                          },
                        ),
                      ),
                    ),
                  ],

                  // ── Saved connections ───────────────────────────────
                  if (nwcState.connections.isNotEmpty) ...[
                    AppSpacing.gapLg,
                    Text(
                      'Saved connections',
                      style: Theme.of(context).textTheme.titleSmall?.copyWith(
                            color: colorScheme.onSurfaceVariant,
                            fontWeight: FontWeight.bold,
                          ),
                    ),
                    AppSpacing.gapSm,
                    ...nwcState.connections.map(
                      (conn) =>
                          _connectionTile(context, conn, nwcState, colorScheme),
                    ),
                  ],

                  AppSpacing.gapLg,
                  _aboutCard(context, colorScheme),
                  AppSpacing.gapMd,
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  // ── Sections ─────────────────────────────────────────────────────────

  /// The brand-gradient hero: what this screen IS, at a glance.
  Widget _heroCard({required ColorScheme colorScheme}) {
    return Container(
      decoration: BoxDecoration(
        gradient: AppTheme.brandGradient,
        borderRadius: AppShapes.radiusLg,
      ),
      padding: AppSpacing.paddingLg,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: AppSpacing.paddingSm,
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.18),
              borderRadius: AppShapes.radiusMd,
            ),
            child: const AppIcon('link', size: AppIconSize.xl, color: Colors.white),
          ),
          AppSpacing.gapMd,
          Text(
            'Connect your wallet',
            style: Theme.of(context).textTheme.titleLarge?.copyWith(
                  color: Colors.white,
                  fontWeight: FontWeight.bold,
                ),
          ),
          AppSpacing.gapXs,
          Text(
            'Pay invoices and receive zaps straight from NostrFeed with any NWC wallet.',
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: Colors.white.withValues(alpha: 0.85),
                  height: 1.35,
                ),
          ),
        ],
      ),
    );
  }

  Widget _errorCard(
    BuildContext context,
    NwcState state,
    ColorScheme colorScheme,
  ) {
    return Card(
      color: colorScheme.errorContainer,
      child: Padding(
        padding: AppSpacing.paddingMd,
        child: Row(
          children: [
            AppIcon('eye_off', color: colorScheme.error),
            AppSpacing.gapSm,
            Expanded(
              child: Text(
                state.error!,
                style: TextStyle(color: colorScheme.onErrorContainer),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _connectCard(
    BuildContext context,
    NwcState state,
    ColorScheme colorScheme,
  ) {
    return Card(
      child: Padding(
        padding: AppSpacing.paddingLg,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'New connection',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
            ),
            AppSpacing.gapMd,
            TextField(
              controller: _uriController,
              style: Theme.of(context).textTheme.bodyLarge,
              decoration: InputDecoration(
                labelText: 'Connection URI',
                hintText: 'nostr+walletconnect://…',
                prefixIcon: const AppIcon('zap', size: AppIconSize.md),
                suffixIcon: IconButton(
                  icon: const AppIcon('edit', size: AppIconSize.md),
                  tooltip: 'Paste',
                  onPressed: () async {
                    final data = await Clipboard.getData('text/plain');
                    if (data?.text != null) {
                      _uriController.text = data!.text!;
                    }
                  },
                ),
                border: OutlineInputBorder(borderRadius: AppShapes.radiusMd),
              ),
              maxLines: 2,
              minLines: 1,
            ),
            AppSpacing.gapMd,
            TextField(
              controller: _aliasController,
              style: Theme.of(context).textTheme.bodyLarge,
              decoration: InputDecoration(
                labelText: 'Name it (optional)',
                hintText: 'My Alby wallet',
                prefixIcon: const AppIcon('hash', size: AppIconSize.md),
                border: OutlineInputBorder(borderRadius: AppShapes.radiusMd),
              ),
            ),
            AppSpacing.gapMd,
            _WalletChips(colorScheme: colorScheme),
            AppSpacing.gapLg,
            // Bigger, clearer actions — scan is the PRIMARY happy path.
            FilledButton.icon(
              style: FilledButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 14),
              ),
              onPressed: () => setState(() => _showScanner = !_showScanner),
              icon: AppIcon(
                _showScanner ? 'eye_off' : 'qr',
                size: AppIconSize.md,
                color: colorScheme.onPrimary,
              ),
              label: Text(_showScanner ? 'Hide scanner' : 'Scan QR code'),
            ),
            AppSpacing.gapSm,
            OutlinedButton.icon(
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 14),
              ),
              onPressed: state.isLoading ? null : () => _connect(context),
              icon: state.isLoading
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : AppIcon('link', size: AppIconSize.md, color: colorScheme.primary),
              label: const Text('Connect with URI'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _aboutCard(BuildContext context, ColorScheme colorScheme) {
    return Card(
      color: colorScheme.surfaceContainerHighest,
      child: Padding(
        padding: AppSpacing.paddingMd,
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            AppIcon('eye', size: AppIconSize.md, color: colorScheme.onSurfaceVariant),
            AppSpacing.gapSm,
            Expanded(
              child: Text(
                'Nostr Wallet Connect (NIP-47) links a remote Lightning wallet '
                'so you can pay and receive without leaving the app. Your '
                'keys stay in the wallet — NostrFeed never sees them.',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: colorScheme.onSurfaceVariant,
                      height: 1.4,
                    ),
              ),
            ),
          ],
        ),
      ),
    );
  }

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
        padding: AppSpacing.paddingMd,
        child: Row(
          children: [
            Container(
              padding: AppSpacing.paddingSm,
              decoration: BoxDecoration(
                color: colorScheme.primary.withValues(alpha: 0.15),
                shape: BoxShape.circle,
              ),
              child: AppIcon('check', color: colorScheme.primary),
            ),
            AppSpacing.gapMd,
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    conn.alias,
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.bold,
                          color: colorScheme.onPrimaryContainer,
                        ),
                  ),
                  if (service?.info != null)
                    Text(
                      '${service!.info!.network ?? "unknown"} · '
                      '${service.info!.methods.length} methods',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: colorScheme.onPrimaryContainer
                                .withValues(alpha: 0.7),
                          ),
                    ),
                  if (state.balanceSats != null)
                    Text(
                      '${state.balanceSats} sats',
                      style: Theme.of(context).textTheme.titleSmall?.copyWith(
                            color: colorScheme.onPrimaryContainer,
                            fontWeight: FontWeight.w600,
                          ),
                    ),
                ],
              ),
            ),
            IconButton(
              icon: AppIcon('eye_off', color: colorScheme.onPrimaryContainer),
              tooltip: 'Disconnect',
              onPressed: () => _disconnect(conn.id),
            ),
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
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md,
          vertical: AppSpacing.xs,
        ),
        leading: CircleAvatar(
          backgroundColor: isActive
              ? colorScheme.primaryContainer
              : colorScheme.surfaceContainerHighest,
          child: AppIcon(
            isActive ? 'check' : 'wallet',
            size: AppIconSize.md,
            color: isActive ? colorScheme.primary : colorScheme.onSurfaceVariant,
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
        trailing: isActive
            ? null
            : TextButton(
                onPressed: () =>
                    ref.read(nwcNotifierProvider.notifier).setActive(conn.id),
                child: const Text('Switch'),
              ),
        onTap: isActive
            ? null
            : () => ref.read(nwcNotifierProvider.notifier).setActive(conn.id),
        onLongPress: () => _remove(conn.id),
      ),
    );
  }

  // ── Actions ──────────────────────────────────────────────────────────

  Future<void> _connect(BuildContext context) async {
    final uri = _uriController.text.trim();
    if (uri.isEmpty) {
      AppToast.warning(context, 'Please enter a NWC URI');
      return;
    }
    if (NwcService.parseUri(uri) == null) {
      AppToast.error(
          context, 'Invalid NWC URI format. Expected nostr+walletconnect://…');
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
      AppToast.success(context, 'Wallet connected');
    }
  }

  Future<void> _disconnect(String id) async {
    await ref.read(nwcNotifierProvider.notifier).removeConnection(id);
    if (mounted) {
      AppToast.success(context, 'Wallet disconnected');
    }
  }

  Future<void> _remove(String id) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Remove connection'),
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
        AppToast.success(context, 'Connection removed');
      }
    }
  }
}

/// The supported-wallet chips — users instantly see which wallets work.
class _WalletChips extends StatelessWidget {
  const _WalletChips({required this.colorScheme});

  final ColorScheme colorScheme;

  static const _wallets = [
    'Alby',
    'Zeus',
    'WoS',
    'Phoenix',
    'Breez',
    'Alby Hub',
  ];

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: AppSpacing.xs,
      runSpacing: AppSpacing.xs,
      children: [
        for (final w in _wallets)
          Container(
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.sm,
              vertical: 6,
            ),
            decoration: BoxDecoration(
              color: colorScheme.primaryContainer.withValues(alpha: 0.4),
              borderRadius: AppShapes.radiusPill,
            ),
            child: Text(
              w,
              style: Theme.of(context).textTheme.labelMedium?.copyWith(
                    color: colorScheme.primary,
                    fontWeight: FontWeight.w600,
                  ),
            ),
          ),
      ],
    );
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
    // NO scanWindow — the old one was built from the SCREEN's centre while
    // the scanner lives in a card part-way down a ListView, so the detection
    // rect sat offset from the camera view. Full-frame detection + a cosmetic
    // overlay is both simpler and correct.
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
      ..color = Colors.black.withValues(alpha: 0.5) // token-guard: allow — QR scrim
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
