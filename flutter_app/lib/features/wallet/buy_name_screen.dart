import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/config/env.dart';
import 'package:nostrfeed_mobile/core/widgets/pay_invoice_sheet.dart';
import 'package:nostrfeed_mobile/features/identity/providers/address_providers.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/features/identity/services/address_service.dart';

/// Dedicated screen for buying a verified NIP-05 name or custom lightning
/// address. Replaces the cramped AlertDialog with a full-screen flow that
/// shows accurate pricing, availability, and payment status.
class BuyNameScreen extends ConsumerStatefulWidget {
  const BuyNameScreen({super.key});

  @override
  ConsumerState<BuyNameScreen> createState() => _BuyNameScreenState();
}

class _BuyNameScreenState extends ConsumerState<BuyNameScreen> {
  final _nameController = TextEditingController();
  final _promoController = TextEditingController();

  bool _isSearching = false;
  bool _isClaiming = false;
  Nip5SearchResult? _searchResult;
  Nip5ClaimResult? _claimResult;
  String? _errorMsg;

  // Domain selection
  Nip5Domain? _selectedDomain;
  final List<Nip5Domain> _domains = nip5Domains;

  // Duration is fixed at 1 year — the LNbits nostrnip5 extension only
  // supports 1-year purchases.
  static const int _years = 1;

  @override
  void initState() {
    super.initState();
    _selectedDomain = _domains.isEmpty ? null : _domains.first;
  }

  @override
  void dispose() {
    _nameController.dispose();
    _promoController.dispose();
    super.dispose();
  }

  Future<void> _search(String query) async {
    final q = query.trim().toLowerCase();
    if (q.length < 2 || _selectedDomain == null) {
      setState(() {
        _searchResult = null;
        _errorMsg = null;
      });
      return;
    }

    setState(() {
      _isSearching = true;
      _errorMsg = null;
    });

    try {
      final result = await ref
          .read(nip5Provider.notifier)
          .search(localPart: q, years: _years, domainId: _selectedDomain!.id);
      if (mounted) {
        setState(() {
          _searchResult = result;
          _isSearching = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _isSearching = false;
          _searchResult = null;
          _errorMsg = 'Search failed: $e';
        });
      }
    }
  }

