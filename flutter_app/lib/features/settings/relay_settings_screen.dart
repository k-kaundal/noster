import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/nostr/nostr_service.dart';
import 'package:nostrfeed_mobile/core/nostr/relay_pool.dart';

/// Relay management screen: view connected relays, toggle read/write,
/// add new relays, and see suggested relays.
class RelaySettingsScreen extends ConsumerStatefulWidget {
  const RelaySettingsScreen({super.key});

  @override
  ConsumerState<RelaySettingsScreen> createState() =>
      _RelaySettingsScreenState();
}

class _RelaySettingsScreenState extends ConsumerState<RelaySettingsScreen> {
  final _addRelayController = TextEditingController();

  /// Well-known relays suggested for quick adding.
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

  // Local read/write state (not yet persisted to relay config events).
  final Map<String, bool> _readStates = {};
  final Map<String, bool> _writeStates = {};

  @override
  void dispose() {
    _addRelayController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final relayStatus = ref.watch(relayStatusProvider);
    final colorScheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(title: const Text('Relays')),
      body: ListView(
        children: [
          // -------------------------------------------------------------------
          // Connected relays
          // -------------------------------------------------------------------
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
            child: Text(
              'CONNECTED RELAYS',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: colorScheme.primary,
                letterSpacing: 1.2,
              ),
            ),
          ),
          if (relayStatus.isEmpty)
            Padding(
              padding: const EdgeInsets.all(24),
              child: Center(
                child: Text(
                  'No relays connected',
                  style: TextStyle(color: colorScheme.onSurfaceVariant),
                ),
              ),
            )
          else
            ...relayStatus.entries.map((entry) =>
                _relayTile(context, entry.key, entry.value)),

          const Divider(height: 32),

          // -------------------------------------------------------------------
          // Add relay
          // -------------------------------------------------------------------
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
            child: Text(
              'ADD RELAY',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: colorScheme.primary,
                letterSpacing: 1.2,
              ),
            ),
          ),
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

          // -------------------------------------------------------------------
          // Suggested relays
          // -------------------------------------------------------------------
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
            child: Text(
              'SUGGESTED RELAYS',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: colorScheme.primary,
                letterSpacing: 1.2,
              ),
            ),
          ),
          ..._suggestedRelays
              .where((url) => !relayStatus.containsKey(url))
              .map((url) => ListTile(
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
                      onPressed: () => _addSuggestedRelay(url),
                    ),
                    dense: true,
                  )),
          const SizedBox(height: 32),
        ],
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Relay tile
  // ---------------------------------------------------------------------------

  Widget _relayTile(BuildContext context, String url, RelayState state) {
    final colorScheme = Theme.of(context).colorScheme;

    // Initialise toggles if not yet set.
    _readStates.putIfAbsent(url, () => true);
    _writeStates.putIfAbsent(url, () => true);

    Color statusColor;
    String statusLabel;
    switch (state) {
      case RelayState.connected:
        statusColor = Colors.green;
        statusLabel = 'Connected';
        break;
      case RelayState.connecting:
        statusColor = Colors.orange;
        statusLabel = 'Connecting';
        break;
      case RelayState.authRequired:
        statusColor = Colors.blue;
        statusLabel = 'Auth Required';
        break;
      case RelayState.disconnected:
        statusColor = Colors.red;
        statusLabel = 'Disconnected';
        break;
      case RelayState.error:
        statusColor = Colors.red;
        statusLabel = 'Error';
        break;
    }

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
                        color: statusColor.withValues(alpha: 0.4), blurRadius: 4),
                  ],
                ),
              ),
              title: Text(
                url,
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
                icon:
                    Icon(Icons.delete_outline, color: colorScheme.error),
                tooltip: 'Remove relay',
                onPressed: () => _removeRelay(url),
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Row(
                children: [
                  Expanded(
                    child: _toggleChip(
                      'Read',
                      _readStates[url]!,
                      (val) => setState(() => _readStates[url] = val),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: _toggleChip(
                      'Write',
                      _writeStates[url]!,
                      (val) => setState(() => _writeStates[url] = val),
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

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  void _addRelay() {
    final url = _addRelayController.text.trim();
    if (url.isEmpty) return;
    if (!url.startsWith('wss://') && !url.startsWith('ws://')) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('Relay URL must start with wss:// or ws://')),
      );
      return;
    }

    final nostr = ref.read(nostrServiceProvider);
    nostr.relayPool.addRelay(url);
    _updateRelayStatus(nostr);
    _addRelayController.clear();
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Added $url')),
    );
  }

  void _addSuggestedRelay(String url) {
    final nostr = ref.read(nostrServiceProvider);
    nostr.relayPool.addRelay(url);
    _updateRelayStatus(nostr);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Added $url')),
    );
  }

  void _removeRelay(String url) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Remove Relay'),
        content: Text('Remove $url?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              final nostr = ref.read(nostrServiceProvider);
              nostr.relayPool.removeRelay(url);
              _updateRelayStatus(nostr);
              _readStates.remove(url);
              _writeStates.remove(url);
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

  void _updateRelayStatus(NostrService nostr) {
    ref.read(relayStatusProvider.notifier).state =
        nostr.relayPool.relayStates;
  }
}
