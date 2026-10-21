import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/nostr/relay_pool.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/features/settings/providers/relay_settings_providers.dart';

/// Relay management: connection status per relay, read/write intent that
/// actually drives queries and publishes, and NIP-65 list sync.
///
/// The set is persisted locally and (on demand) published as a NIP-65
/// kind 10002 list, so the same relays follow the user across clients.
class RelaySettingsScreen extends ConsumerStatefulWidget {
  const RelaySettingsScreen({super.key});

  @override
  ConsumerState<RelaySettingsScreen> createState() =>
      _RelaySettingsScreenState();
}

class _RelaySettingsScreenState extends ConsumerState<RelaySettingsScreen> {
  final _addRelayController = TextEditingController();
  Timer? _statusTimer;
  bool _syncBusy = false;

  static const _suggestedRelays = [
    'wss://relay.damus.io',
    'wss://relay.nostr.band',
    'wss://relay.primal.net',
    'wss://nos.lol',
    'wss://nostr.wine',
    'wss://relay.snort.social',
    'wss://nostr.mom',
    'wss://relay.nostrfeed.com',
  ];

  @override
  void initState() {
    super.initState();
    // Connection state changes on its own (reconnects, auth) — refresh the
    // status map periodically while the screen is open rather than never.
    _statusTimer = Timer.periodic(const Duration(seconds: 2), (_) {
      final pool = ref.read(nostrServiceProvider).relayPool;
      ref.read(relayStatusProvider.notifier).state = pool.relayStates;
    });
  }

