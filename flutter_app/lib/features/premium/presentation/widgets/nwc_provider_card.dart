import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/features/premium/application/nwc_provider_providers.dart';
import 'package:nostrfeed_mobile/features/premium/data/nwc_provider_service.dart';
import 'package:nostrfeed_mobile/features/wallet/application/lnbits_providers.dart';
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';

/// NWC Provider — mint `nostr+walletconnect://` links for your own wallet.
///
/// Three honest states (extension missing / not premium / ready), same shape
/// as the bunker card.
class NwcProviderCard extends ConsumerWidget {
  const NwcProviderCard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final available = ref.watch(nwcProviderAvailableProvider);
    final canUse = ref.watch(canUseNwcProviderProvider);
    final connections = ref.watch(nwcConnectionsProvider);

    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: Colors.teal.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: const AppIcon('globe', size: 20, color: Colors.teal),
                ),
                const SizedBox(width: 12),
                const Expanded(
                  child: Text(
                    'Wallet Connect (NWC)',
                    style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Text(
              'Share access to your wallet with any NWC app — capped, '
              'permissioned, and revocable, without handing over the key.',
              style: TextStyle(
                fontSize: 13,
                color: scheme.onSurfaceVariant,
                height: 1.45,
              ),
            ),
            const SizedBox(height: 12),
            available.when(
              loading: () => const Padding(
                padding: EdgeInsets.all(8),
                child: Center(
                  child: SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                ),
              ),
              error: (_, _) => _Note(
                icon: Icons.cloud_off_rounded,
                text: "Couldn't check whether this server has NWC.",
                scheme: scheme,
              ),
              data: (installed) {
                if (!installed) {
                  return _Note(
                    icon: Icons.info_outline_rounded,
                    text:
                        'Not available on this server — the nwcprovider extension is not installed.',
                    scheme: scheme,
                  );
                }
                return canUse.when(
                  loading: () => const SizedBox.shrink(),
                  error: (_, _) => const SizedBox.shrink(),
                  data: (allowed) {
                    if (!allowed) {
                      return _Note(
                        icon: Icons.lock_outline_rounded,
                        text:
                            'A premium feature. Get a verified name to mint NWC links.',
                        scheme: scheme,
                      );
                    }
                    return connections.when(
                      loading: () => const Padding(
                        padding: EdgeInsets.all(8),
                        child: Center(
                          child: SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          ),
                        ),
                      ),
                      error: (e, _) => _Note(
                        icon: Icons.error_outline_rounded,
                        text: 'Could not load your connections: $e',
                        scheme: scheme,
                      ),
                      data: (list) => _NwcBody(connections: list),
                    );
                  },
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _Note extends StatelessWidget {
  final IconData icon;
  final String text;
  final ColorScheme scheme;
  const _Note({required this.icon, required this.text, required this.scheme});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: [
          Icon(icon, size: 18, color: scheme.onSurfaceVariant),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              text,
              style: TextStyle(fontSize: 13, color: scheme.onSurfaceVariant),
            ),
          ),
        ],
      ),
    );
  }
}

class _NwcBody extends ConsumerStatefulWidget {
  final List<NwcProviderConnection> connections;
  const _NwcBody({required this.connections});

  @override
  ConsumerState<_NwcBody> createState() => _NwcBodyState();
}

class _NwcBodyState extends ConsumerState<_NwcBody> {
  bool _busy = false;

  Future<void> _create() async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      final lnbits = ref.read(lnbitsAuthProvider);
      final token = lnbits.token;
      final wallet = lnbits.activeWallet;
      if (token == null || wallet == null) {
        throw StateError('Connect your wallet first');
      }
      final (conn, uri) = await ref
          .read(nwcProviderServiceProvider)
          .registerConnection(
            token: token,
            pubkey: wallet.id,
            permissions: const ['pay_invoice', 'get_balance', 'make_invoice'],
            description: 'From NostrFeed',
          );
      ref.invalidate(nwcConnectionsProvider);
      if (!mounted) return;
      // Show the pairing URI ONCE — the secret is not recoverable later.
      await showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Your NWC link'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Shown once — save it now. Anyone holding it can spend within the cap you set.',
                style: Theme.of(ctx).textTheme.bodyMedium,
              ),
              const SizedBox(height: 12),
              SelectableText(
                uri.isNotEmpty ? uri : conn.pubkey,
                style: const TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 11,
                    fontWeight: FontWeight.w600),
              ),
            ],
          ),
          actions: [
            if (uri.isNotEmpty)
              TextButton(
                onPressed: () {
                  Clipboard.setData(ClipboardData(text: uri));
                  Navigator.pop(ctx);
                  AppToast.success(context, 'NWC link copied');
                },
                child: const Text('Copy'),
              ),
            FilledButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Done'),
            ),
          ],
        ),
      );
    } catch (e) {
      if (mounted) AppToast.error(context, '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _revoke(NwcProviderConnection conn) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      final token = ref.read(lnbitsAuthProvider).token;
      if (token == null) throw StateError('No wallet session');
      await ref
          .read(nwcProviderServiceProvider)
          .deleteConnection(token: token, pubkey: conn.pubkey);
      ref.invalidate(nwcConnectionsProvider);
      if (mounted) AppToast.success(context, 'Connection revoked');
    } catch (e) {
      if (mounted) AppToast.error(context, '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final conn in widget.connections) ...[
          Container(
            margin: const EdgeInsets.only(bottom: 8),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Colors.teal.withValues(alpha: 0.06),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: Colors.teal.withValues(alpha: 0.2)),
            ),
            child: Row(
              children: [
                const AppIcon('link', size: 16, color: Colors.teal),
                const SizedBox(width: 8),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        conn.description ?? '${conn.pubkey.substring(0, 12)}…',
                        style: const TextStyle(
                            fontWeight: FontWeight.w600, fontSize: 13),
                      ),
                      Text(
                        conn.permissions.join(' · '),
                        style: TextStyle(
                            fontSize: 11, color: scheme.onSurfaceVariant),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  icon: AppIcon('eye_off', size: 18, color: scheme.error),
                  tooltip: 'Revoke',
                  onPressed: _busy ? null : () => _revoke(conn),
                ),
              ],
            ),
          ),
        ],
        SizedBox(
          width: double.infinity,
          child: FilledButton.tonalIcon(
            onPressed: _busy ? null : _create,
            icon: _busy
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const AppIcon('link', size: 18),
            label: const Text('Mint an NWC link'),
          ),
        ),
      ],
    );
  }
}
