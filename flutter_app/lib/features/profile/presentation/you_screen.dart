import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/theme/app_shapes.dart';
import 'package:nostrfeed_mobile/core/theme/app_theme.dart';
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/core/widgets/detail_scaffold.dart';
import 'package:nostrfeed_mobile/core/widgets/profile_avatar.dart';
import 'package:nostrfeed_mobile/features/auth/data/auth_service.dart';
import 'package:nostrfeed_mobile/features/premium/application/premium_providers.dart';
import 'package:nostrfeed_mobile/features/settings/application/app_update_providers.dart';
import 'package:nostrfeed_mobile/features/settings/application/app_update_service.dart';
import 'package:nostrfeed_mobile/features/studio/application/studio_providers.dart';

/// The "You" surface (Refined drawer-replacement): a profile hub behind the
/// AppBar avatar. Profile summary + quick stats + grouped rows (Create &
/// earn / Library / Account). Feature discovery here is contextual — the
/// drawer shrinks to a launcher, this is the destination.
class YouScreen extends ConsumerWidget {
  const YouScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colorScheme = Theme.of(context).colorScheme;
    final auth = ref.watch(authStateProvider);
    final isPremium = ref.watch(isPremiumProvider).valueOrNull ?? false;
    final pubkey = auth.pubkey;
    final profile = pubkey != null
        ? ref.watch(profileProvider(pubkey)).valueOrNull ?? auth.profile
        : auth.profile;

    // Real data for the stat cards (was "—" placeholders).
    final followers = pubkey != null
        ? ref.watch(followersProvider(pubkey)).valueOrNull
        : null;
    final saved = ref.watch(bookmarkedIdsProvider).valueOrNull?.length;
    // Zapped = total sats from validated NIP-57 receipts naming the user
    // (30-day window — the studio earnings provider, never hardcoded).
    final zappedSats = pubkey != null
        ? ref.watch(studioEarningsProvider(30)).valueOrNull?.sats
        : null;

    return DetailScaffold(
      title: 'You',
      body: ListView(
        padding: EdgeInsets.zero,
        children: [
          // Soft-update banner (was in the drawer) — only renders when a
          // newer version exists, dismissible, never blocking.
          const _UpdateAvailableBanner(),

          // ── Profile header (tap → full profile) ──
          InkWell(
            onTap: pubkey != null ? () => context.push('/profile/$pubkey') : null,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 12),
              child: Row(
                children: [
                  ProfileAvatar(profile: profile, pubkey: pubkey, radius: 26),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Flexible(
                              child: Text(
                                profile?.displayNameOrName ?? 'Nostr User',
                                style: Theme.of(context)
                                    .textTheme
                                    .titleMedium
                                    ?.copyWith(fontWeight: FontWeight.w800),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            if (profile?.nip05 != null &&
                                profile!.nip05!.isNotEmpty) ...[
                              const SizedBox(width: 5),
                              AppIcon(
                                'verified',
                                size: AppIconSize.sm,
                                color: colorScheme.primary,
                              ),
                            ],
                          ],
                        ),
                        const SizedBox(height: 2),
                        Text(
                          profile?.nip05 ??
                              (pubkey != null
                                  ? '${pubkey.substring(0, 12)}…'
                                  : 'Not signed in'),
                          style:
                              Theme.of(context).textTheme.bodySmall?.copyWith(
                                    color: profile?.nip05 != null
                                        ? colorScheme.primary
                                        : colorScheme.onSurfaceVariant,
                                  ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),
                  AppIcon(
                    'chevron_r',
                    size: AppIconSize.sm,
                    color: colorScheme.onSurfaceVariant,
                  ),
                ],
              ),
            ),
          ),

          // ── Quick stats (real data: followers / zapped sats / saved) ──
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 4),
            child: Row(
              children: [
                _StatCard(
                  value: _fmtCount(followers),
                  label: 'Followers',
                  onTap: pubkey != null
                      ? () => context.push('/profile/$pubkey')
                      : null,
                ),
                const SizedBox(width: 8),
                _StatCard(
                  value: _fmtCount(zappedSats),
                  label: 'Zapped',
                  zap: true,
                  onTap: () => context.push('/studio'),
                ),
                const SizedBox(width: 8),
                _StatCard(
                  value: _fmtCount(saved),
                  label: 'Saved',
                  onTap: () => context.push('/bookmarks'),
                ),
              ],
            ),
          ),

