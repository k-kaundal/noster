import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/services/wallet_payment.dart';
import 'package:nostrfeed_mobile/features/wallet/data/lnurl_service.dart';
import 'package:nostrfeed_mobile/features/zap/application/quick_zap.dart';
import 'package:qr_flutter/qr_flutter.dart';

/// Shows a zap dialog for a Nostr event or profile.
/// Returns the invoice if the recipient has a lightning address, else null.
Future<void> showZapDialog({
  required BuildContext context,
  required NostrEvent targetEvent,
  String? targetPubkey, // For profile zaps where event is a kind 0
  int? eventKind,
}) {
  return showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
    ),
    builder: (ctx) => _ZapSheet(
      targetEvent: targetEvent,
      targetPubkey: targetPubkey,
      eventKind: eventKind,
    ),
  );
}

class _ZapSheet extends ConsumerStatefulWidget {
  final NostrEvent targetEvent;
  final String? targetPubkey;
  final int? eventKind;

  const _ZapSheet({
    required this.targetEvent,
    this.targetPubkey,
    this.eventKind,
  });

  @override
  ConsumerState<_ZapSheet> createState() => _ZapSheetState();
}

class _ZapSheetState extends ConsumerState<_ZapSheet> {
  final _amountController = TextEditingController(text: '21');
  final _messageController = TextEditingController();
  int _selectedPreset = 21;

  bool _loading = false;
  bool _resolving = false;
  LnurlPayInfo? _lnurlInfo;
  String? _invoice;
  String? _error;
  String? _lightningAddress;

  /// Primal's zap preset grid (`ZapBottomSheet` defaults): emoji + amount,
  /// each preset carrying Primal's exact amounts — 👍21, 🚀420, ☕1k, 🍻5k,
  /// 🍷10k, 👑100k. The emoji is the identity of the amount in Nostr
  /// culture (a "🚀 420" reads instantly).
  static const _presets = [
    (emoji: '👍', amount: 21),
    (emoji: '🚀', amount: 420),
    (emoji: '☕', amount: 1000),
    (emoji: '🍻', amount: 5000),
    (emoji: '🍷', amount: 10000),
    (emoji: '👑', amount: 100000),
  ];

  static String _shortAmount(int sats) {
    if (sats >= 1000000) return '${(sats / 1000000).toStringAsFixed(0)}M';
    if (sats >= 1000) return '${(sats / 1000).toStringAsFixed(0)}k';
    return '$sats';
  }

  @override
  void initState() {
    super.initState();
    _resolve();
  }

  @override
  void dispose() {
    _amountController.dispose();
    _messageController.dispose();
    super.dispose();
  }

  Future<void> _resolve() async {
    setState(() {
      _resolving = true;
      _error = null;
    });

    try {
      final nostr = ref.read(nostrServiceProvider);
      final pubkey = widget.targetPubkey ?? widget.targetEvent.pubkey;
      final profile = await nostr.fetchProfile(pubkey);
      if (!mounted) return;

      final address = profile?.lud16 ?? profile?.lud06;
      if (address == null || !address.contains('@')) {
        setState(() {
          _resolving = false;
          _error = 'This user has no lightning address set';
        });
        return;
      }

      _lightningAddress = address;
      final info = await resolveLnurlPay(address);
      if (!mounted) return;

      if (info == null) {
        setState(() {
          _resolving = false;
          _error = 'Could not resolve lightning address';
        });
        return;
      }

      setState(() {
        _lnurlInfo = info;
        _resolving = false;
      });
    } catch (e) {
      if (mounted) {
        setState(() {
          _resolving = false;
          _error = 'Error: $e';
        });
      }
    }
  }

