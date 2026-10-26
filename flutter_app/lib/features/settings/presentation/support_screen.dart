import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:qr_flutter/qr_flutter.dart';

import 'package:nostrfeed_mobile/core/theme/app_shapes.dart';
import 'package:nostrfeed_mobile/core/theme/app_spacing.dart';
import 'package:nostrfeed_mobile/core/theme/app_theme.dart';
import 'package:nostrfeed_mobile/core/widgets/app_button.dart';
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';
import 'package:nostrfeed_mobile/core/widgets/app_sheet.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/core/widgets/detail_scaffold.dart';
import 'package:nostrfeed_mobile/core/widgets/pay_invoice_sheet.dart';
import 'package:nostrfeed_mobile/features/wallet/data/lnurl_service.dart';
// ignore_for_file: directives_ordering

/// Support NostrFeed — donation addresses (QR + copy) and a Lightning
/// address for direct support payments.
///
/// The addresses are the operator's, hardcoded deliberately (a support page
/// that read them from a relay could be redirected by a compromised relay —
/// the donation target must be a build-time constant).
class SupportScreen extends ConsumerWidget {
  const SupportScreen({super.key});

  /// Lightning address for direct support payments (LNURL-pay).
  static const lightningAddress = 'kk@getzap.me';

  /// On-chain donation addresses. `data` is what the QR encodes (chain
  /// URI schemes where they exist — wallets prefill address + chain).
  static const _addresses = [
    _DonationAddress(
      icon: 'zap',
      chain: 'Bitcoin (BTC)',
      address: 'bc1qyfhl8hsh00supfztl9wr0rwaszgapkrqc5hl5c',
      qrData: 'bitcoin:bc1qyfhl8hsh00supfztl9wr0rwaszgapkrqc5hl5c',
      note: 'On-chain, SegWit (bc1q…)',
    ),
    _DonationAddress(
      icon: 'zap',
      chain: 'Bitcoin (Taproot)',
      address:
          'bc1plqfwrm9gzgfnx7s04akar8aekjzcse7efx0el35pl8muy07gea2skryd2e',
      qrData:
          'bitcoin:bc1plqfwrm9gzgfnx7s04akar8aekjzcse7efx0el35pl8muy07gea2skryd2e',
      note: 'On-chain, Taproot (bc1p…)',
    ),
    _DonationAddress(
      icon: 'globe',
      chain: 'Solana (SOL)',
      address: '9e2oxWMq9pkFCCpyw8JjSmzXVwMxkJsKPFJ7JhpspDG9',
      qrData: 'solana:9e2oxWMq9pkFCCpyw8JjSmzXVwMxkJsKPFJ7JhpspDG9',
      note: 'SOL + SPL tokens',
    ),
    _DonationAddress(
      icon: 'wallet',
      chain: 'Ethereum / EVM',
      address: '0xfa2521dbfe0c772e0264f8bf0a445ca11b692374',
      qrData: 'ethereum:0xfa2521dbfe0c772e0264f8bf0a445ca11b692374',
      note: 'ETH, USDT, USDC — any EVM chain',
    ),
  ];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final textTheme = Theme.of(context).textTheme;
    final scheme = Theme.of(context).colorScheme;

