import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_info_providers.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/core/widgets/smart_network_image.dart';
import 'package:nostrfeed_mobile/features/ai/application/ai_providers.dart';
import 'package:nostrfeed_mobile/features/auth/data/auth_service.dart';
import 'package:nostrfeed_mobile/features/chat/application/dm_store.dart';
import 'package:nostrfeed_mobile/features/notifications/application/notification_center.dart';
import 'package:nostrfeed_mobile/features/settings/application/app_update_providers.dart';
import 'package:nostrfeed_mobile/features/settings/application/app_update_service.dart';
import 'package:url_launcher/url_launcher.dart';

/// Navigation Architecture:
///
/// PRIMARY NAVIGATION (Bottom Nav - 5 tabs):
/// 1. Feed - Home timeline with tabs (For You / Following)
/// 2. Search - Discover content and users
/// 3. Notifications - Activity and mentions
/// 4. Chat - Direct messages
/// 5. Profile - User's own profile
///
/// SECONDARY NAVIGATION (Drawer):
/// - Accessed via hamburger menu in Feed AppBar
/// - Contains all other features organized by category
///
/// TERTIARY NAVIGATION (Stack):
/// - Detail screens push on top (thread, profile, compose, etc.)
/// - Back button returns to previous screen
///
/// FAB PLACEMENT:
/// - Only on Feed screen for composing new posts
/// - Positioned bottom-right, above bottom nav
/// - Hidden on other tabs
class AppShell extends ConsumerStatefulWidget {
  final Widget child;
  const AppShell({super.key, required this.child});

  @override
  ConsumerState<AppShell> createState() => _AppShellState();
}

