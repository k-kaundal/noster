import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../models/nostr_models.dart';
import '../../providers/app_providers.dart';
import '../../services/lnurl_service.dart';

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

  static const _presets = [21, 100, 500, 1000, 5000, 10000];

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

        // Preset amount chips
        Wrap(
          spacing: 8,
          runSpacing: 8,
          alignment: WrapAlignment.center,
          children: _presets.map((amount) {
            final isSelected = _selectedPreset == amount;
            return ChoiceChip(
              label: Text('$amount'),
              selected: isSelected,
              onSelected: (_) {
                setState(() {
                  _selectedPreset = amount;
                  _amountController.text = '$amount';
                });
              },
            );
          }).toList(),
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
          label: const Text('Create Invoice'),
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