  Future<void> _createInvoice() async {
    final info = _lnurlInfo;
    if (info == null) return;

    final amount = int.tryParse(_amountController.text.trim());
    if (amount == null || amount <= 0) {
      setState(() => _error = 'Invalid amount');
      return;
    }
    if (amount < info.minSats || amount > info.maxSats) {
      setState(() => _error =
          'Amount must be between ${info.minSats} and ${info.maxSats} sats');
      return;
    }

    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final auth = ref.read(authStateProvider);
      final nostr = ref.read(nostrServiceProvider);

      String? zapRequestJson;
      if (info.allowsNostr && auth.isLoggedIn && !auth.isReadOnly) {
        // Build a NIP-57 zap request event (kind 9734)
        final relays = nostr.relayPool.relayUrls.take(3).toList();
        final tags = <List<String>>[
          ['p', widget.targetPubkey ?? widget.targetEvent.pubkey],
          ['amount', '${amount * 1000}'],
          ['relays', ...relays],
        ];
        // For event zaps, add the e tag
        if (widget.eventKind == null || widget.eventKind != 0) {
          tags.add(['e', widget.targetEvent.id]);
        }
        final zapReq = nostr.authService.signEvent(
          privateKey: auth.privateKey!,
          kind: 9734,
          content: _messageController.text.trim(),
          tags: tags,
        );
        zapRequestJson = _encodeEvent(zapReq);
      }

      final invoice = await fetchInvoice(
        info: info,
        sats: amount,
        comment: _messageController.text.trim().isEmpty
            ? null
            : _messageController.text.trim(),
        zapRequestJson: zapRequestJson,
      );

      if (!mounted) return;
      if (invoice == null) {
        setState(() {
          _loading = false;
          _error = 'Could not get invoice';
        });
        return;
      }

      // Pay with the FIRST in-app wallet that can — LNbits → NWC → Cashu →
      // LndHub (the shared cascade). The old code only tried NWC, so LNbits
      // users (the majority) got a QR instead of one-tap pay. The QR stays
      // as the fallback for external wallets and failed attempts.
      final wallet = await payWithAnyWallet(ref.read, invoice);
      if (!mounted) return;
      if (wallet != null) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('⚡ Zap of $amount sats sent!')),
        );
        Navigator.pop(context);
        return;
      }

      // No wallet could pay — show the QR for an external wallet.
      setState(() {
        _invoice = invoice;
        _loading = false;
      });
    } catch (e) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = 'Error: $e';
        });
      }
    }
  }

  String _encodeEvent(NostrEvent event) {
    // NIP-57 expects URI-encoded event JSON
    return Uri.encodeComponent(
        '{"id":"${event.id}","pubkey":"${event.pubkey}","created_at":${event.createdAt},"kind":${event.kind},"tags":${_jsonEncodeTags(event.tags)},"content":"${_escapeContent(event.content)}","sig":"${event.sig}"}');
  }

  String _jsonEncodeTags(List<List<String>> tags) {
    return '[${tags.map((t) => '[${t.map((v) => '"$v"').join(',')}]').join(',')}]';
  }

  String _escapeContent(String content) {
    return content
        .replaceAll('\\', '\\\\')
        .replaceAll('"', '\\"')
        .replaceAll('\n', '\\n')
        .replaceAll('\r', '\\r')
        .replaceAll('\t', '\\t');
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;

    return Padding(
      padding: EdgeInsets.only(bottom: bottomInset),
      child: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Header
              Row(
                children: [
                  Icon(Icons.bolt, color: Colors.amber.shade700, size: 28),
                  const SizedBox(width: 8),
                  Text(
                    'Send Zap',
                    style: Theme.of(context).textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                  ),
                  const Spacer(),
                  IconButton(
                    icon: const Icon(Icons.close),
                    onPressed: () => Navigator.pop(context),
                  ),
                ],
              ),
              const SizedBox(height: 16),

              if (_resolving)
                const Center(
                  child: Padding(
                    padding: EdgeInsets.all(24),
                    child: CircularProgressIndicator(),
                  ),
                )
              else if (_error != null && _lnurlInfo == null)
                _errorView(colorScheme)
              else if (_invoice != null)
                _invoiceView(colorScheme)
              else
                _formView(colorScheme),
            ],
          ),
        ),
      ),
    );
  }

  Widget _errorView(ColorScheme colorScheme) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(Icons.error_outline, size: 48, color: colorScheme.error),
        const SizedBox(height: 16),
        Text(
          _error ?? 'Unknown error',
          textAlign: TextAlign.center,
          style: TextStyle(color: colorScheme.error),
        ),
        const SizedBox(height: 16),
        FilledButton.tonal(
          onPressed: _resolve,
          child: const Text('Retry'),
        ),
      ],
    );
  }

  Widget _formView(ColorScheme colorScheme) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_lightningAddress != null)
          Text(
            'To: $_lightningAddress',
            style: Theme.of(context).textTheme.bodySmall,
            textAlign: TextAlign.center,
          ),
        const SizedBox(height: 16),

        // Primal's preset grid: 3 columns of square emoji+amount cells.
        // Selected = surface bg + 1 dp tertiary border; unselected =
        // surfaceVariantAlt1 bg (here surfaceContainerHighest, the closest
        // M3 token to Primal's alt surfaces).
        GridView.count(
          crossAxisCount: 3,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 8,
          crossAxisSpacing: 8,
          childAspectRatio: 1.15,
          children: [
            for (final preset in _presets)
              _ZapPresetCell(
                emoji: preset.emoji,
                label: _shortAmount(preset.amount),
                selected: _selectedPreset == preset.amount,
                onTap: () {
                  setState(() {
                    _selectedPreset = preset.amount;
                    _amountController.text = '${preset.amount}';
                  });
                  // Small presets become the new one-tap default.
                  if (preset.amount <= quickZapMaxSats) {
                    ref
                        .read(quickZapAmountProvider.notifier)
                        .setAmount(preset.amount);
                  }
                },
              ),
          ],
        ),
        const SizedBox(height: 16),

        // Custom amount
        TextField(
          controller: _amountController,
          keyboardType: TextInputType.number,
          decoration: InputDecoration(
            labelText: 'Amount (sats)',
            prefixIcon: Icon(Icons.currency_bitcoin,
                color: Colors.amber.shade700),
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
          ),
          onChanged: (_) => setState(() => _selectedPreset = 0),
        ),
        const SizedBox(height: 12),

        // Message
        TextField(
          controller: _messageController,
          maxLines: 2,
          decoration: InputDecoration(
            labelText: 'Message (optional)',
            prefixIcon: const Icon(Icons.message_outlined),
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
          ),
        ),

        // Wallet indicator — any paying wallet, not just NWC.
        Builder(builder: (context) {
          if (!hasPayingWallet(ref.read)) return const SizedBox.shrink();
          return Padding(
            padding: const EdgeInsets.only(top: 12),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.check_circle,
                    size: 14, color: Colors.green.shade600),
                const SizedBox(width: 4),
                Text(
                  'Will pay from your connected wallet',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: Colors.green.shade700,
                      ),
                ),
              ],
            ),
          );
        }),

        if (_error != null) ...[
          const SizedBox(height: 12),
          Text(
            _error!,
            style: TextStyle(color: colorScheme.error, fontSize: 13),
            textAlign: TextAlign.center,
          ),
        ],
        const SizedBox(height: 20),
        FilledButton.icon(
          onPressed: _loading ? null : _createInvoice,
          icon: _loading
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : Icon(Icons.bolt, color: Colors.amber.shade700),
          label: Builder(builder: (context) {
            return Text(
              hasPayingWallet(ref.read) ? 'Send Zap' : 'Create Invoice',
            );
          }),
          style: FilledButton.styleFrom(
            padding: const EdgeInsets.symmetric(vertical: 14),
          ),
        ),
      ],
    );
  }

  Widget _invoiceView(ColorScheme colorScheme) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          'Scan to pay',
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: 16),
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(12),
          ),
          child: QrImageView(
            data: _invoice!.toUpperCase(),
            size: 220,
            backgroundColor: Colors.white,
          ),
        ),
        const SizedBox(height: 16),
        Text(
          '${_amountController.text} sats',
          style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                fontWeight: FontWeight.bold,
                color: Colors.amber.shade700,
              ),
        ),
        const SizedBox(height: 16),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            OutlinedButton.icon(
              onPressed: () {
                Clipboard.setData(ClipboardData(text: _invoice!));
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Invoice copied')),
                );
              },
              icon: const Icon(Icons.copy, size: 18),
              label: const Text('Copy Invoice'),
            ),
            const SizedBox(width: 12),
            FilledButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Done'),
            ),
          ],
        ),
      ],
    );
  }
}

/// One cell of Primal's zap preset grid (`ZapOption`): a square tile with
/// the preset emoji (28 sp) above the shortened amount (SemiBold) —
/// selected gets a surface background + 1 dp tertiary border, unselected a
/// muted container.
class _ZapPresetCell extends StatelessWidget {
  final String emoji;
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const _ZapPresetCell({
    required this.emoji,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Material(
      color: selected ? scheme.surface : scheme.surfaceContainerHighest,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
        side: selected
            ? BorderSide(color: scheme.tertiary, width: 1)
            : BorderSide.none,
      ),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(emoji, style: const TextStyle(fontSize: 26)),
            const SizedBox(height: 4),
            Text(
              label,
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w600,
                color: scheme.onSurface,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
