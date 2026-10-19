import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../providers/app_providers.dart';
import '../../services/auth_service.dart';
import 'smart_network_image.dart';

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

class _AppShellState extends ConsumerState<AppShell> with SingleTickerProviderStateMixin {
  /// Primary bottom-nav routes, matching the web's MobileNav:
  /// Feed, Reels, Search, Chat, Profile
  static const _mainRoutes = ['/feed', '/reels', '/search', '/chat', '/profile'];
  static const _mainIcons = [
    Icons.home_outlined,
    Icons.play_circle_outline_rounded,
    Icons.search_rounded,
    Icons.chat_bubble_outline_rounded,
    Icons.person_outline_rounded,
  ];
  static const _mainSelectedIcons = [
    Icons.home_rounded,
    Icons.play_circle_rounded,
    Icons.search_rounded,
    Icons.chat_bubble_rounded,
    Icons.person_rounded,
  ];
  static const _mainLabels = ['Home', 'Reels', 'Search', 'Chat', 'Profile'];

  late AnimationController _animationController;
  int _previousIndex = 0;

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

  int _currentIndex(String location) {
    if (location.startsWith('/profile/')) {
      final auth = ref.read(authStateProvider);
      if (auth.isLoggedIn && location.contains(auth.pubkey ?? '')) {
        return 4;
      }
    }
    for (var i = 0; i < _mainRoutes.length; i++) {
      if (location.startsWith(_mainRoutes[i])) return i;
    }
    return 0;
  }

  void _onDestinationSelected(int index) {
    if (index != _previousIndex) {
      HapticFeedback.mediumImpact();
      _animationController.forward(from: 0.8);
      _previousIndex = index;
    }

    if (index == 4) {
      final auth = ref.read(authStateProvider);
      if (auth.isLoggedIn && auth.pubkey != null) {
        context.go('/profile/${auth.pubkey}');
      } else {
        context.go('/login');
      }
    } else {
      context.go(_mainRoutes[index]);
    }
  }

  @override
  Widget build(BuildContext context) {
    final location = GoRouterState.of(context).uri.toString();
    final index = _currentIndex(location);
    final dmsAsync = ref.watch(dmsProvider);
    final colorScheme = Theme.of(context).colorScheme;

    final dmCount = dmsAsync.valueOrNull?.length ?? 0;

    return Scaffold(
      body: widget.child,
      extendBody: true,
      bottomNavigationBar: Container(
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
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: List.generate(
                _mainRoutes.length,
                (i) => _ModernNavItem(
                  icon: _mainIcons[i],
                  selectedIcon: _mainSelectedIcons[i],
                  label: _mainLabels[i],
                  isSelected: i == index,
                  badgeCount: i == 3 ? dmCount : 0,
                  onTap: () => _onDestinationSelected(i),
                ),
              ),
            ),
          ),
        ),
      ),
      drawer: const ModernDrawer(),
    );
  }
}

// ─── Modern Navigation Item ─────────────────────────────────────────

class _ModernNavItem extends StatefulWidget {
  final IconData icon;
  final IconData selectedIcon;
  final String label;
  final bool isSelected;
  final int badgeCount;
  final VoidCallback onTap;

  const _ModernNavItem({
    required this.icon,
    required this.selectedIcon,
    required this.label,
    required this.isSelected,
    required this.badgeCount,
    required this.onTap,
  });

  @override
  State<_ModernNavItem> createState() => _ModernNavItemState();
}

