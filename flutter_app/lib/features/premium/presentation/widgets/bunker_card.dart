import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/features/premium/application/bunker_providers.dart';
import 'package:nostrfeed_mobile/features/premium/data/bunker_service.dart';
import 'package:nostrfeed_mobile/features/wallet/application/lnbits_providers.dart';
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';

/// Nostr Bunker — the premium "key held for you" card.
///
/// Three honest states, because two different things can be missing and they
/// are not the same:
///  - extension not installed on the server → "not available here"
///  - not premium → "upgrade to use it"
///  - premium + installed → create/list keys + mint `bunker://` URLs
class BunkerCard extends ConsumerWidget {
  const BunkerCard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    final available = ref.watch(bunkerAvailableProvider);
    final canUse = ref.watch(canUseBunkerProvider);
    final keys = ref.watch(bunkerKeysProvider);

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
                    color: Colors.deepPurple.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: const AppIcon('key', size: 20, color: Colors.deepPurple),
                ),
                const SizedBox(width: 12),
                const Expanded(
                  child: Text(
                    'Nostr Bunker',
                    style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Text(
              'Your key, held for you and used anywhere. Mint a remote-signer '
              '(NIP-46) link — your secret never lives on the device.',
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
                text: "Couldn't check whether this server has the bunker.",
                scheme: scheme,
              ),
              data: (installed) {
                if (!installed) {
                  return _Note(
                    icon: Icons.info_outline_rounded,
                    text:
                        'Not available on this server — the nostr_bunker extension is not installed.',
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
                            'A premium feature. Get a verified name to unlock your bunker.',
                        scheme: scheme,
                      );
                    }
                    return keys.when(
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
                        text: 'Could not load your bunker keys: $e',
                        scheme: scheme,
                      ),
                      data: (list) => _BunkerBody(keys: list),
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

class _BunkerBody extends ConsumerStatefulWidget {
  final List<BunkerKey> keys;
  const _BunkerBody({required this.keys});

  @override
  ConsumerState<_BunkerBody> createState() => _BunkerBodyState();
}

class _BunkerBodyState extends ConsumerState<_BunkerBody> {
  bool _busy = false;
  final Map<String, List<BunkerConnection>> _connections = {};

  @override
  void initState() {
    super.initState();
    _loadConnections();
  }

  Future<void> _loadConnections() async {
    final token = ref.read(lnbitsAuthProvider).token;
    if (token == null) return;
    final service = ref.read(bunkerServiceProvider);
    for (final key in widget.keys) {
      try {
        final conns = await service.listConnections(
          token: token,
          bunkersDataId: key.id,
        );
        if (mounted) setState(() => _connections[key.id] = conns);
      } catch (_) {}
    }
  }

  Future<void> _createKey() async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      final token = ref.read(lnbitsAuthProvider).token;
      if (token == null) throw StateError('No wallet session');
      await ref
          .read(bunkerServiceProvider)
          .createKey(token: token, name: 'My key');
      ref.invalidate(bunkerKeysProvider);
      if (mounted) {
        AppToast.success(context, 'Bunker key created — mint a link below');
      }
    } catch (e) {
      if (mounted) AppToast.error(context, '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _mintConnection(BunkerKey key) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      final token = ref.read(lnbitsAuthProvider).token;
      if (token == null) throw StateError('No wallet session');
      final conn = await ref.read(bunkerServiceProvider).createConnection(
            token: token,
            bunkersDataId: key.id,
            name: 'App link',
            // Read + sign, no auto-sign (each request confirmed on the device
            // holding the bunker session).
            confirmSign: true,
          );
      final url = conn.bunkerUrl;
      if (mounted) {
        if (url != null && url.isNotEmpty) {
          Clipboard.setData(ClipboardData(text: url));
          AppToast.success(context, 'bunker:// link copied — paste it in any client');
        } else {
          AppToast.success(context, 'Connection created');
        }
        _loadConnections();
      }
    } catch (e) {
      if (mounted) AppToast.error(context, '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    if (widget.keys.isEmpty) {
      return SizedBox(
        width: double.infinity,
        child: FilledButton.tonalIcon(
          onPressed: _busy ? null : _createKey,
          icon: _busy
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const AppIcon('plus', size: 18),
          label: const Text('Create my bunker key'),
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final key in widget.keys) ...[
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Colors.deepPurple.withValues(alpha: 0.06),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: Colors.deepPurple.withValues(alpha: 0.2)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const AppIcon('verified', size: 16, color: Colors.deepPurple),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        key.name,
                        style: const TextStyle(
                            fontWeight: FontWeight.w600, fontSize: 14),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                for (final conn in _connections[key.id] ?? const <BunkerConnection>[])
                  Padding(
                    padding: const EdgeInsets.only(bottom: 4),
                    child: Row(
                      children: [
                        AppIcon('link', size: 14, color: scheme.onSurfaceVariant),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            conn.name ?? 'bunker:// link',
                            style: TextStyle(
                              fontSize: 12,
                              color: scheme.onSurfaceVariant,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                const SizedBox(height: 6),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton.tonalIcon(
                    onPressed: _busy ? null : () => _mintConnection(key),
                    icon: const AppIcon('qr', size: 16),
                    label: const Text('Mint a bunker:// link'),
                  ),
                ),
              ],
            ),
          ),
        ],
        const SizedBox(height: 6),
        Text(
          'Each link asks before it signs. Revoke it from the wallet any time.',
          style: TextStyle(fontSize: 11, color: scheme.onSurfaceVariant),
        ),
      ],
    );
  }
}