class _AppShellState extends ConsumerState<AppShell>
    with SingleTickerProviderStateMixin {
  /// Primary bottom-nav: Home · Reels · Create · Chat · Wallet.
  ///
  /// Instagram pattern: 5 slots with a center CREATE button (the main action
  /// a social app pushes). Reels is back as a tab (full-screen player, but
  /// the tab lives here for reachability). Chat carries the unread badge.
  static const _icons = [
    Icons.home_outlined,
    Icons.play_circle_outline_rounded,
    Icons.chat_bubble_outline_rounded,
    Icons.account_balance_wallet_outlined,
  ];
  static const _selectedIcons = [
    Icons.home_rounded,
    Icons.play_circle_rounded,
    Icons.chat_bubble_rounded,
    Icons.account_balance_wallet_rounded,
  ];
  static const _labels = ['Home', 'Reels', 'Chat', 'Wallet'];

  late AnimationController _animationController;

  @override
  void initState() {
    super.initState();
    _animationController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 300),
    );
  }

  @override
  void dispose() {
    _animationController.dispose();
    super.dispose();
  }

  /// AppBar title for the current location. Matches the tab routes; pushed
  /// detail screens get a generic empty title (the back button shows).
  String _titleFor(String location) {
    if (location.startsWith('/feed')) return 'NostrFeed';
    if (location.startsWith('/reels')) return 'Reels';
    if (location.startsWith('/chat')) return 'Messages';
    if (location.startsWith('/wallet')) return 'Wallet';
    return '';
  }

  /// Map a location to a bottom-nav slot: 0=Home, 1=Reels, 2=Create, 3=Chat,
  /// 4=Wallet. Create (2) is not a route — it opens the create sheet.
  int _slotFor(String location) {
    if (location.startsWith('/feed')) return 0;
    if (location.startsWith('/reels')) return 1;
    if (location.startsWith('/chat')) return 3;
    if (location.startsWith('/wallet')) return 4;
    return 0;
  }

  void _onDestinationSelected(int slot) {
    HapticFeedback.mediumImpact();
    _animationController.forward(from: 0.8);
    if (slot == 2) {
      // Center CREATE button → the create sheet (post/article/reel/live/group).
      _showCreateSheet(context);
      return;
    }
    final route = switch (slot) {
      0 => '/feed',
      1 => '/reels',
      3 => '/chat',
      4 => '/wallet',
      _ => '/feed',
    };
    context.go(route);
  }

  @override
  Widget build(BuildContext context) {
    final location = GoRouterState.of(context).uri.toString();
    final slot = _slotFor(location);
    final dmsAsync = ref.watch(dmsProvider);
    // Rebuild badge when decryption/outbox/read-state changes.
    ref.watch(dmStoreVersionProvider);
    final colorScheme = Theme.of(context).colorScheme;

    // Chat tab badge = TOTAL UNREAD messages (not raw event count).
    final dms = dmsAsync.valueOrNull ?? const <NostrEvent>[];
    final dmCount = ref.read(dmStoreProvider).totalUnread(dms);
    // Bell badge = unread social notifications (live engagement center).
    final notifUnread = ref.watch(unreadNotificationsProvider);

    // Immersive routes: hide shell AppBar + bottom nav (own headers).
    final isChatThread = location.startsWith('/chat/');
    final isReels = location.startsWith('/reels');
    final hideAppBar = isChatThread || isReels;
    final hideBottomNav = isChatThread || isReels;

    return Scaffold(
      appBar: hideAppBar
          ? null
          : AppBar(
              title: Text(_titleFor(location)),
              actions: [
                // AI Assistant — the flagship feature, always one tap away.
                // Hidden on builds without a provider key (nothing to sell).
                if (ref.watch(aiAvailableProvider))
                  IconButton(
                    icon: Icon(
                      Icons.auto_awesome_rounded,
                      color: colorScheme.primary,
                    ),
                    tooltip: 'AI Assistant',
                    onPressed: () {
                      HapticFeedback.lightImpact();
                      context.push('/ai');
                    },
                  ),
                // Global search
                IconButton(
                  icon: const Icon(Icons.search_rounded),
                  tooltip: 'Search',
                  onPressed: () {
                    HapticFeedback.lightImpact();
                    context.push('/search');
                  },
                ),
                // Notifications bell with badge = UNREAD social notifications
                // (likes, comments, reposts, zaps, follows) — not DM count.
                IconButton(
                  icon: Badge(
                    isLabelVisible: notifUnread > 0,
                    label: Text(
                      notifUnread > 99 ? '99+' : '$notifUnread',
                      style: const TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    backgroundColor: colorScheme.error,
                    textColor: colorScheme.onError,
                    child: const Icon(Icons.notifications_outlined),
                  ),
                  tooltip: 'Notifications',
                  onPressed: () {
                    HapticFeedback.lightImpact();
                    context.push('/notifications');
                  },
                ),
                // Overflow menu (profile, bookmarks, settings, theme, docs)
                const _ShellOverflowMenu(),
              ],
            ),
      body: widget.child,
      extendBody: true,
      bottomNavigationBar: hideBottomNav
          ? null
          : Container(
              margin: const EdgeInsets.fromLTRB(16, 0, 16, 16),
              decoration: BoxDecoration(
                color: colorScheme.surfaceContainer,
                borderRadius: BorderRadius.circular(28),
                border: Border.all(
                  color: colorScheme.outlineVariant.withValues(alpha: 0.2),
                  width: 1,
                ),
                boxShadow: [
                  BoxShadow(
                    color: colorScheme.shadow.withValues(alpha: 0.1),
                    blurRadius: 24,
                    offset: const Offset(0, 8),
                    spreadRadius: 0,
                  ),
                  BoxShadow(
                    color: colorScheme.shadow.withValues(alpha: 0.05),
                    blurRadius: 4,
                    offset: const Offset(0, 2),
                    spreadRadius: 0,
                  ),
                ],
              ),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(28),
                child: Container(
                  height: 72,
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 8,
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceAround,
                    children: [
                      _NavItem(
                        icon: _icons[0],
                        selectedIcon: _selectedIcons[0],
                        label: _labels[0],
                        isSelected: slot == 0,
                        onTap: () => _onDestinationSelected(0),
                      ),
                      _NavItem(
                        icon: _icons[1],
                        selectedIcon: _selectedIcons[1],
                        label: _labels[1],
                        isSelected: slot == 1,
                        onTap: () => _onDestinationSelected(1),
                      ),
                      // Center CREATE button (Instagram-style raised action).
                      _CreateNavButton(onTap: () => _onDestinationSelected(2)),
                      _NavItem(
                        icon: _icons[2],
                        selectedIcon: _selectedIcons[2],
                        label: _labels[2],
                        isSelected: slot == 3,
                        badgeCount: dmCount,
                        onTap: () => _onDestinationSelected(3),
                      ),
                      _NavItem(
                        icon: _icons[3],
                        selectedIcon: _selectedIcons[3],
                        label: _labels[3],
                        isSelected: slot == 4,
                        onTap: () => _onDestinationSelected(4),
                      ),
                    ],
                  ),
                ),
              ),
            ),
      drawer: const ModernDrawer(),
    );
  }

  /// The create sheet: quick actions for everything the user can publish.
  void _showCreateSheet(BuildContext context) {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 12),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: Theme.of(ctx).colorScheme.outlineVariant,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(height: 16),
              _CreateAction(
                icon: Icons.auto_awesome_rounded,
                label: 'Ask AI',
                subtitle: 'Draft, summarize, generate images & video',
                onTap: () => _go(ctx, '/ai'),
              ),
              _CreateAction(
                icon: Icons.edit_rounded,
                label: 'Post',
                subtitle: 'Share a note',
                onTap: () => _go(ctx, '/compose'),
              ),
              _CreateAction(
                icon: Icons.article_outlined,
                label: 'Article',
                subtitle: 'Long-form writing',
                onTap: () => _go(ctx, '/articles'),
              ),
              _CreateAction(
                icon: Icons.video_call_rounded,
                label: 'Reel',
                subtitle: 'Short video',
                onTap: () => _go(ctx, '/reels'),
              ),
              _CreateAction(
                icon: Icons.sensors_rounded,
                label: 'Go Live',
                subtitle: 'Start streaming',
                onTap: () => _go(ctx, '/live'),
              ),
              _CreateAction(
                icon: Icons.group_add_outlined,
                label: 'Group',
                subtitle: 'Create a group',
                onTap: () => _go(ctx, '/groups'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _go(BuildContext ctx, String route) {
    Navigator.pop(ctx);
    ctx.push(route);
  }
}

// ─── Shell Overflow Menu ────────────────────────────────────────────

/// The 3-dot "more options" menu in the shell AppBar: quick navigation
/// (Profile / Bookmarks / Settings / Docs) plus a theme switch.
class _ShellOverflowMenu extends ConsumerWidget {
  const _ShellOverflowMenu();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authStateProvider);
    final themeMode = ref.watch(themeModeProvider);

    return PopupMenuButton<String>(
      icon: const Icon(Icons.more_vert_rounded),
      tooltip: 'More options',
      onSelected: (value) => _onSelected(context, ref, value, auth),
      itemBuilder: (context) => [
        if (auth.isLoggedIn) ...[
          _navItem(Icons.person_outline_rounded, 'Profile', 'profile'),
          _navItem(Icons.bookmark_outline_rounded, 'Bookmarks', 'bookmarks'),
          const PopupMenuDivider(),
        ],
        _navItem(Icons.settings_outlined, 'Settings', 'settings'),
        _navItem(Icons.help_outline_rounded, 'Docs & Help', 'docs'),
        const PopupMenuDivider(),
        CheckedPopupMenuItem(
          value: 'theme_system',
          checked: themeMode == ThemeMode.system,
          child: const Text('System theme'),
        ),
        CheckedPopupMenuItem(
          value: 'theme_light',
          checked: themeMode == ThemeMode.light,
          child: const Text('Light theme'),
        ),
        CheckedPopupMenuItem(
          value: 'theme_dark',
          checked: themeMode == ThemeMode.dark,
          child: const Text('Dark theme'),
        ),
      ],
    );
  }

  PopupMenuItem<String> _navItem(IconData icon, String label, String value) {
    return PopupMenuItem<String>(
      value: value,
      child: Row(
        children: [
          Icon(icon, size: 20),
          const SizedBox(width: 12),
          Text(label),
        ],
      ),
    );
  }

  void _onSelected(
    BuildContext context,
    WidgetRef ref,
    String value,
    AuthState auth,
  ) {
    switch (value) {
      case 'profile':
        if (auth.pubkey != null) context.push('/profile/${auth.pubkey}');
      case 'bookmarks':
        context.push('/bookmarks');
      case 'settings':
        context.push('/settings');
      case 'docs':
        context.push('/docs');
      case 'theme_system':
        ref.read(themeModeProvider.notifier).state = ThemeMode.system;
        AppToast.info(context, 'Theme follows your system');
      case 'theme_light':
        ref.read(themeModeProvider.notifier).state = ThemeMode.light;
        AppToast.info(context, 'Light theme');
      case 'theme_dark':
        ref.read(themeModeProvider.notifier).state = ThemeMode.dark;
        AppToast.info(context, 'Dark theme');
    }
  }
}