          const _GroupLabel('Browse'),
          // The content surfaces that had NO entry point after the drawer
          // was killed (they're routes without a home — Articles/Reels/
          // Lists/Calendar/Communities/Groups/Live). Explore's chip row
          // covers discovery; /you is the full launcher.
          _YouRow(
            icon: 'article',
            title: 'Articles',
            subtitle: 'Long-form posts',
            onTap: () => context.push('/articles'),
          ),
          _YouRow(
            icon: 'video',
            title: 'Reels',
            subtitle: 'Short videos',
            onTap: () => context.push('/reels'),
          ),
          _YouRow(
            icon: 'group',
            title: 'Communities',
            subtitle: 'Topics & moderated groups',
            onTap: () => context.push('/communities'),
          ),
          _YouRow(
            icon: 'users',
            title: 'Groups',
            subtitle: 'NIP-29 chat groups',
            onTap: () => context.push('/groups'),
          ),
          _YouRow(
            icon: 'calendar',
            title: 'Calendar',
            subtitle: 'Events & RSVPs',
            onTap: () => context.push('/calendar'),
          ),
          _YouRow(
            icon: 'live',
            title: 'Live',
            subtitle: 'Streams happening now',
            onTap: () => context.push('/live'),
          ),
          _YouRow(
            icon: 'shopping',
            title: 'Market',
            subtitle: 'Buy & sell for sats',
            onTap: () => context.push('/market'),
          ),
          _YouRow(
            icon: 'link',
            title: 'P2P trades',
            subtitle: 'Peer-to-peer orders',
            onTap: () => context.push('/p2p'),
          ),

          const _GroupLabel('Create & earn'),
          _YouRow(
            icon: 'chart',
            title: 'Studio',
            subtitle: 'Earnings, zap goals & analytics',
            onTap: () => context.push('/studio'),
          ),
          _YouRow(
            icon: 'sparkle',
            title: 'Premium',
            subtitle: 'Verified name, paid relay & lightning address',
            trailing: isPremium
                ? const _StatusPill(label: 'Active')
                : null,
            onTap: () => context.push('/premium'),
          ),
          _YouRow(
            icon: 'users',
            title: 'Memberships',
            subtitle: 'Sell tiers to your subscribers',
            onTap: () => context.push('/memberships'),
          ),
          _YouRow(
            icon: 'gift',
            title: 'Bounties',
            subtitle: 'Earn sats for work',
            onTap: () => context.push('/bounties'),
          ),
          _YouRow(
            icon: 'zap',
            title: 'Sats Drops',
            subtitle: 'Claim sats rewards',
            onTap: () => context.push('/sats-drops'),
          ),

          const _GroupLabel('Library'),
          _YouRow(
            icon: 'bookmark',
            title: 'Bookmarks',
            subtitle: 'Posts you saved',
            onTap: () => context.push('/bookmarks'),
          ),
          _YouRow(
            icon: 'users',
            title: 'Lists',
            subtitle: 'Curated feeds',
            onTap: () => context.push('/lists'),
          ),

          const _GroupLabel('Account'),
          if (auth.isLoggedIn)
            _YouRow(
              icon: 'users',
              title: 'Switch account',
              subtitle: 'Between saved keys, or add another',
              onTap: () => _showAccountSwitcher(context, ref, auth),
            ),
          _YouRow(
            icon: 'key',
            title: 'Identity & keys',
            subtitle: 'Backup, accounts & security',
            onTap: () => context.push('/identity'),
          ),
          _YouRow(
            icon: 'eye',
            title: 'Appearance',
            subtitle: 'System · Light · Dark · OLED',
            onTap: () => _showThemeSheet(context, ref),
          ),
          _YouRow(
            icon: 'settings',
            title: 'Settings',
            subtitle: 'Filters, relays & sync',
            onTap: () => context.push('/settings'),
          ),
          _YouRow(
            icon: 'article',
            title: 'Docs & help',
            subtitle: 'Guides and how-tos',
            onTap: () => context.push('/docs'),
          ),
          if (auth.isLoggedIn)
            _YouRow(
              icon: 'back',
              title: 'Sign out',
              subtitle: 'Removes your key from this device',
              destructive: true,
              onTap: () => _confirmSignOut(context, ref, auth),
            ),

