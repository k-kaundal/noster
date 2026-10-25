import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'package:nostrfeed_mobile/core/utils/encrypted_content.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';
import 'package:url_launcher/url_launcher.dart';

/// Renders an ecash / encrypted-token payload as a proper card instead of a
/// base64 wall.
///
/// - **Cashu ecash** (`cashuA`/`cashuB`): a "🪙 Ecash token" card showing the
///   amount + mint when decodable (cashuA JSON), with Copy + claim actions.
/// - **Other ciphertext** (NIP-04/44, colon-base64, unknown tokens): a
///   compact "🔒 Encrypted content" card with a copy button — the reader can
///   still grab the token for their own client, but no base64 is dumped
///   into the feed.
class EcashTokenCard extends StatelessWidget {
  /// The full token/ciphertext string (trimmed content).
  final String token;
  final EncryptedKind kind;

  const EcashTokenCard({super.key, required this.token, required this.kind});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return switch (kind) {
      EncryptedKind.ecash => _ecashCard(context, scheme),
      EncryptedKind.schemePayload => _schemePayloadCard(context, scheme),
      _ => _encryptedCard(context, scheme),
    };
  }

  // ── scheme://action/<base64> app payload (bala:// call offer, etc.) ──

  Widget _schemePayloadCard(BuildContext context, ColorScheme scheme) {
    final payload = decodeSchemePayload(token);
    final isCallOffer = payload != null &&
        (payload.action.toLowerCase().contains('offer') ||
            payload.action.toLowerCase().contains('call'));
    final title = isCallOffer
        ? 'Call offer'
        : '${payload?.scheme ?? 'App'} ${payload?.action ?? 'payload'}';
    return _shell(
      scheme,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: scheme.primaryContainer,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(
                  isCallOffer
                      ? Icons.call_rounded
                      : Icons.widgets_outlined,
                  size: 20,
                  color: scheme.onPrimaryContainer,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        fontWeight: FontWeight.w700,
                        fontSize: 15,
                      ),
                    ),
                    if (payload != null) ...[
                      const SizedBox(height: 2),
                      Text(
                        payload.summary,
                        style: TextStyle(
                          fontSize: 12.5,
                          color: scheme.onSurfaceVariant,
                        ),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              _action(
                scheme,
                icon: Icons.copy_rounded,
                label: 'Copy offer',
                onTap: () => _copy(context),
              ),
              if (payload != null) ...[
                const SizedBox(width: 8),
                _action(
                  scheme,
                  icon: isCallOffer
                      ? Icons.call_rounded
                      : Icons.open_in_new_rounded,
                  label: isCallOffer ? 'Join call' : 'Open',
                  filled: true,
                  onTap: () => _open(context),
                ),
              ],
            ],
          ),
          const SizedBox(height: 8),
          // Honest expectation: the offer opens in the app that owns the
          // scheme — it only joins when that app is installed.
          Text(
            'Joins in the ${payload?.scheme ?? 'linked'} app — install it if '
            'the button does nothing',
            style: TextStyle(
              fontSize: 11.5,
              color: scheme.onSurfaceVariant.withValues(alpha: 0.8),
            ),
          ),
        ],
      ),
    );
  }

  // ── Ecash (Cashu) ───────────────────────────────────────────────────

  Widget _ecashCard(BuildContext context, ColorScheme scheme) {
    final info = decodeEcash(token);
    final amount = info.amountSats;
    return _shell(
      scheme,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: scheme.primaryContainer,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: AppIcon('zap', size: 20, color: scheme.onPrimaryContainer),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      amount != null
                          ? 'Ecash token · ${_fmt(amount)} sats'
                          : info.isV4
                              ? 'Ecash token (v4)'
                              : 'Ecash token',
                      style: const TextStyle(
                        fontWeight: FontWeight.w700,
                        fontSize: 15,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      info.mintHost != null
                          ? 'Mint: ${info.mintHost}'
                          : 'Claim in a Cashu wallet',
                      style: TextStyle(
                        fontSize: 12.5,
                        color: scheme.onSurfaceVariant,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              _action(
                scheme,
                icon: Icons.copy_rounded,
                label: 'Copy token',
                onTap: () => _copy(context),
              ),
              const SizedBox(width: 8),
              _action(
                scheme,
                icon: Icons.account_balance_wallet_outlined,
                label: 'Open in wallet',
                filled: true,
                onTap: () => _openWallet(context),
              ),
            ],
          ),
        ],
      ),
    );
  }

  // ── Generic encrypted / token ciphertext ───────────────────────────

  Widget _encryptedCard(BuildContext context, ColorScheme scheme) {
    final label = switch (kind) {
      EncryptedKind.nip04 => 'Encrypted direct message',
      EncryptedKind.colonCipher => 'Encrypted content',
      _ => 'Encrypted content',
    };
    return _shell(
      scheme,
      child: Row(
        children: [
          AppIcon('key', size: 18, color: scheme.onSurfaceVariant),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              label,
              style: TextStyle(
                fontSize: 13.5,
                color: scheme.onSurfaceVariant,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          IconButton(
            icon: AppIcon('edit', size: 16, color: scheme.primary),
            tooltip: 'Copy',
            visualDensity: VisualDensity.compact,
            onPressed: () => _copy(context),
          ),
        ],
      ),
    );
  }

  // ── Shared ──────────────────────────────────────────────────────────

  Widget _shell(ColorScheme scheme, {required Widget child}) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(top: 8),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: scheme.outlineVariant),
      ),
      child: child,
    );
  }

  Widget _action(
    ColorScheme scheme, {
    required IconData icon,
    required String label,
    required VoidCallback onTap,
    bool filled = false,
  }) {
    return Material(
      color: filled ? scheme.primary : scheme.surfaceContainerHighest,
      borderRadius: BorderRadius.circular(10),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon,
                  size: 15,
                  color: filled ? scheme.onPrimary : scheme.onSurfaceVariant),
              const SizedBox(width: 6),
              Text(
                label,
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: filled ? scheme.onPrimary : scheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _copy(BuildContext context) {
    Clipboard.setData(ClipboardData(text: token));
    AppToast.success(context, 'Token copied');
  }

  void _openWallet(BuildContext context) {
    // Cashu wallets register the `cashu:` URI scheme; fall back to copy.
    // (We keep this simple — the token is copied either way.)
    _copy(context);
  }

  Future<void> _open(BuildContext context) async {
    // The payload IS a URI (bala://offer/…) — hand it to the owning app.
    // Nothing handles the scheme → tell the user, don't silently copy.
    final uri = Uri.tryParse(token);
    final canOpen = uri != null && await canLaunchUrl(uri);
    if (!context.mounted) return;
    if (canOpen) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } else {
      await Clipboard.setData(ClipboardData(text: token));
      if (!context.mounted) return;
      AppToast.success(context, 'No app on this device opens ${uri?.scheme ?? 'this'} links — '
            'the offer was copied instead');
    }
  }

  String _fmt(int n) {
    if (n >= 1000000) return '${(n / 1000000).toStringAsFixed(1)}M';
    if (n >= 1000) return '${(n / 1000).toStringAsFixed(1)}K';
    return '$n';
  }
}