class _ModernNavItemState extends State<_ModernNavItem>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _scaleAnimation;
  late Animation<double> _slideAnimation;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 300),
    );

    _scaleAnimation = Tween<double>(begin: 1.0, end: 1.1).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeOutCubic),
    );

    _slideAnimation = Tween<double>(begin: 0.0, end: -4.0).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeOutCubic),
    );

    if (widget.isSelected) {
      _controller.forward();
    }
  }

  @override
  void didUpdateWidget(_ModernNavItem oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.isSelected != oldWidget.isSelected) {
      if (widget.isSelected) {
        _controller.forward();
      } else {
        _controller.reverse();
      }
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;

    return Expanded(
      child: GestureDetector(
        onTap: widget.onTap,
        behavior: HitTestBehavior.opaque,
        child: AnimatedBuilder(
          animation: _controller,
          builder: (context, child) {
            return Transform.translate(
              offset: Offset(0, _slideAnimation.value),
              child: Container(
                padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 4),
                decoration: BoxDecoration(
                  gradient: widget.isSelected
                      ? LinearGradient(
                          colors: [
                            colorScheme.primaryContainer.withValues(alpha: 0.8),
                            colorScheme.primaryContainer.withValues(alpha: 0.4),
                          ],
                          begin: Alignment.topCenter,
                          end: Alignment.bottomCenter,
                        )
                      : null,
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Transform.scale(
                      scale: _scaleAnimation.value,
                      child: _buildIconWithBadge(colorScheme),
                    ),
                    const SizedBox(height: 2),
                    AnimatedDefaultTextStyle(
                      duration: const Duration(milliseconds: 200),
                      style: TextStyle(
                        fontSize: 10,
                        fontWeight: widget.isSelected ? FontWeight.w700 : FontWeight.w500,
                        color: widget.isSelected
                            ? colorScheme.primary
                            : colorScheme.onSurfaceVariant,
                        letterSpacing: 0.2,
                      ),
                      child: Text(widget.label),
                    ),
                  ],
                ),
              ),
            );
          },
        ),
      ),
    );
  }

  Widget _buildIconWithBadge(ColorScheme colorScheme) {
    Widget iconWidget = Icon(
      widget.isSelected ? widget.selectedIcon : widget.icon,
      size: 26,
      color: widget.isSelected
          ? colorScheme.primary
          : colorScheme.onSurfaceVariant,
    );

    if (widget.badgeCount > 0) {
      return Badge(
        label: Text(
          widget.badgeCount > 99 ? '99+' : '${widget.badgeCount}',
          style: const TextStyle(
            fontSize: 9,
            fontWeight: FontWeight.bold,
            height: 1.2,
          ),
        ),
        backgroundColor: colorScheme.error,
        textColor: colorScheme.onError,
        padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
        child: iconWidget,
      );
    }

    return iconWidget;
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
            colors: [
              colorScheme.surface,
              colorScheme.surfaceContainerLowest,
            ],
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
          ),
        ),
        child: SafeArea(
          child: Column(
            children: [
              // Header with profile
              _DrawerHeader(auth: auth),

              // Navigation items
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
                    if (auth.isLoggedIn) ...[
                      _DrawerItem(
                        icon: Icons.edit_note_rounded,
                        title: 'Write Article',
                        subtitle: 'Create long-form content',
                        onTap: () => _navigate(context, '/compose'),
                      ),
                    ],
                    _DrawerDivider(),
                    _DrawerSection(title: 'Discover'),
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
                      icon: Icons.video_library_rounded,
                      title: 'Reels',
                      subtitle: 'Short videos',
                      onTap: () => _navigate(context, '/reels'),
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
                    _DrawerDivider(),
                    _DrawerSection(title: 'Sats & Economy'),
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
                      icon: Icons.workspace_premium_rounded,
                      title: 'Premium',
                      subtitle: 'Upgrade your account',
                      onTap: () => _navigate(context, '/premium'),
                    ),
                    _DrawerItem(
                      icon: Icons.water_drop_rounded,
                      title: 'Sats Drops',
                      subtitle: 'Earn rewards',
                      onTap: () => _navigate(context, '/sats-drops'),
                    ),
                    _DrawerItem(
                      icon: Icons.card_membership_rounded,
                      title: 'Memberships',
                      subtitle: 'Your subscriptions',
                      onTap: () => _navigate(context, '/memberships'),
                    ),
                    _DrawerDivider(),
                    _DrawerSection(title: 'Creator Tools'),
                    _DrawerItem(
                      icon: Icons.dashboard_rounded,
                      title: 'Studio',
                      subtitle: 'Creator dashboard',
                      onTap: () => _navigate(context, '/studio'),
                    ),
                    _DrawerItem(
                      icon: Icons.emoji_events_rounded,
                      title: 'Bounties',
                      subtitle: 'Complete tasks',
                      onTap: () => _navigate(context, '/bounties'),
                    ),
                    _DrawerDivider(),
                    _DrawerSection(title: 'Manage'),
                    _DrawerItem(
                      icon: Icons.bookmark_rounded,
                      title: 'Bookmarks',
                      subtitle: 'Saved posts',
                      onTap: () => _navigate(context, '/bookmarks'),
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
                      _DrawerDivider(),
                      _DrawerItem(
                        icon: Icons.logout_rounded,
                        title: 'Logout',
                        subtitle: 'Sign out',
                        isDestructive: true,
                        onTap: () {
                          ref.read(authStateProvider.notifier).logout();
                          Navigator.pop(context);
                          context.go('/feed');
                        },
                      ),
                    ],
                    const SizedBox(height: 16),
                  ],
                ),
              ),

              // Footer with version
              _DrawerFooter(),
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
}

// ─── Drawer Header ──────────────────────────────────────────────────

class _DrawerHeader extends ConsumerWidget {
  final AuthState auth;

  const _DrawerHeader({required this.auth});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colorScheme = Theme.of(context).colorScheme;
    // Fetch the latest profile from the relay — auth.profile may be stale
    // or null if the app restarted and the kind 0 event hasn't arrived yet
    final profileAsync = auth.isLoggedIn && auth.pubkey != null
        ? ref.watch(profileProvider(auth.pubkey!))
        : null;
    final profile = profileAsync?.valueOrNull ?? auth.profile;
    final bannerUrl = profile?.banner;

    return Container(
      width: double.infinity,
      // Banner as background image when the user has one, gradient fallback
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            colorScheme.primary,
            colorScheme.tertiary,
          ],
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
                  Container(
                    color: Colors.black.withValues(alpha: 0.4),
                  ),
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
                        : Icon(Icons.bolt_rounded, size: 40, color: colorScheme.primary),
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

                if (auth.isLoggedIn && profile?.nip05 != null) ...[
                  const SizedBox(height: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.25),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.verified_rounded, color: Colors.white, size: 14),
                        const SizedBox(width: 4),
                        Text(
                          profile!.nip05!,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 12,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ],
                    ),
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
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(16),
            ),
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

class _DrawerFooter extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;

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
            child: const Icon(Icons.bolt_rounded, color: Colors.white, size: 20),
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
                  'v1.0.0',
                  style: TextStyle(
                    fontSize: 11,
                    color: colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
