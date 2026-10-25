import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:nostrfeed_mobile/core/config/env.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/theme/app_shapes.dart';
import 'package:nostrfeed_mobile/core/theme/app_spacing.dart';
import 'package:nostrfeed_mobile/core/theme/app_theme.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/core/widgets/detail_scaffold.dart';
import 'package:nostrfeed_mobile/core/widgets/pay_invoice_sheet.dart';
import 'package:nostrfeed_mobile/features/premium/application/premium_providers.dart';
import 'package:nostrfeed_mobile/features/premium/data/admission_service.dart';
import 'package:nostrfeed_mobile/features/premium/presentation/widgets/bunker_card.dart';
import 'package:nostrfeed_mobile/features/premium/presentation/widgets/nwc_provider_card.dart';
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';

/// Premium: verified names (NIP-05) + paid relay + lightning addresses.
class PremiumScreen extends ConsumerStatefulWidget {
  const PremiumScreen({super.key});

  @override
  ConsumerState<PremiumScreen> createState() => _PremiumScreenState();
}

class _PremiumScreenState extends ConsumerState<PremiumScreen> {
  bool _relayBusy = false;

  /// Payment first, connect after. Shows the invoice QR when no in-app
  /// wallet could pay, so it can be paid from any external wallet.
  Future<void> _connectPaidRelay() async {
    if (_relayBusy) return;
    setState(() => _relayBusy = true);
    try {
      final outcome = await ref.read(connectPaidRelayProvider)();
      if (!mounted) return;
      switch (outcome.result) {
        case PaidRelayConnectResult.connected:
          AppToast.success(context, 'Connected to paid relay');
        case PaidRelayConnectResult.invoicePending:
          final invoice = outcome.invoice;
          if (invoice?.bolt11 != null) {
            await _showAdmissionInvoice(invoice!);
          }
        case PaidRelayConnectResult.awaitingAdmission:
          AppToast.info(
            context,
            'Payment sent — waiting for the relay to confirm it. '
            'Check back in a moment.',
          );
        case PaidRelayConnectResult.unreachable:
          AppToast.error(
            context,
            outcome.error ?? "Couldn't reach the relay",
          );
      }
    } finally {
      if (mounted) setState(() => _relayBusy = false);
    }
  }

  /// The relay minted an invoice but no in-app wallet could pay it during the
  /// connect flow — show the pay sheet (Pay button retry + QR fallback), and
  /// connect once the payment is confirmed.
  Future<void> _showAdmissionInvoice(AdmissionInvoice invoice) async {
    final outcome = await showPayInvoiceSheet(
      context,
      title: 'Pay relay admission',
      bolt11: invoice.bolt11!,
      amountSats: invoice.amountSats > 0 ? invoice.amountSats : null,
      memo: 'One-time, tied to your key',
      checkPaid: _checkAdmissionPaid(invoice),
    );
    if (!mounted) return;
    if (outcome == InvoicePayResult.paid) {
      // Payment confirmed → NOW connect (payment first, connect after).
      final nostr = ref.read(nostrServiceProvider);
      if (!nostr.isInitialized) await nostr.init();
      await nostr.relayPool.addRelay(Env.paidRelay);
      if (mounted) {
        AppToast.success(context, 'Admission paid — connected to paid relay');
      }
    }
    ref.invalidate(myAdmissionProvider);
    ref.invalidate(paidRelayStatusProvider);
  }