          const SizedBox(height: 20),
          Center(
            child: Text(
              'NostrFeed · your keys, your network',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: colorScheme.onSurfaceVariant,
                    fontSize: 10,
                  ),
            ),
          ),
          const SizedBox(height: 16),
        ],
      ),
    );
  }
}

/// Compact count formatter for the stat cards: 8,391 → "8,391" (≤9999),
/// 12,400 → "12.4k", 1,200,000 → "1.2M". Null (loading) → "—".
String _fmtCount(int? n) {
  if (n == null) return '—';
  if (n >= 1000000) {
    final m = n / 1000000;
    return '${m.toStringAsFixed(m >= 10 ? 0 : 1)}M';
  }
  if (n >= 10000) {
    final k = n / 1000;
    return '${k.toStringAsFixed(k >= 100 ? 0 : 1)}k';
  }
  final s = n.toString();
  // Thousands separators (8,391).
  return s.replaceAllMapped(
    RegExp(r'(\d)(?=(\d{3})+(?!\d))'),
    (m) => '${m[1]},',
  );
}

class _StatCard extends StatelessWidget {
  final String value;
  final String label;
  final bool zap;
  final VoidCallback? onTap;

  const _StatCard({
    required this.value,
    required this.label,
    this.zap = false,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Expanded(
      child: InkWell(
        onTap: onTap,
        borderRadius: AppShapes.radiusMd,
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 10),
          decoration: BoxDecoration(
            color: colorScheme.surfaceContainerLowest,
            border: Border.all(color: colorScheme.outlineVariant),
            borderRadius: AppShapes.radiusMd,
          ),
          child: Column(
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  if (zap) ...[
                    const AppIcon('zap', size: AppIconSize.sm, color: AppActionColors.zap),
                    const SizedBox(width: 3),
                  ],
                  Text(
                    value,
                    style: Theme.of(context).textTheme.titleSmall?.copyWith(
                          fontWeight: FontWeight.w800,
                        ),
                  ),
                ],
              ),
              const SizedBox(height: 2),
              Text(
                label,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      fontSize: 10,
                      color: colorScheme.onSurfaceVariant,
                    ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _GroupLabel extends StatelessWidget {
  final String title;
  const _GroupLabel(this.title);

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 6),
      child: Text(
        title.toUpperCase(),
        style: Theme.of(context).textTheme.labelSmall?.copyWith(
              fontWeight: FontWeight.w700,
              color: colorScheme.primary,
              letterSpacing: 1.2,
            ),
      ),
    );
  }
}

class _YouRow extends StatelessWidget {
  final String icon;
  final String title;
  final String subtitle;
  final Widget? trailing;
  final bool destructive;
  final VoidCallback onTap;

  const _YouRow({
    required this.icon,
    required this.title,
    required this.subtitle,
    this.trailing,
    this.destructive = false,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final fg = destructive ? colorScheme.error : colorScheme.primary;
    return ListTile(
      onTap: () {
        HapticFeedback.lightImpact();
        onTap();
      },
      leading: Container(
        width: 38,
        height: 38,
        decoration: BoxDecoration(
          color: destructive
              ? colorScheme.errorContainer.withValues(alpha: 0.5)
              : colorScheme.primaryContainer.withValues(alpha: 0.5),
          borderRadius: AppShapes.radiusMd,
        ),
        child: Center(
          child: AppIcon(icon, size: AppIconSize.md, color: fg),
        ),
      ),
      title: Text(
        title,
        style: Theme.of(context).textTheme.titleSmall?.copyWith(
              color: destructive ? colorScheme.error : null,
            ),
      ),
      subtitle: Text(
        subtitle,
        style: Theme.of(context).textTheme.bodySmall?.copyWith(fontSize: 11),
      ),
      trailing: trailing ??
          AppIcon(
            'chevron_r',
            size: AppIconSize.sm,
            color: colorScheme.onSurfaceVariant,
          ),
    );
  }
}

class _StatusPill extends StatelessWidget {
  final String label;
  const _StatusPill({required this.label});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: AppStatusColors.success.withValues(alpha: 0.12),
        borderRadius: AppShapes.radiusFull,
      ),
      child: Text(
        label.toUpperCase(),
        style: Theme.of(context).textTheme.labelSmall?.copyWith(
              fontSize: 8.5,
              fontWeight: FontWeight.w800,
              color: AppStatusColors.success,
              letterSpacing: 0.5,
            ),
      ),
    );
  }
}

