import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import 'package:nostrfeed_mobile/core/moderation/moderation_providers.dart';
import 'package:nostrfeed_mobile/core/providers/app_info_providers.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/widgets/safe_image.dart';
import 'package:nostrfeed_mobile/core/nostr/relay_pool.dart';
import 'package:nostrfeed_mobile/features/settings/relay_settings_screen.dart';
import 'package:nostrfeed_mobile/features/settings/widgets/wallet_settings_section.dart';
import 'package:nostrfeed_mobile/features/auth/services/auth_service.dart';

/// App settings screen: profile, account keys, appearance, relays,
/// notifications, and about.
class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  Future<void> _openUrl(String url) async {
    final uri = Uri.parse(url);
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

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
              leading: SafeAvatar(
                imageUrl: auth.profile?.picture,
                radius: 24,
                fallback: const Icon(Icons.person),
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
          // Wallet
          // -------------------------------------------------------------------
          _sectionHeader('Wallet'),
          const WalletSettingsSection(),
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
                ref.read(themeModeProvider.notifier).state = modes.first;
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
          // Content filters
          // -------------------------------------------------------------------
          _sectionHeader('Content filters'),
          SwitchListTile(
            secondary: const Icon(Icons.visibility_off_outlined),
            title: const Text('Hide explicit content'),
            subtitle: const Text(
                'NSFW posts, profiles and names, in any language'),
            value: ref.watch(nsfwFilterProvider),
            onChanged: (val) =>
                ref.read(nsfwFilterProvider.notifier).toggle(val),
          ),
          SwitchListTile(
            secondary: const Icon(Icons.link_off_rounded),
            title: const Text('Hide spam links'),
            subtitle: const Text(
                'Link dumps, search-spam links and known spam domains'),
            value: ref.watch(spamFilterProvider),
            onChanged: (val) =>
                ref.read(spamFilterProvider.notifier).toggle(val),
          ),
          ListTile(
            leading: const Icon(Icons.text_fields_rounded),
            title: const Text('Blocked words'),
            subtitle: Text(
              ref.watch(blockedWordsProvider).isEmpty
                  ? 'Posts containing these words are hidden'
                  : '${ref.watch(blockedWordsProvider).length} blocked',
            ),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => _showBlockedWordsSheet(context),
          ),
          ListTile(
            leading: const Icon(Icons.person_off_outlined),
            title: const Text('Blocked accounts'),
            subtitle: Text(
              ref.watch(blockedAuthorsProvider).isEmpty
                  ? 'Accounts you have blocked'
                  : '${ref.watch(blockedAuthorsProvider).length} blocked',
            ),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => _showBlockedAuthorsSheet(context),
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
          ListTile(
            leading: const Icon(Icons.info),
            title: const Text('App Version'),
            subtitle: Text(
              ref.watch(appVersionProvider).isEmpty
                  ? 'NostrFeed'
                  : 'NostrFeed v${ref.watch(appVersionProvider)}',
            ),
          ),
          ListTile(
            leading: const Icon(Icons.code),
            title: const Text('Source Code'),
            subtitle: const Text('github.com/nostrfeed'),
            trailing: const Icon(Icons.open_in_new, size: 18),
            onTap: () => _openUrl('https://github.com/nostrfeed'),
          ),
          ListTile(
            leading: const Icon(Icons.description),
            title: const Text('Terms & Privacy'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => _openUrl('https://nostrfeed.com/terms'),
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
    return ref.watch(themeModeProvider);
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

  void _showBlockedWordsSheet(BuildContext context) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => const _BlockedWordsSheet(),
    );
  }

  void _showBlockedAuthorsSheet(BuildContext context) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => const _BlockedAuthorsSheet(),
    );
  }
}

// ─── Blocked words management ───────────────────────────────────────────

class _BlockedWordsSheet extends ConsumerStatefulWidget {
  const _BlockedWordsSheet();

  @override
  ConsumerState<_BlockedWordsSheet> createState() =>
      _BlockedWordsSheetState();
}

class _BlockedWordsSheetState extends ConsumerState<_BlockedWordsSheet> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final words = ref.watch(blockedWordsProvider).toList()..sort();
    final scheme = Theme.of(context).colorScheme;

    return Padding(
      padding: EdgeInsets.only(
        left: 16,
        right: 16,
        top: 16,
        bottom: MediaQuery.viewInsetsOf(context).bottom + 16,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Blocked words',
            style: Theme.of(context)
                .textTheme
                .titleMedium
                ?.copyWith(fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 4),
          Text(
            'Any post containing one of these words is hidden. They sync to '
            'your NIP-51 mute list when you are logged in.',
            style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _controller,
                  decoration: const InputDecoration(
                    hintText: 'Add a word…',
                    isDense: true,
                  ),
                  onSubmitted: (_) => _add(),
                ),
              ),
              const SizedBox(width: 8),
              FilledButton(onPressed: _add, child: const Text('Add')),
            ],
          ),
          const SizedBox(height: 12),
          if (words.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 16),
              child: Text(
                'No blocked words yet.',
                textAlign: TextAlign.center,
                style: TextStyle(color: scheme.onSurfaceVariant),
              ),
            )
          else
            Flexible(
              child: ListView.builder(
                shrinkWrap: true,
                itemCount: words.length,
                itemBuilder: (context, i) => ListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  title: Text(words[i]),
                  trailing: IconButton(
                    icon: const Icon(Icons.close, size: 18),
                    onPressed: () => ref
                        .read(blockedWordsProvider.notifier)
                        .remove(words[i]),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Future<void> _add() async {
    final word = _controller.text.trim();
    if (word.isEmpty) return;
    await ref.read(blockedWordsProvider.notifier).add(word);
    _controller.clear();
  }
}

// ─── Blocked accounts management ────────────────────────────────────────

class _BlockedAuthorsSheet extends ConsumerWidget {
  const _BlockedAuthorsSheet();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final blocked = ref.watch(blockedAuthorsProvider).toList();
    final scheme = Theme.of(context).colorScheme;

    return Padding(
      padding: EdgeInsets.only(
        left: 16,
        right: 16,
        top: 16,
        bottom: MediaQuery.viewInsetsOf(context).bottom + 16,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Blocked accounts',
            style: Theme.of(context)
                .textTheme
                .titleMedium
                ?.copyWith(fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 4),
          Text(
            'Their posts, profiles and messages are hidden. The list syncs '
            'to your NIP-51 mute list when you are logged in.',
            style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
          ),
          const SizedBox(height: 12),
          if (blocked.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 16),
              child: Text(
                'No blocked accounts. Block someone from a post’s menu.',
                textAlign: TextAlign.center,
                style: TextStyle(color: scheme.onSurfaceVariant),
              ),
            )
          else
            Flexible(
              child: ListView.builder(
                shrinkWrap: true,
                itemCount: blocked.length,
                itemBuilder: (context, i) {
                  final pk = blocked[i];
                  final profile =
                      ref.watch(profileProvider(pk)).valueOrNull;
                  return ListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    leading: SafeAvatar(
                      imageUrl: profile?.picture,
                      radius: 16,
                      fallback: const Icon(Icons.person, size: 16),
                    ),
                    title: Text(
                      profile?.displayNameOrName ??
                          '${pk.substring(0, 12)}…',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    trailing: TextButton(
                      onPressed: () =>
                          ref.read(blockedAuthorsProvider.notifier).remove(pk),
                      child: const Text('Unblock'),
                    ),
                  );
                },
              ),
            ),
        ],
      ),
    );
  }
}