    return DetailScaffold(
      title: 'Support NostrFeed',
      body: ListView(
        padding: const EdgeInsets.all(AppSpacing.md),
        children: [
          // Hero — honest, no guilt-tripping.
          Text(
            'Keep the relays running ⚡',
            style: textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            'NostrFeed is built by a small team. Relay hosting, development '
            'and the free tier are paid out of pocket — every zap and '
            'donation keeps the lights on.',
            style: textTheme.bodyMedium?.copyWith(
              color: scheme.onSurfaceVariant,
              height: 1.45,
            ),
          ),
          const SizedBox(height: AppSpacing.lg),

          // Lightning — the primary lane (one-tap pay inside the app).
          _LightningCard(),
          const SizedBox(height: AppSpacing.lg),

          Text(
            'ON-CHAIN ADDRESSES',
            style: textTheme.labelSmall?.copyWith(
              color: scheme.onSurfaceVariant,
              letterSpacing: 1.1,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          for (final a in _addresses) ...[
            _AddressCard(address: a),
            const SizedBox(height: AppSpacing.sm),
          ],

          const SizedBox(height: AppSpacing.md),
          Text(
            'Always double-check the network before sending — payments on '
            'the wrong chain can\'t be recovered.',
            style: textTheme.bodySmall?.copyWith(
              color: scheme.onSurfaceVariant,
              height: 1.4,
            ),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}

// ─── Lightning card (kk@getzap.me) ────────────────────────────────────

class _LightningCard extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;

    return Container(
      padding: AppSpacing.paddingMd,
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLowest,
        borderRadius: AppShapes.radiusLg,
        border: Border.all(color: scheme.outlineVariant),
      ),
      child: Column(
        children: [
          Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: AppActionColors.zap.withValues(alpha: 0.12),
                  shape: BoxShape.circle,
                ),
                child: Center(
                  child: AppIcon(
                    'zap',
                    size: AppIconSize.lg,
                    color: AppActionColors.zapFor(scheme.brightness),
                  ),
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Lightning ⚡ (recommended)',
                      style: textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    Text(
                      SupportScreen.lightningAddress,
                      style: textTheme.bodySmall?.copyWith(
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          Center(
            child: Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: Colors.white, // token-guard: allow — QR contrast
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: scheme.outlineVariant),
              ),
              child: QrImageView(
                data: 'lightning:${SupportScreen.lightningAddress}',
                size: 200,
                backgroundColor: Colors.white, // token-guard: allow — QR
                errorCorrectionLevel: QrErrorCorrectLevel.M,
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          Row(
            children: [
              Expanded(
                child: AppButton.secondary(
                  icon: Icons.copy_rounded,
                  label: 'Copy address',
                  onPressed: () {
                    Clipboard.setData(
                      const ClipboardData(text: SupportScreen.lightningAddress),
                    );
                    AppToast.success(context, 'Lightning address copied');
                  },
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: AppButton.primary(
                  icon: Icons.bolt_rounded,
                  label: 'Pay support',
                  onPressed: () => _showSupportPaySheet(context),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  /// The zap-style amount picker (Primal preset grid + custom), then LNURL
  /// → invoice → the shared pay sheet. Same feel as zapping a post.
  Future<void> _showSupportPaySheet(BuildContext context) async {
    final sats = await AppSheet.show<int>(
      context,
      child: const _SupportAmountSheet(),
    );
    if (sats == null || sats <= 0 || !context.mounted) return;

    final info = await resolveLnurlPay(SupportScreen.lightningAddress);
    if (!context.mounted) return;
    if (info == null) {
      AppToast.error(context, 'Could not resolve the lightning address');
      return;
    }
    final invoice = await fetchInvoice(info: info, sats: sats);
    if (!context.mounted) return;
    if (invoice == null) {
      AppToast.error(context, 'Could not fetch an invoice');
      return;
    }
    await showPayInvoiceSheet(
      context,
      title: 'Support NostrFeed ⚡',
      bolt11: invoice,
      amountSats: sats,
      memo: 'Support NostrFeed',
      checkPaid: () async => true,
    );
  }
}

// ─── Support amount sheet (Primal zap-preset grid) ─────────────────────

/// The amount picker for support payments — Primal's exact zap preset grid
/// (👍21 🚀420 ☕1k 🍻5k 🍷10k 👑100k) + a custom field, so paying support
/// feels identical to zapping a post.
class _SupportAmountSheet extends ConsumerStatefulWidget {
  const _SupportAmountSheet();

  @override
  ConsumerState<_SupportAmountSheet> createState() =>
      _SupportAmountSheetState();
}

class _SupportAmountSheetState extends ConsumerState<_SupportAmountSheet> {
  final _customController = TextEditingController();
  int _selected = 1000;
  bool _custom = false;

  /// Primal's zap presets (`ZapBottomSheet` defaults) — the emoji IS the
  /// amount's identity in Nostr culture.
  static const _presets = [
    (emoji: '👍', amount: 21),
    (emoji: '🚀', amount: 420),
    (emoji: '☕', amount: 1000),
    (emoji: '🍻', amount: 5000),
    (emoji: '🍷', amount: 10000),
    (emoji: '👑', amount: 100000),
  ];

  static String _fmt(int sats) {
    if (sats >= 1000000) return '${(sats / 1000000).toStringAsFixed(0)}M';
    if (sats >= 1000) return '${(sats / 1000).toStringAsFixed(0)}k';
    return '$sats';
  }

  @override
  void dispose() {
    _customController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final chosen = _custom
        ? (int.tryParse(_customController.text.trim()) ?? 0)
        : _selected;

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'Support with a zap ⚡',
              style: textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            // 3-column preset grid (Primal's ZapBottomSheet cells).
            GridView.count(
              crossAxisCount: 3,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              mainAxisSpacing: 10,
              crossAxisSpacing: 10,
              childAspectRatio: 1.4,
              children: [
                for (final p in _presets)
                  _PresetCell(
                    emoji: p.emoji,
                    amount: p.amount,
                    selected: !_custom && _selected == p.amount,
                    onTap: () => setState(() {
                      _custom = false;
                      _selected = p.amount;
                    }),
                  ),
              ],
            ),
            const SizedBox(height: AppSpacing.md),
            // Custom amount.
            TextField(
              controller: _customController,
              keyboardType: TextInputType.number,
              decoration: InputDecoration(
                hintText: 'Custom amount (sats)',
                prefixIcon: const AppIcon('zap', size: AppIconSize.md),
                filled: true,
                fillColor: scheme.surfaceContainerHighest,
                border: OutlineInputBorder(
                  borderRadius: AppShapes.radiusMd,
                  borderSide: BorderSide.none,
                ),
              ),
              onChanged: (_) => setState(() => _custom = true),
              onTap: () => setState(() => _custom = true),
            ),
            const SizedBox(height: AppSpacing.md),
            AppButton.primary(
              expand: true,
              icon: Icons.bolt_rounded,
              label: chosen > 0 ? 'Pay ${_fmt(chosen)} sats' : 'Enter an amount',
              onPressed: chosen > 0
                  ? () => Navigator.pop(context, chosen)
                  : null,
            ),
          ],
        ),
      ),
    );
  }
}

/// One preset cell in the support amount grid (Primal's _ZapPresetCell).
class _PresetCell extends StatelessWidget {
  final String emoji;
  final int amount;
  final bool selected;
  final VoidCallback onTap;

  const _PresetCell({
    required this.emoji,
    required this.amount,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Material(
      color: selected ? scheme.surface : scheme.surfaceContainerHighest,
      borderRadius: AppShapes.radiusMd,
      child: InkWell(
        onTap: onTap,
        borderRadius: AppShapes.radiusMd,
        child: Container(
          decoration: BoxDecoration(
            borderRadius: AppShapes.radiusMd,
            border: selected
                ? Border.all(color: scheme.tertiary, width: 1)
                : null,
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(emoji, style: const TextStyle(fontSize: 22)),
              const SizedBox(height: 2),
              Text(
                _SupportAmountSheetState._fmt(amount),
                style: Theme.of(context).textTheme.labelMedium?.copyWith(
                      fontWeight: FontWeight.w700,
                      color: selected
                          ? scheme.tertiary
                          : scheme.onSurfaceVariant,
                    ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ─── One on-chain address card ─────────────────────────────────────────

class _AddressCard extends StatelessWidget {
  final _DonationAddress address;
  const _AddressCard({required this.address});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;

    return Container(
      padding: AppSpacing.paddingMd,
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLowest,
        borderRadius: AppShapes.radiusLg,
        border: Border.all(color: scheme.outlineVariant),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              AppIcon(address.icon, size: AppIconSize.lg, color: scheme.primary),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      address.chain,
                      style: textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    if (address.note != null)
                      Text(
                        address.note!,
                        style: textTheme.bodySmall?.copyWith(
                          color: scheme.onSurfaceVariant,
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          Center(
            child: Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.white, // token-guard: allow — QR contrast
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: scheme.outlineVariant),
              ),
              child: QrImageView(
                data: address.qrData,
                size: 170,
                backgroundColor: Colors.white, // token-guard: allow — QR
                errorCorrectionLevel: QrErrorCorrectLevel.M,
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: scheme.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(10),
            ),
            child: SelectableText(
              address.address,
              style: const TextStyle(fontFamily: 'monospace', fontSize: 11),
              maxLines: 3,
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          AppButton.secondary(
            expand: true,
            icon: Icons.copy_rounded,
            label: 'Copy address',
            onPressed: () {
              Clipboard.setData(ClipboardData(text: address.address));
              AppToast.success(context, '${address.chain} address copied');
            },
          ),
        ],
      ),
    );
  }
}

class _DonationAddress {
  final String icon;
  final String chain;
  final String address;
  final String qrData;
  final String? note;
  const _DonationAddress({
    required this.icon,
    required this.chain,
    required this.address,
    required this.qrData,
    this.note,
  });
}