// ─── Sign out + account switching (moved here from the drawer) ────────

/// Professional sign-out: confirm first, warn about key backup for full
/// accounts (a nsec is unrecoverable once wiped), then toast. Lives in /you —
/// the account hub — not the drawer.
Future<void> _confirmSignOut(
  BuildContext context,
  WidgetRef ref,
  AuthState auth,
) async {
  final isReadOnly = auth.isReadOnly;
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (ctx) {
      final scheme = Theme.of(ctx).colorScheme;
      return AlertDialog(
        icon: Icon(Icons.logout_rounded, color: scheme.error, size: 32),
        title: const Text('Sign out?'),
        content: Text(
          isReadOnly
              ? 'You are browsing read-only. Signing out removes the public key from this device.'
              : 'Your secret key will be removed from this device.\n\n'
                    'If you have not backed up your nsec, you will permanently lose access to this account.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: FilledButton.styleFrom(backgroundColor: scheme.error),
            child: const Text('Sign out'),
          ),
        ],
      );
    },
  );

  if (confirmed != true || !context.mounted) return;

  await ref.read(authStateProvider.notifier).logout();
  if (!context.mounted) return;
  AppToast.info(context, 'Signed out');
  context.go('/feed');
}

/// The multi-account switcher (trusted-client pattern): list saved accounts,
/// tap to switch, "Add account" to log in another key.
void _showAccountSwitcher(BuildContext context, WidgetRef ref, AuthState auth) {
  showModalBottomSheet(
    context: context,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(AppShapes.xl)),
    ),
    builder: (ctx) => SafeArea(
      child: Consumer(
        builder: (ctx, ref, _) {
          final accountsAsync = ref.watch(savedAccountsProvider);
          final scheme = Theme.of(ctx).colorScheme;
          return Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: scheme.outlineVariant,
                    borderRadius: AppShapes.radiusXs,
                  ),
                ),
                const SizedBox(height: 16),
                Text(
                  'Accounts',
                  style: Theme.of(ctx).textTheme.titleLarge,
                ),
                const SizedBox(height: 8),
                accountsAsync.when(
                  loading: () => const Padding(
                    padding: EdgeInsets.all(24),
                    child: CircularProgressIndicator(),
                  ),
                  error: (_, _) => const Padding(
                    padding: EdgeInsets.all(24),
                    child: Text('Could not load accounts'),
                  ),
                  data: (accounts) => Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      for (final account in accounts)
                        _SwitcherTile(
                          account: account,
                          isActive: account.pubkey == auth.pubkey,
                          onTap: () async {
                            if (account.pubkey == auth.pubkey) {
                              Navigator.pop(ctx);
                              return;
                            }
                            Navigator.pop(ctx);
                            await ref
                                .read(authStateProvider.notifier)
                                .switchAccount(account.pubkey);
                          },
                        ),
                    ],
                  ),
                ),
                const Divider(height: 24),
                ListTile(
                  leading: Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: scheme.primaryContainer,
                      shape: BoxShape.circle,
                    ),
                    child: AppIcon('plus', size: AppIconSize.md, color: scheme.primary),
                  ),
                  title: Text(
                    'Add account',
                    style: Theme.of(ctx).textTheme.titleSmall,
                  ),
                  subtitle: const Text('Log in with another key'),
                  onTap: () {
                    Navigator.pop(ctx);
                    ctx.push('/login');
                  },
                ),
              ],
            ),
          );
        },
      ),
    ),
  );
}

