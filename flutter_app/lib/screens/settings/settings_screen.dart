import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:go_router/go_router.dart';

import '../../providers/app_providers.dart';
import '../../services/relay_pool.dart';
import 'relay_settings_screen.dart';
import '../../services/auth_service.dart';

/// App settings screen: profile, account keys, appearance, relays,
/// notifications, and about.
class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  bool _showNsec = false;
  bool _notificationsEnabled = true;

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authStateProvider);
    final colorScheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        children: [
          // -------------------------------------------------------------------
          // Profile
          // -------------------------------------------------------------------
          _sectionHeader('Profile'),
          if (auth.isLoggedIn)
            ListTile(
              leading: CircleAvatar(
                radius: 24,
                backgroundImage: auth.profile?.picture != null
                    ? CachedNetworkImageProvider(auth.profile!.picture!)
                    : null,
                child: auth.profile?.picture == null
                    ? const Icon(Icons.person)
                    : null,
              ),
              title: Text(
                auth.profile?.displayNameOrName ?? 'Nostr User',
                style: const TextStyle(fontWeight: FontWeight.w600),
              ),
              subtitle: auth.profile?.nip05 != null
                  ? Text(auth.profile!.nip05!)
                  : null,
              trailing: OutlinedButton(
                onPressed: () =>
                    context.push('/profile/${auth.pubkey}'),
                child: const Text('Edit'),
              ),
            )
          else
            ListTile(
              leading: const Icon(Icons.login),
              title: const Text('Log in to manage profile'),
              onTap: () => context.push('/login'),
            ),
          const Divider(),

          // -------------------------------------------------------------------
          // Account
          // -------------------------------------------------------------------
          _sectionHeader('Account'),
          if (auth.isLoggedIn) ...[
            // npub
            ListTile(
              leading: const Icon(Icons.key),
              title: const Text('Public Key (npub)'),
              subtitle: Text(
                _npub(auth),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
              ),
              trailing: IconButton(
                icon: const Icon(Icons.copy, size: 20),
                tooltip: 'Copy npub',
                onPressed: () => _copy(context, _npub(auth), 'npub'),
              ),
            ),
            // nsec (hidden / reveal)
            if (!auth.isReadOnly && auth.privateKey != null)
              ListTile(
                leading: const Icon(Icons.lock),
                title: const Text('Private Key (nsec)'),
                subtitle: Text(
                  _showNsec ? _nsec(auth) : '••••••••••••••••••••••••',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style:
                      const TextStyle(fontFamily: 'monospace', fontSize: 12),
                ),
                trailing: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    IconButton(
                      icon: Icon(
                        _showNsec
                            ? Icons.visibility_off
                            : Icons.visibility,
                        size: 20,
                      ),
                      tooltip: _showNsec ? 'Hide' : 'Reveal',
                      onPressed: () =>
                          setState(() => _showNsec = !_showNsec),
                    ),
                    if (_showNsec)
                      IconButton(
                        icon: const Icon(Icons.copy, size: 20),
                        tooltip: 'Copy nsec',
                        onPressed: () =>
                            _copy(context, _nsec(auth), 'nsec'),
                      ),
                  ],
                ),
              ),
            // Logout
            ListTile(
              leading: Icon(Icons.logout, color: colorScheme.error),
              title: Text('Logout',
                  style: TextStyle(color: colorScheme.error)),
              onTap: () => _confirmLogout(context),
            ),
          ] else
            ListTile(
              leading: const Icon(Icons.login),
              title: const Text('Log in'),
              onTap: () => context.push('/login'),
            ),
          const Divider(),

          // -------------------------------------------------------------------
          // Appearance
          // -------------------------------------------------------------------
          _sectionHeader('Appearance'),
          ListTile(
            leading: const Icon(Icons.palette),
            title: const Text('Theme'),
            subtitle: Text(_themeLabel(ref)),
            trailing: SegmentedButton<ThemeMode>(
              segments: const [
                ButtonSegment(
                    value: ThemeMode.light,
                    icon: Icon(Icons.light_mode, size: 18)),
                ButtonSegment(
                    value: ThemeMode.dark,
                    icon: Icon(Icons.dark_mode, size: 18)),
                ButtonSegment(
                    value: ThemeMode.system,
                    icon: Icon(Icons.settings_brightness, size: 18)),
              ],
              selected: {_currentThemeMode(ref)},
              onSelectionChanged: (modes) {
                final mode = modes.first;
                // The current themeModeProvider is a bool (true = dark).
                // Map: system defaults to dark for now.
                ref.read(themeModeProvider.notifier).state =
                    mode == ThemeMode.dark;
              },
            ),
          ),
          const Divider(),

          // -------------------------------------------------------------------
          // Relays
          // -------------------------------------------------------------------
          _sectionHeader('Relays'),
          _relaySummary(context),
          ListTile(
            leading: const Icon(Icons.hub),
            title: const Text('Manage Relays'),
            subtitle: const Text('Add, remove, configure relay connections'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(
                  builder: (_) => const RelaySettingsScreen()),
            ),
          ),
          const Divider(),

          // -------------------------------------------------------------------
          // Notifications
          // -------------------------------------------------------------------
          _sectionHeader('Notifications'),
          SwitchListTile(
            secondary: const Icon(Icons.notifications),
            title: const Text('Push Notifications'),
            subtitle: const Text('Receive alerts for mentions and zaps'),
            value: _notificationsEnabled,
            onChanged: (val) =>
                setState(() => _notificationsEnabled = val),
          ),
          const Divider(),

          // -------------------------------------------------------------------
          // About
          // -------------------------------------------------------------------
          _sectionHeader('About'),
          const ListTile(
            leading: Icon(Icons.info),
            title: Text('App Version'),
            subtitle: Text('NostrFeed v1.0.0'),
          ),
          ListTile(
            leading: const Icon(Icons.code),
            title: const Text('Source Code'),
            subtitle: const Text('github.com/nostrfeed'),
            trailing: const Icon(Icons.open_in_new, size: 18),
            onTap: () {},
          ),
          ListTile(
            leading: const Icon(Icons.description),
            title: const Text('Terms & Privacy'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () {},
          ),
          const SizedBox(height: 32),
        ],
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  Widget _sectionHeader(String title) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 20, 16, 4),
      child: Text(
        title.toUpperCase(),
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w600,
          color: Theme.of(context).colorScheme.primary,
          letterSpacing: 1.2,
        ),
      ),
    );
  }

  Widget _relaySummary(BuildContext context) {
    final relayStatus = ref.watch(relayStatusProvider);
    final connected =
        relayStatus.values.where((s) => s == RelayState.connected).length;
    final total = relayStatus.isEmpty ? 5 : relayStatus.length;

    return ListTile(
      leading: Stack(
        children: [
          const Icon(Icons.dns, size: 28),
          Positioned(
            right: 0,
            bottom: 0,
            child: Container(
              width: 10,
              height: 10,
              decoration: BoxDecoration(
                color: connected > 0 ? Colors.green : Colors.red,
                shape: BoxShape.circle,
                border: Border.all(
                    color: Theme.of(context).colorScheme.surface, width: 1.5),
              ),
            ),
          ),
        ],
      ),
      title: Text('$connected of $total relays connected'),
      dense: true,
    );
  }

  String _npub(AuthState auth) {
    if (auth.pubkey == null) return '';
    try {
      return ref
          .read(nostrServiceProvider)
          .authService
          .encodeNpub(auth.pubkey!);
    } catch (_) {
      return auth.pubkey!;
    }
  }

  String _nsec(AuthState auth) {
    if (auth.privateKey == null) return '';
    try {
      return ref
          .read(nostrServiceProvider)
          .authService
          .encodeNsec(auth.privateKey!);
    } catch (_) {
      return auth.privateKey!;
    }
  }

  void _copy(BuildContext context, String text, String label) {
    Clipboard.setData(ClipboardData(text: text));
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('$label copied to clipboard')),
    );
  }

  ThemeMode _currentThemeMode(WidgetRef ref) {
    final isDark = ref.watch(themeModeProvider);
    return isDark ? ThemeMode.dark : ThemeMode.light;
  }

  String _themeLabel(WidgetRef ref) {
    final mode = _currentThemeMode(ref);
    return switch (mode) {
      ThemeMode.light => 'Light',
      ThemeMode.dark => 'Dark',
      ThemeMode.system => 'System',
    };
  }

  void _confirmLogout(BuildContext context) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Logout'),
        content: const Text(
            'Are you sure you want to log out? Your keys will be removed from this device.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              ref.read(authStateProvider.notifier).logout();
              Navigator.pop(ctx);
              context.go('/feed');
            },
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(ctx).colorScheme.error,
            ),
            child: const Text('Logout'),
          ),
        ],
      ),
    );
  }
}