  /// Polls the invoice's status route + the admission check once — either
  /// one saying yes is enough.
  Future<bool> Function() _checkAdmissionPaid(AdmissionInvoice invoice) {
    return () async {
      final auth = ref.read(authStateProvider);
      final pubkey = auth.pubkey;
      if (pubkey == null) return false;
      final service = ref.read(admissionServiceProvider);
      final statusUrl = invoice.statusUrl;
      final results = await Future.wait([
        statusUrl != null
            ? service.pollStatus(statusUrl)
            : Future.value(AdmissionInvoiceStatus.unknown),
        service.check(pubkey),
      ]);
      return results[0] == AdmissionInvoiceStatus.completed ||
          results[1] == AdmissionState.admitted;
    };
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final auth = ref.watch(authStateProvider);
    final isPremium = ref.watch(isPremiumProvider).value ?? false;
    final entitlements = ref.watch(premiumEntitlementsProvider).valueOrNull;
    final relayStatus = ref.watch(paidRelayStatusProvider).valueOrNull;
    final admission = relayStatus?.admission ?? AdmissionState.unknown;
    final feeSats = ref.watch(admissionFeeProvider).valueOrNull ??
        AdmissionService.fallbackAdmissionSats;

    return DetailScaffold(
      title: 'Premium',
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Hero
          _Hero(isPremium: isPremium),
          const SizedBox(height: 20),

          // ── Current entitlements ──
          if (entitlements != null && entitlements.hasAny) ...[
            _EntitlementsCard(entitlements: entitlements),
            const SizedBox(height: 20),
          ],

          // ── Feature 1: Verified name (NIP-05) ──
          _FeatureCard(
            iconName: 'verified',
            iconColor: scheme.primary,
            title: 'Verified Name (NIP-05)',
            description:
                'Your name, verified everywhere on Nostr. people find and trust you instantly.',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _DomainChipRow(),
                const SizedBox(height: 10),
                Text(
                  'e.g. you@${Env.nip5Domain} or you@getzap.me — shown next to your name with a ✓ check.',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: scheme.onSurfaceVariant,
                        height: 1.4,
                      ),
                ),
                const SizedBox(height: 12),
                FilledButton.tonalIcon(
                  onPressed: auth.isLoggedIn
                      ? () => context.push('/identity')
                      : null,
                  icon: const AppIcon('verified', size: 18),
                  label: const Text('Claim your name'),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),

          // ── Feature 2: Paid relay (payment first, connect after) ──
          _FeatureCard(
            iconName: 'globe',
            iconColor: AppStatusColors.warning,
            title: 'Paid Relay Access',
            description:
                'Guaranteed uptime, spam-free, higher rate limits, priority event delivery via ${Env.paidRelay.replaceFirst('wss://', '')}.',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: scheme.surfaceContainerLowest,
                    borderRadius: AppShapes.radiusMd,
                    border: Border.all(color: scheme.outlineVariant),
                  ),
                  child: Column(
                    children: [
                      _RelayStatusRow(
                        ok: admission == AdmissionState.admitted,
                        label: admission == AdmissionState.admitted
                            ? 'Admission paid'
                            : admission == AdmissionState.unpaid
                                ? 'Admission not paid yet'
                                : "Couldn't check admission",
                        scheme: scheme,
                      ),
                      const SizedBox(height: 8),
                      _RelayStatusRow(
                        ok: relayStatus?.connected == true,
                        label: relayStatus?.connected == true
                            ? 'Connected to paid relay'
                            : 'Not connected',
                        scheme: scheme,
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 12),
                FilledButton.tonalIcon(
                  onPressed: auth.isLoggedIn && !_relayBusy
                      ? _connectPaidRelay
                      : null,
                  icon: _relayBusy
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const AppIcon('zap', size: 18),
                  label: Text(
                    relayStatus?.connected == true
                        ? 'Connected'
                        : admission == AdmissionState.admitted
                            ? 'Connect to paid relay'
                            : 'Pay ${_formatSats(feeSats)} sats & connect',
                    style: const TextStyle(
                      fontFeatures: [FontFeature.tabularFigures()],
                    ),
                  ),
                ),
                if (admission != AdmissionState.admitted) ...[
                  const SizedBox(height: 8),
                  Text(
                    'One-time admission, tied to your key. Payment happens first — the relay connects once it confirms you.',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: scheme.onSurfaceVariant,
                          height: 1.4,
                        ),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 14),

          // ── Feature 3: Lightning address ──
          _FeatureCard(
            iconName: 'zap',
            iconColor: AppActionColors.zapFor(scheme.brightness),
            title: 'Lightning Address',
            description:
                'Receive zaps from any Nostr client to your own address. Works with your wallet.',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (entitlements != null &&
                    entitlements.lightningAddresses.isNotEmpty)
                  for (final addr in entitlements.lightningAddresses)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 6),
                      child: _CopyRow(text: addr),
                    )
                else
                  Text(
                    'e.g. you@${Env.lightningAddressDomain}',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: scheme.onSurfaceVariant,
                          fontFamily: 'monospace',
                        ),
                  ),
                const SizedBox(height: 12),
                FilledButton.tonalIcon(
                  onPressed: auth.isLoggedIn
                      ? () => context.push('/identity')
                      : null,
                  icon: const AppIcon('zap', size: 18),
                  label: Text(
                    entitlements?.lightningAddresses.isNotEmpty == true
                        ? 'Manage addresses'
                        : 'Get a lightning address',
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),

          // ── Feature 4 (premium): Nostr Bunker — remote signer ──
          const BunkerCard(),
          const SizedBox(height: 14),

          // ── Feature 5 (premium): Wallet Connect (NWC) ──
          const NwcProviderCard(),
          const SizedBox(height: 20),

          // ── What else is included ──
          _IncludedCard(),
          const SizedBox(height: 24),

          if (!auth.isLoggedIn)
            Center(
              child: Text(
                'Log in to claim names and connect the paid relay',
                textAlign: TextAlign.center,
                style: Theme.of(context)
                    .textTheme
                    .bodyMedium
                    ?.copyWith(color: scheme.onSurfaceVariant),
              ),
            ),
        ],
      ),
    );
  }
}

class _RelayStatusRow extends StatelessWidget {
  final bool ok;
  final String label;
  final ColorScheme scheme;
  const _RelayStatusRow({
    required this.ok,
    required this.label,
    required this.scheme,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        AppIcon(
          ok ? 'check' : 'clock',
          size: 18,
          color: ok ? AppStatusColors.success : scheme.onSurfaceVariant,
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            label,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  fontWeight: FontWeight.w600,
                  color: ok ? AppStatusColors.success : scheme.onSurfaceVariant,
                ),
          ),
        ),
      ],
    );
  }
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