class _SwitcherTile extends StatelessWidget {
  final SavedAccount account;
  final bool isActive;
  final VoidCallback onTap;
  const _SwitcherTile({
    required this.account,
    required this.isActive,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final name = account.profile?.displayNameOrName ?? 'Nostr user';
    final npub = account.pubkey.length > 16
        ? '${account.pubkey.substring(0, 8)}…${account.pubkey.substring(account.pubkey.length - 4)}'
        : account.pubkey;
    return ListTile(
      leading: ProfileAvatar(profile: account.profile, pubkey: account.pubkey, radius: 20),
      title: Text(name, style: Theme.of(context).textTheme.titleSmall),
      subtitle: Text(
        account.isReadOnly ? '$npub · read-only' : npub,
        style: Theme.of(context)
            .textTheme
            .bodySmall
            ?.copyWith(color: scheme.onSurfaceVariant),
      ),
      trailing: isActive
          ? AppIcon('check', size: AppIconSize.md, color: scheme.primary)
          : null,
      onTap: onTap,
    );
  }
}

// ─── Soft-update banner (moved here from the drawer) ──────────────────

/// The "new version available" banner at the top of /you. Dismissible
/// ("Later" hides it for that version), taps through to the store listing.
/// Renders NOTHING when the app is current or offline — never a false alarm.
class _UpdateAvailableBanner extends ConsumerWidget {
  const _UpdateAvailableBanner();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final releaseAsync = ref.watch(appUpdateProvider);
    final release = releaseAsync.valueOrNull;
    if (release == null) return const SizedBox.shrink();

    final scheme = Theme.of(context).colorScheme;
    return Material(
      color: scheme.primaryContainer,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        child: Row(
          children: [
            AppIcon('arrow_down', color: scheme.onPrimaryContainer, size: AppIconSize.lg),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    'Update available — v${release.version}',
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      fontWeight: FontWeight.w700,
                      color: scheme.onPrimaryContainer,
                    ),
                  ),
                  if (release.notes != null && release.notes!.isNotEmpty)
                    Text(
                      release.notes!,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: scheme.onPrimaryContainer.withValues(alpha: 0.85),
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                ],
              ),
            ),
            TextButton(
              onPressed: () => AppUpdateService.openStore(release),
              child: const Text('Update'),
            ),
            IconButton(
              icon: const AppIcon('plus', size: AppIconSize.md),
              tooltip: 'Later',
              visualDensity: VisualDensity.compact,
              color: scheme.onPrimaryContainer,
              onPressed: () async {
                await AppUpdateService.dismiss(release.version);
                ref.invalidate(appUpdateProvider);
              },
            ),
          ],
        ),
      ),
    );
  }
}

// ─── Appearance (theme) sheet — was the 3-dot menu's only job ─────────

/// The theme switcher, now a row in /you → a small sheet with the 4 options.
/// (The 3-dot in the app bar was replaced by the avatar; theme lives here.)
void _showThemeSheet(BuildContext context, WidgetRef ref) {
  showModalBottomSheet(
    context: context,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(AppShapes.xl)),
    ),
    builder: (ctx) => SafeArea(
      child: Consumer(
        builder: (ctx, ref, _) {
          final appearance = ref.watch(appAppearanceProvider);
          void pick(AppAppearance a, String label) {
            ref.read(appAppearanceProvider.notifier).setAppearance(a);
            Navigator.pop(ctx);
            AppToast.info(ctx, label);
          }

          Widget option(AppAppearance a, IconData icon, String label) {
            final selected = appearance == a;
            return ListTile(
              leading: AppIcon(
                'eye',
                size: AppIconSize.lg,
                color: selected
                    ? Theme.of(ctx).colorScheme.primary
                    : Theme.of(ctx).colorScheme.onSurfaceVariant,
              ),
              title: Text(label),
              trailing: selected
                  ? AppIcon('check',
                      size: AppIconSize.md,
                      color: Theme.of(ctx).colorScheme.primary)
                  : null,
              onTap: () => pick(a, label),
            );
          }

          return Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const SizedBox(height: 10),
              Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: Theme.of(ctx).colorScheme.outlineVariant,
                  borderRadius: AppShapes.radiusXs,
                ),
              ),
              const SizedBox(height: 12),
              Text('Appearance', style: Theme.of(ctx).textTheme.titleLarge),
              const SizedBox(height: 4),
              option(AppAppearance.system, Icons.settings_suggest, 'System theme'),
              option(AppAppearance.light, Icons.light_mode, 'Light theme'),
              option(AppAppearance.dark, Icons.dark_mode, 'Dark theme'),
              option(AppAppearance.oled, Icons.nightlight, 'OLED black theme'),
              const SizedBox(height: 8),
            ],
          );
        },
      ),
    ),
  );
}