  Future<void> _claim() async {
    final name = _nameController.text.trim().toLowerCase();
    if (name.isEmpty || _selectedDomain == null || _searchResult == null) {
      return;
    }

    setState(() {
      _isClaiming = true;
      _errorMsg = null;
    });

    try {
      final result = await ref
          .read(nip5Provider.notifier)
          .claim(
            localPart: name,
            years: _years,
            domainId: _selectedDomain!.id,
            promoCode: _promoController.text.trim().isEmpty
                ? null
                : _promoController.text.trim(),
          );
      if (!mounted) return;
      setState(() => _isClaiming = false);

      // Free (promo) claim — no invoice at all.
      if (result.bolt11.isEmpty) {
        setState(() => _claimResult = result);
        return;
      }

      // PAID claim: open the pay sheet (in-app wallet Pay button + QR
      // fallback). The name only activates once the invoice settles.
      final outcome = await showPayInvoiceSheet(
        context,
        title: 'Pay to activate your name',
        bolt11: result.bolt11,
        amountSats: _searchResult?.priceSats,
        memo: result.address?.identifier,
        checkPaid: _checkPaid,
      );
      if (!mounted) return;
      if (outcome == InvoicePayResult.paid) {
        // bolt11 empty marks the claim as settled in the payment view.
        setState(() {
          _claimResult = Nip5ClaimResult(
            address: result.address,
            bolt11: '',
            paymentHash: result.paymentHash,
            domainId: result.domainId,
          );
        });
      } else {
        // Reserved but unpaid — the payment view stays reachable so the
        // invoice can still be paid later (sheet re-opens from there).
        setState(() => _claimResult = result);
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _isClaiming = false;
          _errorMsg = e.toString();
        });
      }
    }
  }

  /// Asks the extension whether this claim's invoice has settled.
  Future<bool> _checkPaid() async {
    final claim = _claimResult;
    final hash = claim?.paymentHash;
    if (hash == null) return false;
    try {
      return await ref
          .read(nip5Provider.notifier)
          .checkPayment(paymentHash: hash, domainId: claim!.domainId);
    } catch (_) {
      return false;
    }
  }

  /// The reserved-but-unpaid view's own "pay now" — re-opens the same sheet.
  Future<void> _payReserved() async {
    final claim = _claimResult;
    if (claim == null || claim.bolt11.isEmpty) return;
    final outcome = await showPayInvoiceSheet(
      context,
      title: 'Pay to activate your name',
      bolt11: claim.bolt11,
      amountSats: _searchResult?.priceSats,
      memo: claim.address?.identifier,
      checkPaid: _checkPaid,
    );
    if (!mounted) return;
    if (outcome == InvoicePayResult.paid) {
      setState(() {
        _claimResult = Nip5ClaimResult(
          address: claim.address,
          bolt11: '',
          paymentHash: claim.paymentHash,
          domainId: claim.domainId,
        );
      });
    }
  }

  Future<void> _publishToProfile() async {
    final address = _claimResult?.address;
    if (address == null) return;

    try {
      await ref.read(nip5Provider.notifier).publishToProfile(address: address);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Published to your Nostr profile')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authStateProvider);
    final nip5 = ref.watch(nip5Provider);
    final colorScheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Get Verified Name'),
        actions: [
          if (nip5.isLoading)
            const Padding(
              padding: EdgeInsets.all(16),
              child: SizedBox(
                width: 20,
                height: 20,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            ),
        ],
      ),
      body: !auth.isLoggedIn
          ? _loginPrompt(colorScheme)
          : _claimResult != null
          ? _paymentView(colorScheme)
          : _searchView(colorScheme),
    );
  }

  Widget _loginPrompt(ColorScheme colorScheme) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.verified_outlined, size: 64, color: colorScheme.primary),
            const SizedBox(height: 24),
            Text(
              'Log in to get a verified name',
              style: Theme.of(context).textTheme.titleLarge,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 12),
            Text(
              'A NIP-05 name proves who you are across all Nostr clients.',
              style: Theme.of(context).textTheme.bodyMedium
                  ?.copyWith(color: colorScheme.onSurfaceVariant),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }

  Widget _searchView(ColorScheme colorScheme) {
    final auth = ref.watch(authStateProvider);
    final freeAddress = ref.watch(freeAddressProvider);
    final publishedNip5 = auth.profile?.nip05;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // ── Current identity ─────────────────────────────────────
        if (publishedNip5 != null) ...[
          Card(
            child: ListTile(
              leading: Icon(Icons.verified, color: Colors.green.shade600),
              title: const Text('Current verified name'),
              subtitle: Text(
                publishedNip5,
                style: const TextStyle(
                  fontFamily: 'monospace',
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ),
          const SizedBox(height: 16),
        ],

        // ── Free address info ────────────────────────────────────
        if (freeAddress != null) ...[
          Card(
            color: colorScheme.surfaceContainerHighest,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(
                        Icons.card_giftcard,
                        color: colorScheme.primary,
                        size: 20,
                      ),
                      const SizedBox(width: 8),
                      Text(
                        'Your free address',
                        style: Theme.of(context).textTheme.titleSmall
                            ?.copyWith(fontWeight: FontWeight.bold),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  SelectableText(
                    '$freeAddress@${Env.lightningAddressDomain}',
                    style: const TextStyle(
                      fontFamily: 'monospace',
                      fontSize: 13,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'Already works for zaps. A verified name adds a custom '
                    'identity that appears in Nostr clients.',
                    style: Theme.of(context).textTheme.bodySmall
                        ?.copyWith(color: colorScheme.onSurfaceVariant),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
        ],

        // ── Search form ──────────────────────────────────────────
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Choose a name',
                  style: Theme.of(context).textTheme.titleMedium
                      ?.copyWith(fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: _nameController,
                  decoration: InputDecoration(
                    labelText: 'Name',
                    hintText: 'alice',
                    prefixIcon: const Icon(Icons.verified_outlined),
                    suffixText: _selectedDomain != null
                        ? '@${_selectedDomain!.domain}'
                        : null,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                  onChanged: _search,
                ),
                const SizedBox(height: 16),

                // Domain picker
                if (_domains.length > 1) ...[
                  Text('Domain', style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final d in _domains)
                        ChoiceChip(
                          label: Text(d.domain),
                          selected: _selectedDomain?.id == d.id,
                          onSelected: (_) {
                            setState(() {
                              _selectedDomain = d;
                              _searchResult = null;
                            });
                            final q = _nameController.text.trim();
                            if (q.length >= 2) _search(q);
                          },
                        ),
                    ],
                  ),
                  const SizedBox(height: 16),
                ],

                // Duration — fixed at 1 year (the LNbits nostrnip5 extension
                // only supports 1-year purchases).
                Text('Duration', style: Theme.of(context).textTheme.labelLarge),
                const SizedBox(height: 8),
                Container(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 12, vertical: 8),
                  decoration: BoxDecoration(
                    color: colorScheme.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Text('1 year'),
                ),
                const SizedBox(height: 16),

                // Promo code
                TextField(
                  controller: _promoController,
                  decoration: InputDecoration(
                    labelText: 'Promo code (optional)',
                    prefixIcon: const Icon(Icons.discount_outlined),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                ),
                const SizedBox(height: 16),

                // Search result
                if (_isSearching)
                  const Center(
                    child: Padding(
                      padding: EdgeInsets.all(16),
                      child: CircularProgressIndicator(),
                    ),
                  )
                else if (_searchResult != null)
                  _searchResultCard(colorScheme)
                else if (_errorMsg != null)
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: colorScheme.errorContainer,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      _errorMsg!,
                      style: TextStyle(color: colorScheme.onErrorContainer),
                    ),
                  ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),

        // ── Claim button ─────────────────────────────────────────
        if (_searchResult != null && _searchResult!.available)
          FilledButton.icon(
            onPressed: _isClaiming ? null : _claim,
            icon: _isClaiming
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.shopping_cart_checkout),
            label: Text(
              _isClaiming
                  ? 'Processing…'
                  : 'Buy for ${_searchResult!.describePrice(years: _years)}',
            ),
            style: FilledButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 16),
            ),
          ),
      ],
    );
  }

  Widget _searchResultCard(ColorScheme colorScheme) {
    final result = _searchResult!;
    final isAvailable = result.available;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: isAvailable
            ? Colors.green.withValues(alpha: 0.08)
            : Colors.red.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: isAvailable
              ? Colors.green.withValues(alpha: 0.3)
              : Colors.red.withValues(alpha: 0.3),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                isAvailable ? Icons.check_circle : Icons.cancel,
                color: isAvailable ? Colors.green : Colors.red,
                size: 24,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      isAvailable ? 'Available!' : 'Not available',
                      style: TextStyle(
                        color: isAvailable
                            ? Colors.green.shade700
                            : Colors.red.shade700,
                        fontWeight: FontWeight.bold,
                        fontSize: 16,
                      ),
                    ),
                    if (!isAvailable && result.reason != null)
                      Text(
                        result.reason!,
                        style: TextStyle(
                          color: Colors.red.shade700,
                          fontSize: 13,
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
          if (isAvailable) ...[
            const SizedBox(height: 12),
            _priceRow('Price', result.describePrice(years: _years)),
            if (result.priceReason != null && result.priceReason!.isNotEmpty)
              _priceRow('Why', result.priceReason!),
            if (result.priceSats != null)
              _priceRow('In sats', '${_formatSats(result.priceSats!)} sats'),
          ],
        ],
      ),
    );
  }

  Widget _priceRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: [
          SizedBox(
            width: 60,
            child: Text(
              label,
              style: TextStyle(
                fontSize: 13,
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }

  Widget _paymentView(ColorScheme colorScheme) {
    final result = _claimResult!;
    final isPaid = result.bolt11.isEmpty;
    final address = result.address;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (!isPaid) ...[
          // ── Reserved, awaiting payment ─────────────────────────
          Card(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Container(
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: Colors.orange.withValues(alpha: 0.08),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                          color: Colors.orange.withValues(alpha: 0.3)),
                    ),
                    child: Row(
                      children: [
                        Icon(Icons.schedule_rounded,
                            color: Colors.orange.shade700, size: 22),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'Reserved — payment pending',
                                style: TextStyle(
                                  fontWeight: FontWeight.bold,
                                  color: Colors.orange.shade800,
                                ),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                address?.identifier ?? 'Your name',
                                style: const TextStyle(
                                  fontFamily: 'monospace',
                                  fontWeight: FontWeight.w600,
                                  fontSize: 13,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                  Text(
                    'The name is held for you, but only activates once the invoice is paid. Pay now to finish.',
                    style: Theme.of(context)
                        .textTheme
                        .bodyMedium
                        ?.copyWith(color: colorScheme.onSurfaceVariant),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 18),
                  FilledButton.icon(
                    onPressed: _payReserved,
                    icon: const Icon(Icons.bolt_rounded, size: 18),
                    label: Text(
                      _searchResult?.priceSats != null
                          ? 'Pay ${_formatSats(_searchResult!.priceSats!)} sats now'
                          : 'Pay now',
                    ),
                    style: FilledButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 14),
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'In-app wallet, or scan the QR with any wallet on the next step.',
                    style: Theme.of(context)
                        .textTheme
                        .bodySmall
                        ?.copyWith(color: colorScheme.onSurfaceVariant),
                    textAlign: TextAlign.center,
                  ),
                ],
              ),
            ),
          ),
        ] else ...[
          // ── Success ────────────────────────────────────────────
          Card(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                children: [
                  Icon(
                    Icons.check_circle,
                    size: 64,
                    color: Colors.green.shade600,
                  ),
                  const SizedBox(height: 16),
                  Text(
                    'Name claimed!',
                    style: Theme.of(context).textTheme.headlineSmall
                        ?.copyWith(fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 8),
                  if (address != null) ...[
                    SelectableText(
                      address.identifier,
                      style: const TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 18,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 16),
                    FilledButton.icon(
                      onPressed: _publishToProfile,
                      icon: const Icon(Icons.publish, size: 18),
                      label: const Text('Publish to Nostr profile'),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'This sets your NIP-05 identifier so other clients can verify you.',
                      style: Theme.of(context).textTheme.bodySmall
                          ?.copyWith(color: colorScheme.onSurfaceVariant),
                      textAlign: TextAlign.center,
                    ),
                  ],
                ],
              ),
            ),
          ),
        ],
        const SizedBox(height: 16),
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Back to wallet'),
        ),
      ],
    );
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
}