  @override
  void dispose() {
    _statusTimer?.cancel();
    _addRelayController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final relays = ref.watch(relaySettingsProvider);
    final relayStatus = ref.watch(relayStatusProvider);
    final colorScheme = Theme.of(context).colorScheme;
    final auth = ref.watch(authStateProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Relays'),
        actions: [
          if (auth.isLoggedIn && !auth.isReadOnly)
            IconButton(
              icon: _syncBusy
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.cloud_sync_outlined),
              tooltip: 'Sync with NIP-65 list',
              onPressed: _syncBusy ? null : _syncNip65,
            ),
        ],
      ),
      body: ListView(
        children: [
          _sectionHeader('CONNECTED RELAYS', colorScheme),
          if (relays.isEmpty)
            Padding(
              padding: const EdgeInsets.all(24),
              child: Center(
                child: Text(
                  'No relays configured. Add one below.',
                  style: TextStyle(color: colorScheme.onSurfaceVariant),
                ),
              ),
            )
          else
            ...relays.map(
              (r) => _relayTile(
                context,
                r,
                relayStatus[r.url] ?? RelayState.disconnected,
              ),
            ),

          const Divider(height: 32),
          _sectionHeader('ADD RELAY', colorScheme),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _addRelayController,
                    decoration: InputDecoration(
                      hintText: 'wss://relay.example.com',
                      prefixIcon: const Icon(Icons.add_link),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                      contentPadding: const EdgeInsets.symmetric(
                          horizontal: 12, vertical: 10),
                    ),
                    keyboardType: TextInputType.url,
                    onSubmitted: (_) => _addRelay(),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton.filled(
                  onPressed: _addRelay,
                  icon: const Icon(Icons.add),
                  tooltip: 'Add relay',
                ),
              ],
            ),
          ),

          const Divider(height: 32),
          _sectionHeader('SUGGESTED RELAYS', colorScheme),
          ..._suggestedRelays
              .where((url) => !relays.any(
                  (r) => r.url == url.replaceAll(RegExp(r'/$'), '')))
              .map(
                (url) => ListTile(
                  leading: const Icon(Icons.cloud_outlined),
                  title: Text(
                    url,
                    style: const TextStyle(
                        fontFamily: 'monospace', fontSize: 13),
                  ),
                  trailing: IconButton(
                    icon: Icon(Icons.add_circle_outline,
                        color: colorScheme.primary),
                    tooltip: 'Add this relay',
                    onPressed: () => ref
                        .read(relaySettingsProvider.notifier)
                        .addRelay(url),
                  ),
                  dense: true,
                ),
              ),

          const Divider(height: 32),
          Padding(
            padding: const EdgeInsets.all(16),
            child: Text(
              'Read relays are queried for posts; write relays receive what '
              'you publish. "Sync" publishes this set as your NIP-65 relay '
              'list (kind 10002) and merges the one already on the network, '
              'so other clients use the same relays.',
              style: TextStyle(
                fontSize: 12,
                color: colorScheme.onSurfaceVariant,
                height: 1.4,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _sectionHeader(String title, ColorScheme colorScheme) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
      child: Text(
        title,
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w600,
          color: colorScheme.primary,
          letterSpacing: 1.2,
        ),
      ),
    );
  }

  Widget _relayTile(BuildContext context, ManagedRelay relay, RelayState state) {
    final colorScheme = Theme.of(context).colorScheme;

    final (statusColor, statusLabel) = switch (state) {
      RelayState.connected => (Colors.green, 'Connected'),
      RelayState.connecting => (Colors.orange, 'Connecting'),
      RelayState.authRequired => (Colors.blue, 'Auth required'),
      RelayState.disconnected => (Colors.red, 'Disconnected'),
      RelayState.error => (Colors.red, 'Error'),
    };

    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Column(
          children: [
            ListTile(
              leading: Container(
                width: 12,
                height: 12,
                decoration: BoxDecoration(
                  color: statusColor,
                  shape: BoxShape.circle,
                  boxShadow: [
                    BoxShadow(
                        color: statusColor.withValues(alpha: 0.4),
                        blurRadius: 4),
                  ],
                ),
              ),
              title: Text(
                relay.url,
                style: const TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 13,
                    fontWeight: FontWeight.w500),
              ),
              subtitle: Text(
                statusLabel,
                style: TextStyle(color: statusColor, fontSize: 12),
              ),
              trailing: IconButton(
                icon: Icon(Icons.delete_outline, color: colorScheme.error),
                tooltip: 'Remove relay',
                onPressed: () => _removeRelay(relay.url),
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Row(
                children: [
                  Expanded(
                    child: _toggleChip(
                      'Read',
                      relay.read,
                      (val) => ref
                          .read(relaySettingsProvider.notifier)
                          .setRead(relay.url, val),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: _toggleChip(
                      'Write',
                      relay.write,
                      (val) => ref
                          .read(relaySettingsProvider.notifier)
                          .setWrite(relay.url, val),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }

  Widget _toggleChip(String label, bool value, ValueChanged<bool> onChanged) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(label, style: const TextStyle(fontSize: 13)),
        const Spacer(),
        Switch(
          value: value,
          onChanged: onChanged,
          materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
        ),
      ],
    );
  }

  void _addRelay() {
    final url = _addRelayController.text.trim();
    if (url.isEmpty) return;
    if (!url.startsWith('wss://') && !url.startsWith('ws://')) {
      AppToast.warning(context, 'Relay URL must start with wss://');
      return;
    }
    ref.read(relaySettingsProvider.notifier).addRelay(url);
    _addRelayController.clear();
    AppToast.success(context, 'Relay added');
  }

  void _removeRelay(String url) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Remove relay'),
        content: Text('Remove $url?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              ref.read(relaySettingsProvider.notifier).removeRelay(url);
              Navigator.pop(ctx);
            },
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(ctx).colorScheme.error,
            ),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
  }

  Future<void> _syncNip65() async {
    setState(() => _syncBusy = true);
    try {
      final notifier = ref.read(relaySettingsProvider.notifier);
      // Merge the network list first (remote wins for relays it names),
      // then publish the merged set back so every client agrees.
      await notifier.mergeFromNetwork();
      final ok = await notifier.publishList();
      if (!mounted) return;
      if (ok) {
        AppToast.success(context, 'Relay list synced (NIP-65)');
      } else {
        AppToast.error(context, 'Could not publish the relay list');
      }
    } finally {
      if (mounted) setState(() => _syncBusy = false);
    }
  }
}
