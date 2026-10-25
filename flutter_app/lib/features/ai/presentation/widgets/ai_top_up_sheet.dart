import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nostrfeed_mobile/core/providers/auth_providers.dart';
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';
import 'package:nostrfeed_mobile/core/widgets/app_sheet.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/core/widgets/pay_invoice_sheet.dart';
import 'package:nostrfeed_mobile/features/ai/application/ai_providers.dart';
import 'package:nostrfeed_mobile/features/ai/domain/ai_credits.dart';

/// AI credits top-up: pick a token pack or enter a custom token amount
/// (+3% processing) → house-wallet invoice priced in SATS at the LIVE
/// exchange rate → pay with any wallet (in-app or QR scan) → LNbits
/// confirms → tokens land.
///
/// The pack is what the user GETS (tokens, dollar-pegged); the sats price
/// is computed at purchase time from `aiSatsPerUsdProvider` plus the
/// config's volatility buffer, so the operator always receives the pack's
/// full USD value in sats.
Future<void> showAiTopUpSheet(BuildContext context) {
  return AppSheet.show(context, child: const _AiTopUpSheet());
}

/// Custom amounts carry a 3% processing fee — preset packs do not. The fee
/// is charged on the sats price of the custom amount (on top, not eaten out
/// of it — "3% extra cost").
const manualFeePercent = 3;

/// Smallest custom amount — 10 tokens (≈ 1¢). Preset packs start at 1,000.
const minCustomTokens = 10;

class _AiTopUpSheet extends ConsumerStatefulWidget {
  const _AiTopUpSheet();

  @override
  ConsumerState<_AiTopUpSheet> createState() => _AiTopUpSheetState();
}

class _AiTopUpSheetState extends ConsumerState<_AiTopUpSheet> {
  final _customController = TextEditingController();

  /// The app's root overlay context, captured synchronously in initState
  /// (no async gap) — the pay sheet opens on it after this sheet closes.
  /// Never this sheet's own context, which dies with it.
  BuildContext? _overlayContext;

  @override
  void initState() {
    super.initState();
    _overlayContext = AppSheet.rootOverlayContext(context);
  }

  @override
  void dispose() {
    _customController.dispose();
    super.dispose();
  }

  int? get _customTokens {
    final v = int.tryParse(_customController.text.trim());
    return v != null && v >= minCustomTokens ? v : null;
  }

  /// Sats price for a token amount at the current rate (+ volatility buffer
  /// so BTC moving between quote and settlement never shorts the operator).
  int _satsFor(int tokens) {
    final satsPerUsd =
        ref.read(aiSatsPerUsdProvider).value ?? kFallbackSatsPerUsd;
    final buffer =
        ref.read(aiGatewayConfigProvider).value?.volatilityBuffer ?? 0.03;
    final usd = tokens / tokensPerUsd;
    return (usd * satsPerUsd * (1 + buffer)).ceil();
  }

  /// The custom amount's sats total: its token price + the 3% fee (ceil so
  /// the fee is never fractional).
  int get _customTotalSats {
    final base = _satsFor(_customTokens ?? 0);
    return base + ((base * manualFeePercent + 99) ~/ 100);
  }

  bool _buying = false;
  bool _restoring = false;