// ─── Bottom-nav item (icon + label + optional badge) ────────────────

class _NavItem extends StatelessWidget {
  final IconData icon;
  final IconData selectedIcon;
  final String label;
  final bool isSelected;
  final int badgeCount;
  final VoidCallback onTap;

  const _NavItem({
    required this.icon,
    required this.selectedIcon,
    required this.label,
    required this.isSelected,
    this.badgeCount = 0,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final color = isSelected
        ? colorScheme.primary
        : colorScheme.onSurfaceVariant;

    return Expanded(
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Badge(
                isLabelVisible: badgeCount > 0,
                label: Text(
                  badgeCount > 99 ? '99+' : '$badgeCount',
                  style: const TextStyle(
                    fontSize: 9,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                backgroundColor: colorScheme.error,
                textColor: colorScheme.onError,
                child: Icon(
                  isSelected ? selectedIcon : icon,
                  size: 25,
                  color: color,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                label,
                style: TextStyle(
                  fontSize: 10,
                  fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                  color: color,
                  letterSpacing: 0.1,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ─── Center CREATE button (Instagram-style raised action) ───────────

class _CreateNavButton extends StatelessWidget {
  final VoidCallback onTap;
  const _CreateNavButton({required this.onTap});

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Expanded(
      child: GestureDetector(
        onTap: onTap,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 48,
              height: 48,
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [colorScheme.primary, colorScheme.tertiary],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(16),
                boxShadow: [
                  BoxShadow(
                    color: colorScheme.primary.withValues(alpha: 0.35),
                    blurRadius: 12,
                    offset: const Offset(0, 4),
                  ),
                ],
              ),
              child: const Icon(
                Icons.add_rounded,
                color: Colors.white,
                size: 28,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ─── Create-sheet action row ────────────────────────────────────────

class _CreateAction extends StatelessWidget {
  final IconData icon;
  final String label;
  final String subtitle;
  final VoidCallback onTap;

  const _CreateAction({
    required this.icon,
    required this.label,
    required this.subtitle,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return ListTile(
      leading: Container(
        width: 44,
        height: 44,
        decoration: BoxDecoration(
          color: colorScheme.primaryContainer.withValues(alpha: 0.6),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Icon(icon, color: colorScheme.primary, size: 22),
      ),
      title: Text(label, style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: Text(subtitle, style: const TextStyle(fontSize: 12)),
      trailing: Icon(
        Icons.arrow_forward_ios_rounded,
        size: 14,
        color: colorScheme.onSurfaceVariant,
      ),
      onTap: onTap,
    );
  }
}

// ─── Modern Drawer ──────────────────────────────────────────────────

class ModernDrawer extends ConsumerWidget {
  const ModernDrawer({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authStateProvider);
    final colorScheme = Theme.of(context).colorScheme;

    return Drawer(
      width: 320,
      child: Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            colors: [colorScheme.surface, colorScheme.surfaceContainerLowest],
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
          ),
        ),
        child: SafeArea(
          child: Column(
            children: [
              // Soft update banner — a new version exists, dismissible,
              // never blocks the user. Only renders when one is available.
              const _UpdateAvailableBanner(),

              // Header with profile
              _DrawerHeader(auth: auth),

              // Navigation items — organized by what users DO (research:
              // 26 flat items overwhelm; grouped by intent is scannable).
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  children: [
                    if (!auth.isLoggedIn)
                      _DrawerItem(
                        icon: Icons.login_rounded,
                        title: 'Login',
                        subtitle: 'Connect your account',
                        onTap: () => _navigate(context, '/login'),
                      ),

                    const _DrawerSection(title: 'Discover'),
                    _DrawerItem(
                      icon: Icons.explore_rounded,
                      title: 'Explore',
                      subtitle: 'Discover new content',
                      onTap: () => _navigate(context, '/explore'),
                    ),
                    _DrawerItem(
                      icon: Icons.trending_up_rounded,
                      title: 'Trending',
                      subtitle: 'Popular posts',
                      onTap: () => _navigate(context, '/trending'),
                    ),
                    _DrawerItem(
                      icon: Icons.article_rounded,
                      title: 'Articles',
                      subtitle: 'Long-form posts',
                      onTap: () => _navigate(context, '/articles'),
                    ),
                    _DrawerItem(
                      icon: Icons.list_rounded,
                      title: 'Lists',
                      subtitle: 'Curated feeds',
                      onTap: () => _navigate(context, '/lists'),
                    ),
                    _DrawerItem(
                      icon: Icons.calendar_month_rounded,
                      title: 'Calendar',
                      subtitle: 'Events & schedules',
                      onTap: () => _navigate(context, '/calendar'),
                    ),
                    _DrawerItem(
                      icon: Icons.smart_toy_rounded,
                      title: 'AI Assistant',
                      subtitle: 'Chat with AI — pay per message in sats',
                      onTap: () => _navigate(context, '/ai'),
                    ),

                    const _DrawerDivider(),
                    const _DrawerSection(title: 'People'),
                    _DrawerItem(
                      icon: Icons.groups_rounded,
                      title: 'Communities',
                      subtitle: 'Join communities',
                      onTap: () => _navigate(context, '/communities'),
                    ),
                    _DrawerItem(
                      icon: Icons.group_rounded,
                      title: 'Groups',
                      subtitle: 'Private groups',
                      onTap: () => _navigate(context, '/groups'),
                    ),
                    _DrawerItem(
                      icon: Icons.live_tv_rounded,
                      title: 'Live',
                      subtitle: 'Live streams',
                      onTap: () => _navigate(context, '/live'),
                    ),

                    const _DrawerDivider(),
                    const _DrawerSection(title: 'Money'),
                    _DrawerItem(
                      icon: Icons.account_balance_wallet_rounded,
                      title: 'Wallet',
                      subtitle: 'Manage your sats',
                      onTap: () => _navigate(context, '/wallet'),
                    ),
                    _DrawerItem(
                      icon: Icons.store_rounded,
                      title: 'Market',
                      subtitle: 'Buy & sell',
                      onTap: () => _navigate(context, '/market'),
                    ),
                    _DrawerItem(
                      icon: Icons.swap_horiz_rounded,
                      title: 'P2P',
                      subtitle: 'Peer-to-peer trading',
                      onTap: () => _navigate(context, '/p2p'),
                    ),
                    _DrawerItem(
                      icon: Icons.card_membership_rounded,
                      title: 'Memberships',
                      subtitle: 'Subscriptions & tiers',
                      onTap: () => _navigate(context, '/memberships'),
                    ),
                    _DrawerItem(
                      icon: Icons.workspace_premium_rounded,
                      title: 'Premium',
                      subtitle: 'Upgrade your account',
                      onTap: () => _navigate(context, '/premium'),
                    ),

                    const _DrawerDivider(),
                    const _DrawerSection(title: 'You'),
                    _DrawerItem(
                      icon: Icons.bookmark_rounded,
                      title: 'Bookmarks',
                      subtitle: 'Saved posts',
                      onTap: () => _navigate(context, '/bookmarks'),
                    ),
                    _DrawerItem(
                      icon: Icons.dashboard_rounded,
                      title: 'Studio',
                      subtitle: 'Creator dashboard',
                      onTap: () => _navigate(context, '/studio'),
                    ),
                    _DrawerItem(
                      icon: Icons.key_rounded,
                      title: 'Identity',
                      subtitle: 'Manage keys',
                      onTap: () => _navigate(context, '/identity'),
                    ),
                    _DrawerItem(
                      icon: Icons.settings_rounded,
                      title: 'Settings',
                      subtitle: 'App preferences',
                      onTap: () => _navigate(context, '/settings'),
                    ),
                    _DrawerItem(
                      icon: Icons.help_rounded,
                      title: 'Docs',
                      subtitle: 'Help & documentation',
                      onTap: () => _navigate(context, '/docs'),
                    ),
                    if (auth.isLoggedIn) ...[
                      const _DrawerDivider(),
                      _DrawerItem(
                        icon: Icons.logout_rounded,
                        title: 'Logout',
                        subtitle: 'Sign out',
                        isDestructive: true,
                        onTap: () => _confirmLogout(context, ref, auth),
                      ),
                    ],
                    const SizedBox(height: 16),
                  ],
                ),
              ),

              // Footer with version
              const _DrawerFooter(),
            ],
          ),
        ),
      ),
    );
  }

  void _navigate(BuildContext context, String route) {
    HapticFeedback.lightImpact();
    Navigator.pop(context);
    context.push(route);
  }

  /// Professional sign-out: confirm first, warn about key backup for
  /// full accounts (a nsec is unrecoverable once wiped), then toast.
  Future<void> _confirmLogout(
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
    Navigator.pop(context); // close drawer
    AppToast.info(context, 'Signed out');
    context.go('/feed');
  }
}

// ─── Drawer Header ──────────────────────────────────────────────────

class _DrawerHeader extends ConsumerWidget {
  final AuthState auth;

  const _DrawerHeader({required this.auth});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colorScheme = Theme.of(context).colorScheme;
    // Fetch the latest profile from the relay, but prefer auth.profile when
    // it's fresher (e.g. user just updated their profile and relays haven't
    // propagated the new kind-0 yet). The shared profileCache in NostrService
    // coordinates this.
    final profileAsync = auth.isLoggedIn && auth.pubkey != null
        ? ref.watch(profileProvider(auth.pubkey!))
        : null;
    final cachedProfile = auth.pubkey != null
        ? ref.read(nostrServiceProvider).profileCache[auth.pubkey!]?.profile
        : null;
    final profile = cachedProfile ?? profileAsync?.valueOrNull ?? auth.profile;
    final bannerUrl = profile?.banner;

    String npubShort = '';
    if (auth.pubkey != null) {
      final npub = ref
          .read(nostrServiceProvider)
          .authService
          .encodeNpub(auth.pubkey!);
      npubShort = npub.length > 20
          ? '${npub.substring(0, 12)}…${npub.substring(npub.length - 4)}'
          : npub;
    }

    return Container(
      width: double.infinity,
      // Banner as background image when the user has one, gradient fallback
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [colorScheme.primary, colorScheme.tertiary],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
      child: Stack(
        children: [
          // Banner image behind everything — only the image is darkened,
          // text and avatar stay bright on top
          if (bannerUrl != null && bannerUrl.isNotEmpty)
            Positioned.fill(
              child: Stack(
                fit: StackFit.expand,
                children: [
                  SmartNetworkImage(
                    url: bannerUrl,
                    fit: BoxFit.cover,
                    errorWidget: (_, _, _) => const SizedBox.shrink(),
                  ),
                  // Dark overlay ONLY on the image — not on the content above it
                  Container(color: Colors.black.withValues(alpha: 0.4)),
                ],
              ),
            ),

          // Header content on top
          Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Avatar
                Container(
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(color: Colors.white, width: 3),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withValues(alpha: 0.2),
                        blurRadius: 12,
                        offset: const Offset(0, 4),
                      ),
                    ],
                  ),
                  child: CircleAvatar(
                    radius: 36,
                    backgroundColor: Colors.white,
                    child: profile?.picture != null
                        ? ClipOval(
                            child: SmartNetworkImage(
                              url: profile!.picture!,
                              width: 72,
                              height: 72,
                              fit: BoxFit.cover,
                              errorWidget: (_, _, _) => Icon(
                                Icons.bolt_rounded,
                                size: 40,
                                color: colorScheme.primary,
                              ),
                            ),
                          )
                        : Icon(
                            Icons.bolt_rounded,
                            size: 40,
                            color: colorScheme.primary,
                          ),
                  ),
                ),
                const SizedBox(height: 16),

                // Name
                Text(
                  auth.isLoggedIn
                      ? (profile?.displayNameOrName ?? 'Nostr User')
                      : 'NostrFeed',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 22,
                    fontWeight: FontWeight.bold,
                    letterSpacing: -0.5,
                  ),
                ),
                const SizedBox(height: 4),

                // Subtitle
                Text(
                  auth.isLoggedIn
                      ? (auth.isReadOnly
                            ? 'Read-only mode'
                            : '@${profile?.name ?? "anon"}')
                      : 'Nostr Operating System',
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.95),
                    fontSize: 14,
                    fontWeight: FontWeight.w500,
                  ),
                ),

                if (auth.isLoggedIn) ...[
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      // NIP-05 verified badge
                      if (profile?.nip05 != null && profile!.nip05!.isNotEmpty)
                        _HeaderChip(
                          icon: Icons.verified_rounded,
                          label: profile.nip05!,
                        )
                      else if (npubShort.isNotEmpty)
                        // npub chip with copy
                        GestureDetector(
                          onTap: () async {
                            final npub = ref
                                .read(nostrServiceProvider)
                                .authService
                                .encodeNpub(auth.pubkey!);
                            await Clipboard.setData(ClipboardData(text: npub));
                            if (context.mounted) {
                              AppToast.success(context, 'Public key copied');
                            }
                          },
                          child: _HeaderChip(
                            icon: Icons.key_rounded,
                            label: npubShort,
                            trailing: Icons.copy_rounded,
                          ),
                        ),
                      const SizedBox(width: 8),
                      // Read-only badge
                      if (auth.isReadOnly)
                        const _HeaderChip(
                          icon: Icons.visibility_rounded,
                          label: 'Read-only',
                        ),
                      const Spacer(),
                      // Account switcher (trusted-client multi-account) —
                      // tap to switch between saved keys / add another.
                      GestureDetector(
                        onTap: () => _showAccountSwitcher(context, ref, auth),
                        child: Container(
                          padding: const EdgeInsets.all(6),
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: 0.25),
                            shape: BoxShape.circle,
                          ),
                          child: const Icon(
                            Icons.switch_account_rounded,
                            color: Colors.white,
                            size: 18,
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ─── Account switcher sheet ──────────────────────────────────────────

/// The multi-account switcher (trusted-client pattern): list saved accounts,
/// tap to switch, "Add account" to log in another key. Each row shows the
/// account's avatar + name + npub; the active one is marked.
void _showAccountSwitcher(BuildContext context, WidgetRef ref, AuthState auth) {
  showModalBottomSheet(
    context: context,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
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
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
                const SizedBox(height: 16),
                Text(
                  'Accounts',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                    color: scheme.onSurface,
                  ),
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
                        _AccountTile(
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
                    child: Icon(Icons.add_rounded, color: scheme.primary),
                  ),
                  title: const Text(
                    'Add account',
                    style: TextStyle(fontWeight: FontWeight.w600),
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

class _AccountTile extends StatelessWidget {
  final SavedAccount account;
  final bool isActive;
  final VoidCallback onTap;
  const _AccountTile({
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
      leading: CircleAvatar(
        backgroundColor: scheme.primaryContainer,
        backgroundImage: account.profile?.picture != null
            ? NetworkImage(account.profile!.picture!)
            : null,
        child: account.profile?.picture == null
            ? Icon(Icons.person_rounded, color: scheme.onPrimaryContainer)
            : null,
      ),
      title: Text(name, style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: Text(
        account.isReadOnly ? '$npub · read-only' : npub,
        style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
      ),
      trailing: isActive
          ? Icon(Icons.check_circle_rounded, color: scheme.primary)
          : null,
      onTap: onTap,
    );
  }
}

// ─── Soft update banner ──────────────────────────────────────────────

/// The "new version available" banner at the top of the drawer. Dismissible
/// ("Later" hides it for that version), taps through to the store listing.
/// Renders NOTHING when the app is current or offline — never a false
/// alarm, never blocking.
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
            Icon(Icons.system_update_alt_rounded,
                color: scheme.onPrimaryContainer, size: 22),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    'Update available — v${release.version}',
                    style: TextStyle(
                      fontWeight: FontWeight.w700,
                      fontSize: 13.5,
                      color: scheme.onPrimaryContainer,
                    ),
                  ),
                  if (release.notes != null && release.notes!.isNotEmpty)
                    Text(
                      release.notes!,
                      style: TextStyle(
                        fontSize: 11.5,
                        color: scheme.onPrimaryContainer
                            .withValues(alpha: 0.85),
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
              icon: const Icon(Icons.close_rounded, size: 18),
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

// ─── Drawer Header Chip ─────────────────────────────────────────────

class _HeaderChip extends StatelessWidget {
  final IconData icon;
  final String label;
  final IconData? trailing;

  const _HeaderChip({required this.icon, required this.label, this.trailing});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.25),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, color: Colors.white, size: 13),
          const SizedBox(width: 5),
          Text(
            label,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 11.5,
              fontWeight: FontWeight.w600,
            ),
          ),
          if (trailing != null) ...[
            const SizedBox(width: 5),
            Icon(trailing, color: Colors.white, size: 12),
          ],
        ],
      ),
    );
  }
}

// ─── Drawer Section ─────────────────────────────────────────────────

class _DrawerSection extends StatelessWidget {
  final String title;

  const _DrawerSection({required this.title});

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
      child: Text(
        title.toUpperCase(),
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w700,
          color: colorScheme.primary,
          letterSpacing: 1.5,
        ),
      ),
    );
  }
}

// ─── Drawer Item ────────────────────────────────────────────────────

class _DrawerItem extends StatelessWidget {
  final IconData icon;
  final String title;
  final String? subtitle;
  final VoidCallback onTap;
  final bool isDestructive;

  const _DrawerItem({
    required this.icon,
    required this.title,
    this.subtitle,
    required this.onTap,
    this.isDestructive = false,
  });

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final color = isDestructive ? Colors.red : colorScheme.onSurface;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: () {
            HapticFeedback.selectionClick();
            onTap();
          },
          borderRadius: BorderRadius.circular(16),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            decoration: BoxDecoration(borderRadius: BorderRadius.circular(16)),
            child: Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: isDestructive
                        ? Colors.red.withValues(alpha: 0.1)
                        : colorScheme.primaryContainer.withValues(alpha: 0.5),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(
                    icon,
                    size: 22,
                    color: isDestructive ? Colors.red : colorScheme.primary,
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w600,
                          color: color,
                          letterSpacing: -0.2,
                        ),
                      ),
                      if (subtitle != null) ...[
                        const SizedBox(height: 2),
                        Text(
                          subtitle!,
                          style: TextStyle(
                            fontSize: 12,
                            color: colorScheme.onSurfaceVariant,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                Icon(
                  Icons.arrow_forward_ios_rounded,
                  size: 14,
                  color: colorScheme.onSurfaceVariant.withValues(alpha: 0.5),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// ─── Drawer Divider ─────────────────────────────────────────────────

class _DrawerDivider extends StatelessWidget {
  const _DrawerDivider();

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
      child: Divider(
        color: colorScheme.outlineVariant.withValues(alpha: 0.3),
        height: 1,
      ),
    );
  }
}

// ─── Drawer Footer ──────────────────────────────────────────────────

class _DrawerFooter extends ConsumerWidget {
  const _DrawerFooter();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colorScheme = Theme.of(context).colorScheme;
    // The version comes from the platform bundle (pubspec `version:`), not
    // a string someone has to remember to bump.
    final version = ref.watch(appVersionProvider);

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        border: Border(
          top: BorderSide(
            color: colorScheme.outlineVariant.withValues(alpha: 0.3),
            width: 1,
          ),
        ),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [colorScheme.primary, colorScheme.tertiary],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Icon(
              Icons.bolt_rounded,
              color: Colors.white,
              size: 20,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'NostrFeed',
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: colorScheme.onSurface,
                  ),
                ),
                Text(
                  version.isEmpty ? '…' : 'v$version',
                  style: TextStyle(
                    fontSize: 11,
                    color: colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
          // Community links
          IconButton(
            icon: const Icon(Icons.discord_rounded, size: 20),
            tooltip: 'Discord community',
            color: const Color(0xFF5865F2),
            onPressed: () => launchUrl(
              Uri.parse('https://discord.gg/CDe6sRwDsd'),
              mode: LaunchMode.externalApplication,
            ),
          ),
          IconButton(
            icon: const Icon(Icons.telegram_rounded, size: 20),
            tooltip: 'Telegram channel',
            color: const Color(0xFF229ED9),
            onPressed: () => launchUrl(
              Uri.parse('https://t.me/nostrfeed'),
              mode: LaunchMode.externalApplication,
            ),
          ),
        ],
      ),
    );
  }
}
