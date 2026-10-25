import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nostrfeed_mobile/core/moderation/moderation_providers.dart';
import 'package:nostrfeed_mobile/core/nostr/relay/relay_pool.dart';
import 'package:nostrfeed_mobile/core/providers/app_info_providers.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/services/background_sync.dart';
import 'package:nostrfeed_mobile/core/theme/app_shapes.dart';
import 'package:nostrfeed_mobile/core/theme/app_spacing.dart';
import 'package:nostrfeed_mobile/core/theme/app_theme.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/core/widgets/safe_image.dart';
import 'package:nostrfeed_mobile/features/auth/data/auth_service.dart';
import 'package:nostrfeed_mobile/features/settings/presentation/relay_settings_screen.dart';
import 'package:nostrfeed_mobile/features/settings/presentation/widgets/wallet_settings_section.dart';
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';
import 'package:url_launcher/url_launcher.dart';

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
                fallback: const AppIcon('users'),
              ),
              title: Text(
                auth.profile?.displayNameOrName ?? 'Nostr User',
                style: Theme.of(context)
                    .textTheme
                    .titleSmall
                    ?.copyWith(fontWeight: FontWeight.w600),
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
              leading: const AppIcon('key'),
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
              leading: const AppIcon('key'),
              title: const Text('Public Key (npub)'),
              subtitle: Text(
                _npub(auth),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context)
                    .textTheme
                    .bodySmall
                    ?.copyWith(fontFamily: 'monospace'),
              ),
              trailing: IconButton(
                icon: const AppIcon('edit', size: 20),
                tooltip: 'Copy npub',
                onPressed: () => _copy(context, _npub(auth), 'npub'),
              ),
            ),
            // nsec (hidden / reveal)
            if (!auth.isReadOnly && auth.privateKey != null)
              ListTile(
                leading: const AppIcon('key'),
                title: const Text('Private Key (nsec)'),
                subtitle: Text(
                  _showNsec ? _nsec(auth) : '••••••••••••••••••••••••',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context)
                      .textTheme
                      .bodySmall
                      ?.copyWith(fontFamily: 'monospace'),
                ),
                trailing: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    IconButton(
                      icon: AppIcon(
                        _showNsec ? 'eye_off' : 'eye',
                        size: AppIconSize.md,
                      ),
                      tooltip: _showNsec ? 'Hide' : 'Reveal',
                      onPressed: () =>
                          setState(() => _showNsec = !_showNsec),
                    ),
                    if (_showNsec)
                      IconButton(
                        icon: const AppIcon('edit', size: AppIconSize.md),
                        tooltip: 'Copy nsec',
                        onPressed: () =>
                            _copy(context, _nsec(auth), 'nsec'),
                      ),
                  ],
                ),
              ),
            // Logout
            ListTile(
              leading: AppIcon('back', color: colorScheme.error),
              title: Text(
                'Logout',
                style: Theme.of(context)
                    .textTheme
                    .bodyLarge
                    ?.copyWith(color: colorScheme.error),
              ),
              onTap: () => _confirmLogout(context),
            ),
          ] else
            ListTile(
              leading: const AppIcon('key'),
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
          Padding(
            padding: const EdgeInsets.fromLTRB(
                AppSpacing.md, 0, AppSpacing.md, AppSpacing.xs),
            child: Row(
              children: [
                for (final mode in AppAppearance.values) ...[
                  Expanded(
                    child: _AppearanceSwatch(
                      mode: mode,
                      selected: ref.watch(appAppearanceProvider) == mode,
                      onTap: () => ref
                          .read(appAppearanceProvider.notifier)
                          .setAppearance(mode),
                    ),
                  ),
                  if (mode != AppAppearance.values.last)
                    const SizedBox(width: AppSpacing.xs),
                ],
              ],
            ),
          ),
          const Divider(),

          // -------------------------------------------------------------------
          // Relays
          // -------------------------------------------------------------------
          _sectionHeader('Relays'),
          _relaySummary(context),
          ListTile(
            leading: const AppIcon('globe'),
            title: const Text('Manage Relays'),
            subtitle: const Text('Add, remove, configure relay connections'),
            trailing: const AppIcon('chevron_r'),
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(
                  builder: (_) => const RelaySettingsScreen()),
            ),
          ),
          const Divider(),

          // -------------------------------------------------------------------
          // Background updates (ADR-0005 P5)
          // -------------------------------------------------------------------
          _sectionHeader('Background updates'),
          SwitchListTile(
            secondary: const AppIcon('repost'),
            title: const Text('Background catch-up'),
            subtitle: const Text(
                'Periodically fetch new messages and activity while the app is closed. Battery-friendly — no persistent connection.'),
            value: ref.watch(backgroundSyncEnabledProvider).value ?? true,
            onChanged: (val) => ref
                .read(backgroundSyncEnabledProvider.notifier)
                .toggle(val),
          ),
          // Phase 4 (ADR-0007): the opt-in continuous tier — a dataSync
          // foreground-service sync window. Android-only (iOS has no FGS
          // concept; the hourly catch-up above is the only tier there).
          if (syncWindowSupported)
            SwitchListTile(
              secondary: const AppIcon('zap'),
              title: const Text('Stay synced (faster)'),
              subtitle: const Text(
                  'Keep syncing continuously in the background with a low-priority status icon. Uses more battery than catch-up. Android may pause it to save power.'),
              value: ref.watch(syncWindowEnabledProvider).value ?? false,
              onChanged: (val) => ref
                  .read(syncWindowEnabledProvider.notifier)
                  .toggle(val),
            ),
          const Divider(),

          // -------------------------------------------------------------------
          // Content filters
          // -------------------------------------------------------------------
          _sectionHeader('Content filters'),
          SwitchListTile(
            secondary: const AppIcon('eye_off'),
            title: const Text('Hide explicit content'),
            subtitle: const Text(
                'NSFW posts, profiles and names, in any language'),
            value: ref.watch(nsfwFilterProvider),
            onChanged: (val) =>
                ref.read(nsfwFilterProvider.notifier).toggle(val),
          ),
          // Three-option sensitive-content display (blueprint's user
          // preference layer): hide / blur-until-tapped / allow.
          ListTile(
            leading: const AppIcon('eye_off'),
            title: const Text('Sensitive content display'),
            subtitle: const Text(
                'How posts marked sensitive (by author or detector) show'),
            trailing: SegmentedButton<SensitiveContentMode>(
              showSelectedIcon: false,
              segments: const [
                ButtonSegment(
                    value: SensitiveContentMode.hide,
                    icon: AppIcon('eye_off', size: 16)),
                ButtonSegment(
                    value: SensitiveContentMode.blur,
                    icon: AppIcon('eye_off', size: 16)),
                ButtonSegment(
                    value: SensitiveContentMode.allow,
                    icon: AppIcon('eye', size: 16)),
              ],
              selected: {ref.watch(sensitiveModeProvider)},
              onSelectionChanged: (modes) => ref
                  .read(sensitiveModeProvider.notifier)
                  .setMode(modes.first),
            ),
          ),
          SwitchListTile(
            secondary: const AppIcon('link'),
            title: const Text('Hide spam links'),
            subtitle: const Text(
                'Link dumps, search-spam links and known spam domains'),
            value: ref.watch(spamFilterProvider),
            onChanged: (val) =>
                ref.read(spamFilterProvider.notifier).toggle(val),
          ),
          ListTile(
            leading: const AppIcon('edit'),
            title: const Text('Blocked words'),
            subtitle: Text(
              ref.watch(blockedWordsProvider).isEmpty
                  ? 'Posts containing these words are hidden'
                  : '${ref.watch(blockedWordsProvider).length} blocked',
            ),
            trailing: const AppIcon('chevron_r'),
            onTap: () => _showBlockedWordsSheet(context),
          ),
          ListTile(
            leading: const AppIcon('eye_off'),
            title: const Text('Blocked accounts'),
            subtitle: Text(
              ref.watch(blockedAuthorsProvider).isEmpty
                  ? 'Accounts you have blocked'
                  : '${ref.watch(blockedAuthorsProvider).length} blocked',
            ),
            trailing: const AppIcon('chevron_r'),
            onTap: () => _showBlockedAuthorsSheet(context),
          ),
          const Divider(),

          // -------------------------------------------------------------------
          // Notifications
          // -------------------------------------------------------------------
          _sectionHeader('Notifications'),
          SwitchListTile(
            secondary: const AppIcon('bell'),
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
            leading: const AppIcon('eye'),
            title: const Text('App Version'),
            subtitle: Text(
              ref.watch(appVersionProvider).isEmpty
                  ? 'NostrFeed'
                  : 'NostrFeed v${ref.watch(appVersionProvider)}',
            ),
          ),
          ListTile(
            leading: const AppIcon('article'),
            title: const Text('Source Code'),
            subtitle: const Text('github.com/nostrfeed'),
            trailing: const AppIcon('link', size: 18),
            onTap: () => _openUrl('https://github.com/nostrfeed'),
          ),
          ListTile(
            leading: const AppIcon('article'),
            title: const Text('Terms & Privacy'),
            trailing: const AppIcon('chevron_r'),
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
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.md, AppSpacing.lg, AppSpacing.md, AppSpacing.xxs),
      child: Text(
        title.toUpperCase(),
        style: Theme.of(context).textTheme.labelSmall?.copyWith(
              fontWeight: FontWeight.w700,
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
          const AppIcon('globe', size: 28),
          Positioned(
            right: 0,
            bottom: 0,
            child: Container(
              width: 10,
              height: 10,
              decoration: BoxDecoration(
                color: connected > 0
                    ? AppStatusColors.success
                    : AppStatusColors.error,
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
    AppToast.success(context, '$label copied to clipboard');
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
            style: Theme.of(context)
                .textTheme
                .bodySmall
                ?.copyWith(color: scheme.onSurfaceVariant),
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
                style: Theme.of(context)
                    .textTheme
                    .bodyMedium
                    ?.copyWith(color: scheme.onSurfaceVariant),
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
                    icon: const AppIcon('plus', size: 18),
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

// ─── Appearance swatch tile ─────────────────────────────────────────────

class _AppearanceSwatch extends StatelessWidget {
  final AppAppearance mode;
  final bool selected;
  final VoidCallback onTap;

  const _AppearanceSwatch({
    required this.mode,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = switch (mode) {
      AppAppearance.dark || AppAppearance.oled => true,
      _ => false,
    };
    final isOled = mode == AppAppearance.oled;

    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        padding: const EdgeInsets.symmetric(vertical: 10),
        decoration: BoxDecoration(
          color: isOled
              ? const Color(0xFF000000) // token-guard: allow — OLED true-black swatch preview
              : isDark
                  ? scheme.surfaceContainerHighest
                  : scheme.surfaceContainerLowest,
          borderRadius: AppShapes.radiusSm,
          border: Border.all(
            color: selected ? scheme.primary : scheme.outlineVariant,
            width: selected ? 1.5 : 1,
          ),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            AppIcon(
              switch (mode) {
                AppAppearance.system => 'settings',
                AppAppearance.light => 'eye',
                AppAppearance.dark => 'eye_off',
                AppAppearance.oled => 'eye_off',
              },
              size: AppIconSize.sm,
              color: selected
                  ? scheme.primary
                  : scheme.onSurfaceVariant,
            ),
            const SizedBox(height: 4),
            Text(
              mode.label,
              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    color: selected
                        ? scheme.primary
                        : scheme.onSurfaceVariant,
                    fontWeight:
                        selected ? FontWeight.w600 : FontWeight.w400,
                  ),
            ),
            if (selected) ...[
              const SizedBox(height: 2),
              AppIcon('check',
                  size: AppIconSize.xs, color: scheme.primary),
            ],
          ],
        ),
      ),
    );
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
            style: Theme.of(context)
                .textTheme
                .bodySmall
                ?.copyWith(color: scheme.onSurfaceVariant),
          ),
          const SizedBox(height: 12),
          if (blocked.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 16),
              child: Text(
                'No blocked accounts. Block someone from a post’s menu.',
                textAlign: TextAlign.center,
                style: Theme.of(context)
                    .textTheme
                    .bodyMedium
                    ?.copyWith(color: scheme.onSurfaceVariant),
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
                      fallback: const AppIcon('users', size: 16),
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