class _Hero extends StatelessWidget {
  final bool isPremium;
  const _Hero({required this.isPremium});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    // Quiet dark-ink statement card — no gradient, content-first.
    return Container(
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: scheme.inverseSurface,
        borderRadius: AppShapes.radiusXl,
      ),
      child: Row(
        children: [
          AppIcon('verified', size: 36, color: scheme.onInverseSurface),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  isPremium ? 'You\'re Premium' : 'NostrFeed Premium',
                  style: Theme.of(context).textTheme.titleLarge?.copyWith(
                        color: scheme.onInverseSurface,
                        fontWeight: FontWeight.bold,
                      ),
                ),
                const SizedBox(height: 4),
                Text(
                  isPremium
                      ? 'Verified name, paid relay, and lightning address are active.'
                      : 'Verified name, paid relay, and your lightning address — all in one.',
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color:
                            scheme.onInverseSurface.withValues(alpha: 0.72),
                      ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _FeatureCard extends StatelessWidget {
  final String iconName;
  final Color iconColor;
  final String title;
  final String description;
  final Widget child;

  const _FeatureCard({
    required this.iconName,
    required this.iconColor,
    required this.title,
    required this.description,
    required this.child,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLowest,
        borderRadius: AppShapes.radiusLg,
        border: Border.all(color: scheme.outlineVariant),
      ),
      child: Padding(
        padding: AppSpacing.paddingMd,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: iconColor.withValues(alpha: 0.12),
                    borderRadius: AppShapes.radiusMd,
                  ),
                  child: AppIcon(iconName, size: 20, color: iconColor),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    title,
                    style: Theme.of(context)
                        .textTheme
                        .titleMedium
                        ?.copyWith(fontWeight: FontWeight.bold),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Text(
              description,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: scheme.onSurfaceVariant,
                    height: 1.45,
                  ),
            ),
            const SizedBox(height: 12),
            child,
          ],
        ),
      ),
    );
  }
}

class _DomainChipRow extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final domains = [Env.nip5Domain, 'getzap.me'];
    return Wrap(
      spacing: 6,
      children: [
        for (final d in domains)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: Theme.of(context)
                  .colorScheme
                  .primaryContainer
                  .withValues(alpha: 0.5),
              borderRadius: AppShapes.radiusSm,
            ),
            child: Text(
              'you@$d',
              style: Theme.of(context).textTheme.labelMedium?.copyWith(
                    fontWeight: FontWeight.w600,
                    fontFamily: 'monospace',
                    color: Theme.of(context).colorScheme.primary,
                  ),
            ),
          ),
      ],
    );
  }
}

class _EntitlementsCard extends StatelessWidget {
  final PremiumEntitlements entitlements;
  const _EntitlementsCard({required this.entitlements});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLowest,
        borderRadius: AppShapes.radiusLg,
        border: Border.all(color: scheme.outlineVariant),
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'YOUR PREMIUM',
              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    fontWeight: FontWeight.w700,
                    letterSpacing: 1.4,
                    color: scheme.primary,
                  ),
            ),
            const SizedBox(height: 10),
            for (final name in entitlements.nip5Names)
              _CopyRow(text: name, icon: Icons.verified_rounded),
            for (final addr in entitlements.lightningAddresses)
              _CopyRow(text: addr, icon: Icons.bolt_rounded),
          ],
        ),
      ),
    );
  }
}

class _CopyRow extends StatelessWidget {
  final String text;
  final IconData? icon;
  const _CopyRow({required this.text, this.icon});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        children: [
          if (icon != null) ...[
            Icon(icon, size: 15, color: Theme.of(context).colorScheme.primary),
            const SizedBox(width: 6),
          ],
          Expanded(
            child: Text(
              text,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    fontFamily: 'monospace',
                    fontWeight: FontWeight.w600,
                  ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          IconButton(
            icon: const AppIcon('edit', size: 16),
            tooltip: 'Copy',
            visualDensity: VisualDensity.compact,
            onPressed: () {
              Clipboard.setData(ClipboardData(text: text));
              AppToast.success(context, 'Copied');
            },
          ),
        ],
      ),
    );
  }
}

class _IncludedCard extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    const items = [
      'Verified ✓ next to your name everywhere',
      'Spam-free, low-latency paid relay',
      'Higher rate limits + priority delivery',
      'Zaps straight to your own address',
      'Media uploads up to 100MB',
      'Priority support from the team',
    ];
    return Container(
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLowest,
        borderRadius: AppShapes.radiusLg,
        border: Border.all(color: scheme.outlineVariant),
      ),
      child: Padding(
        padding: AppSpacing.paddingMd,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'ALSO INCLUDED',
              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    fontWeight: FontWeight.w700,
                    letterSpacing: 1.4,
                    color: scheme.primary,
                  ),
            ),
            const SizedBox(height: 12),
            for (final text in items)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: Row(
                  children: [
                    const AppIcon('check',
                        size: AppIconSize.md,
                        color: AppStatusColors.success),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        text,
                        style: Theme.of(context)
                            .textTheme
                            .bodySmall
                            ?.copyWith(height: 1.35),
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}