  Future<void> _buy({
    required int tokens,
    required int creditsGranted,
    required int priceSats,
    String? memoNote,
  }) async {
    if (_buying) return;
    final service = ref.read(aiCreditsServiceProvider);
    if (!service.canTopUp) {
      AppToast.error(
        context,
        'Top-up is not available in this build (no house wallet configured).',
      );
      return;
    }

    setState(() => _buying = true);
    try {
      final pubkey = ref.read(authStateProvider).pubkey ?? 'anonymous';
      final short = pubkey.length > 12 ? pubkey.substring(0, 12) : pubkey;

      // Mint the invoice for the SATS price of the token pack. On failure
      // the sheet STAYS open with the error visible — popping first was why
      // "click pack does nothing".
      final pack = AiCreditPack(tokens, bonusTokens: creditsGranted - tokens);
      final invoice = await service.createTopUpInvoice(
        pack,
        priceSats: priceSats,
        buyerPubkey: short,
        memoNote: memoNote,
      );
      if (!mounted) return;
      if (invoice.bolt11.isEmpty) {
        if (context.mounted) {
          AppToast.error(
            context,
            'The wallet returned no invoice. Check the house-wallet key.',
          );
        }
        return;
      }

      // The pay sheet opens on the ROOT overlay context — the app's root,
      // captured in initState (no async gap) — never this sheet's own
      // context, which dies the moment it closes.
      final overlayContext = _overlayContext;
      Navigator.of(context).pop();
      if (overlayContext == null) return;

      final result = await showPayInvoiceSheet(
        // Captured in initState (no async gap) — the root overlay outlives
        // this sheet, which is exactly why it's used.
        // ignore: use_build_context_synchronously
        overlayContext,
        title: 'AI credits — ${pack.label}',
        bolt11: invoice.bolt11,
        amountSats: priceSats,
        memo: memoNote,
        checkPaid: () => service.checkTopUpPaid(invoice),
      );

      if (!mounted) return;
      if (result == InvoicePayResult.paid) {
        await ref
            .read(aiCreditsProvider.notifier)
            .creditPayment(creditsGranted, invoice.paymentHash);
        if (!mounted) return;
        if (context.mounted) {
          AppToast.success(context, '$creditsGranted AI tokens added');
        }
      } else {
        // The sheet closed without a confirmed payment. If the user actually
        // paid (external wallet, or closed mid-confirm) the settled invoice
        // is found by the refresh — recover the credits right now instead of
        // leaving the user at 0 until the next sync tick.
        final pubkey = ref.read(authStateProvider).pubkey;
        if (pubkey != null && pubkey.isNotEmpty) {
          final before = ref.read(aiCreditsProvider).valueOrNull?.balance ?? 0;
          await ref.read(aiCreditsProvider.notifier).refresh(pubkey);
          if (!mounted) return;
          final after = ref.read(aiCreditsProvider).valueOrNull?.balance ?? 0;
          if (after > before && context.mounted) {
            AppToast.success(context, '${after - before} AI tokens recovered');
          }
        }
      }
    } catch (e) {
      if (!mounted) return;
      AppToast.error(context, 'Could not create the invoice: $e');
    } finally {
      if (mounted) setState(() => _buying = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final balance = ref.watch(aiCreditsProvider).valueOrNull?.balance ?? 0;
    // Watch the rate so pack sats prices re-render when it lands/updates.
    final rateAsync = ref.watch(aiSatsPerUsdProvider);

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      'AI credits',
                      style: theme.textTheme.titleLarge?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                  IconButton(
                    icon: const AppIcon('plus'),
                    onPressed: () => Navigator.of(context).pop(),
                  ),
                ],
              ),
              Text(
                'Balance: $balance tokens · 1,000 tokens = \$1 of AI',
                style: TextStyle(fontSize: 13, color: scheme.onSurfaceVariant),
              ),
              const SizedBox(height: 16),

              // Preset packs — flat price, no fee, sats at the live rate.
              for (final pack in aiCreditPacks) ...[
                _PackTile(
                  pack: pack,
                  priceSats: rateAsync.isLoading ? null : _satsFor(pack.tokens),
                  onTap: () => _buy(
                    tokens: pack.tokens,
                    creditsGranted: pack.creditsGranted,
                    priceSats: _satsFor(pack.tokens),
                    memoNote: pack.bonusTokens > 0
                        ? '+${pack.bonusTokens} bonus'
                        : null,
                  ),
                ),
                const SizedBox(height: 10),
              ],

              // Custom amount — +3% processing.
              Row(
                children: [
                  Expanded(child: Divider(color: scheme.outlineVariant)),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 10),
                    child: Text(
                      'or a custom amount',
                      style: TextStyle(
                        fontSize: 11,
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                  Expanded(child: Divider(color: scheme.outlineVariant)),
                ],
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _customController,
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                onChanged: (_) => setState(() {}),
                decoration: InputDecoration(
                  labelText: 'Amount (tokens)',
                  hintText: 'min $minCustomTokens',
                  prefixIcon: AppIcon('edit', size: AppIconSize.md, color: scheme.primary),
                ),
              ),
              const SizedBox(height: 10),
              if (_customTokens != null)
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: scheme.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _feeRow('Tokens', '$_customTokens', scheme),
                      _feeRow(
                        'Price',
                        '${_satsFor(_customTokens!)} sats',
                        scheme,
                      ),
                      _feeRow(
                        'Processing (+$manualFeePercent%)',
                        '${_customTotalSats - _satsFor(_customTokens!)} sats',
                        scheme,
                      ),
                      Divider(height: 14, color: scheme.outlineVariant),
                      _feeRow(
                        'You pay',
                        '$_customTotalSats sats',
                        scheme,
                        bold: true,
                      ),
                    ],
                  ),
                ),
              const SizedBox(height: 10),
              FilledButton.icon(
                onPressed: _customTokens == null
                    ? null
                    : () => _buy(
                        tokens: _customTokens!,
                        creditsGranted: _customTokens!,
                        priceSats: _customTotalSats,
                        memoNote:
                            'custom amount (incl. +$manualFeePercent% fee)',
                      ),
                icon: const AppIcon('zap'),
                label: Text(
                  _customTokens == null
                      ? 'Enter an amount (min $minCustomTokens)'
                      : 'Buy $_customTokens tokens for $_customTotalSats sats',
                ),
              ),

              const SizedBox(height: 12),
              Text(
                'Tokens are dollar-pegged (1,000 = \$1) — a message\'s token '
                'price never moves with Bitcoin. You pay in sats at the live '
                'exchange rate with your in-app wallet or any Lightning '
                'wallet (QR). Custom amounts carry a +$manualFeePercent% '
                'processing fee. Tokens follow your key (backed up to your '
                'relays, reconciled from the wallet).',
                style: TextStyle(
                  fontSize: 11,
                  color: scheme.onSurfaceVariant,
                  height: 1.4,
                ),
              ),
              const SizedBox(height: 8),
              // Recovery: paid but balance didn't move? Re-check the house
              // wallet's history + the relay backup and grant what's owed.
              Center(
                child: TextButton.icon(
                  onPressed: _restoring ? null : _restorePurchases,
                  icon: _restoring
                      ? const SizedBox(
                          width: 14,
                          height: 14,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const AppIcon('repost', size: 16),
                  label: Text(
                    _restoring ? 'Checking…' : 'Paid but no credits? Restore',
                    style: const TextStyle(fontSize: 12),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Manual recovery: re-runs reconcile (house-wallet history) and merges
  /// the relay backup. Finds payments the auto-flow missed (closed sheet,
  /// offline grant, another device) — exactly-once via the recorded hashes.
  Future<void> _restorePurchases() async {
    if (_restoring) return;
    setState(() => _restoring = true);
    try {
      final pubkey = ref.read(authStateProvider).pubkey;
      if (pubkey == null || pubkey.isEmpty) {
        AppToast.info(context, 'Sign in to restore purchases.');
        return;
      }
      // Full refresh: reconcile the wallet history (picks up un-credited
      // payments) AND merge the relay backup (picks up other devices).
      final before = ref.read(aiCreditsProvider).valueOrNull?.balance ?? 0;
      await ref.read(aiCreditsProvider.notifier).refresh(pubkey);
      if (!mounted) return;
      final after = ref.read(aiCreditsProvider).valueOrNull?.balance ?? 0;
      if (!context.mounted) return;
      if (after > before) {
        AppToast.success(context, 'Restored ${after - before} AI tokens');
      } else {
        AppToast.info(context, 'No missing purchases found.');
      }
    } finally {
      if (mounted) setState(() => _restoring = false);
    }
  }

  Widget _feeRow(
    String label,
    String value,
    ColorScheme scheme, {
    bool bold = false,
  }) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: TextStyle(
                fontSize: 13,
                color: scheme.onSurfaceVariant,
                fontWeight: bold ? FontWeight.bold : FontWeight.normal,
              ),
            ),
          ),
          Text(
            value,
            style: TextStyle(
              fontSize: 13,
              fontWeight: bold ? FontWeight.bold : FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }
}

class _PackTile extends StatelessWidget {
  final AiCreditPack pack;

  /// The pack's sats price at the live rate; null while the rate loads
  /// (shows a spinner instead of a stale number).
  final int? priceSats;
  final VoidCallback onTap;

  const _PackTile({
    required this.pack,
    required this.priceSats,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return InkWell(
      borderRadius: BorderRadius.circular(14),
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        decoration: BoxDecoration(
          color: scheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(14),
          border: pack.bonusTokens > 0
              ? Border.all(color: scheme.primary, width: 1.5)
              : null,
        ),
        child: Row(
          children: [
            AppIcon('zap', color: scheme.primary),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    pack.label,
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  Text(
                    pack.bonusTokens > 0
                        ? '${pack.creditsGranted} tokens (+${pack.bonusTokens} bonus · no fee)'
                        : '${pack.creditsGranted} tokens · no fee',
                    style: TextStyle(
                      fontSize: 12,
                      color: pack.bonusTokens > 0
                          ? scheme.primary
                          : scheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
            if (priceSats == null)
              const SizedBox(
                width: 14,
                height: 14,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            else
              Text(
                '$priceSats sats',
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                  color: scheme.onSurface,
                ),
              ),
            const SizedBox(width: 4),
            AppIcon('chevron_r', color: scheme.onSurfaceVariant),
          ],
        ),
      ),
    );
  }
}
