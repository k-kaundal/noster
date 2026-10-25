import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/theme/app_motion.dart';
import 'package:nostrfeed_mobile/core/theme/app_shapes.dart';
import 'package:nostrfeed_mobile/core/widgets/app_badge.dart';
import 'package:nostrfeed_mobile/core/widgets/app_icon.dart';
import 'package:nostrfeed_mobile/core/widgets/brand_logo.dart';
import 'package:nostrfeed_mobile/core/widgets/command_palette.dart';
import 'package:nostrfeed_mobile/core/widgets/safe_image.dart';
import 'package:nostrfeed_mobile/features/chat/application/dm_store.dart';
import 'package:nostrfeed_mobile/features/notifications/application/notification_center.dart';

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
  /// Primary bottom-nav: Home · Explore · Create · Chat · Wallet.
  ///
  /// Instagram pattern: 5 slots with a center CREATE button (the main action
  /// a social app pushes). **Explore is tab 2** (Refined v2.1) — discovery
  /// gets prime position; Reels stays reachable via Explore's Live chip, the
  /// create sheet, and the command palette. Chat carries the unread badge.
  /// Icons are the Refined stroke SVG set (assets/icons).
  static const _icons = ['home', 'compass', 'chat', 'wallet'];
  static const _labels = ['Home', 'Explore', 'Chat', 'Wallet'];

  late AnimationController _animationController;

  @override
  void initState() {
    super.initState();
    _animationController = AnimationController(
      vsync: this,
      duration: AppMotion.normal,
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
    if (location.startsWith('/feed')) return 'nostrfeed';
    if (location.startsWith('/explore')) return 'Explore';
    if (location.startsWith('/reels')) return 'Reels';
    if (location.startsWith('/chat')) return 'Messages';
    if (location.startsWith('/wallet')) return 'Wallet';
    return '';
  }

  /// Map a location to a bottom-nav slot: 0=Home, 1=Explore, 2=Create, 3=Chat,
  /// 4=Wallet. Create (2) is not a route — it opens the create sheet.
  int _slotFor(String location) {
    if (location.startsWith('/feed')) return 0;
    if (location.startsWith('/explore')) return 1;
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
      1 => '/explore',
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
    final auth = ref.watch(authStateProvider);
    final colorScheme = Theme.of(context).colorScheme;

    // Chat tab badge = TOTAL UNREAD messages (not raw event count).
    final dms = dmsAsync.valueOrNull ?? const <NostrEvent>[];
    final dmCount = ref.read(dmStoreProvider.notifier).totalUnread(dms);
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
              // Clean top bar: logo+name … search, bell, avatar. NO hamburger
              // (drawer is gone) and NO 3-dot (replaced by the avatar → /you).
              titleSpacing: 16,
              title: _titleFor(location) == 'nostrfeed'
                  ? const BrandLogo()
                  : Text(
                      _titleFor(location),
                      style: Theme.of(context).textTheme.titleLarge?.copyWith(
                            fontWeight: FontWeight.w700,
                            letterSpacing: -0.3,
                          ),
                    ),
              actions: [
                // Global search
                IconButton(
                  icon: AppIcon(
                    'search',
                    size: AppIconSize.lg,
                    color: colorScheme.onSurfaceVariant,
                  ),
                  tooltip: 'Search',
                  onPressed: () {
                    HapticFeedback.lightImpact();
                    context.push('/search');
                  },
                ),
                // Notifications bell with badge = UNREAD social notifications
                // (likes, comments, reposts, zaps, follows) — not DM count.
                IconButton(
                  icon: AppBadge.count(
                    count: notifUnread,
                    child: AppIcon(
                      'bell',
                      size: AppIconSize.lg,
                      color: colorScheme.onSurfaceVariant,
                    ),
                  ),
                  tooltip: 'Notifications',
                  onPressed: () {
                    HapticFeedback.lightImpact();
                    context.push('/notifications');
                  },
                ),
                // Avatar → /you (the single account hub). Replaces the 3-dot.
                Padding(
                  padding: const EdgeInsets.only(left: 2, right: 12),
                  child: GestureDetector(
                    onTap: () {
                      HapticFeedback.lightImpact();
                      if (auth.isLoggedIn && auth.pubkey != null) {
                        context.push('/you');
                      } else {
                        context.push('/login');
                      }
                    },
                    child: SafeAvatar(
                      imageUrl: auth.profile?.picture,
                      radius: 17,
                      backgroundColor: colorScheme.primaryContainer,
                      fallback: Icon(
                        Icons.person_rounded,
                        size: 19,
                        color: colorScheme.onPrimaryContainer,
                      ),
                    ),
                  ),
                ),
              ],
            ),
      body: widget.child,
      extendBody: true,
      bottomNavigationBar: hideBottomNav
          ? null
          : Container(
              // Refined nav: a flat bar with a hairline top border — no
              // floating pill, no shadow. The active tab gets a small
              // top accent tick; icons are the stroke SVG set.
              decoration: BoxDecoration(
                color: colorScheme.surface,
                border: Border(
                  top: BorderSide(
                    color: colorScheme.outlineVariant,
                    width: 0.5,
                  ),
                ),
              ),
              child: SafeArea(
                top: false,
                child: SizedBox(
                  height: 56,
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceAround,
                    children: [
                      _NavItem(
                        icon: _icons[0],
                        label: _labels[0],
                        isSelected: slot == 0,
                        onTap: () => _onDestinationSelected(0),
                      ),
                      _NavItem(
                        icon: _icons[1],
                        label: _labels[1],
                        isSelected: slot == 1,
                        onTap: () => _onDestinationSelected(1),
                      ),
                      // Center CREATE button (outlined capsule action).
                      _CreateNavButton(
                        onTap: () => _onDestinationSelected(2),
                      ),
                      _NavItem(
                        icon: _icons[2],
                        label: _labels[2],
                        isSelected: slot == 3,
                        badgeCount: dmCount,
                        onTap: () => _onDestinationSelected(3),
                      ),
                      _NavItem(
                        icon: _icons[3],
                        label: _labels[3],
                        isSelected: slot == 4,
                        onTap: () => _onDestinationSelected(4),
                      ),
                    ],
                  ),
                ),
              ),
            ),
    );
  }

  /// The create sheet: the two 80% actions (Ask AI + Post) lead as full
  /// rows; the rest compress into a scannable 4-icon grid — six choices,
  /// zero reading walls (Refined create-sheet redesign).
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
                  borderRadius: AppShapes.radiusXs,
                ),
              ),
              const SizedBox(height: 12),
              _CreateAction(
                icon: 'sparkle',
                label: 'Ask AI',
                subtitle: 'Draft, summarize, generate images & video',
                highlight: true,
                onTap: () => _go(ctx, '/ai'),
              ),
              _CreateAction(
                icon: 'edit',
                label: 'Post',
                subtitle: 'Share a note',
                onTap: () => _go(ctx, '/compose'),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 10, 16, 4),
                child: Row(
                  children: [
                    _CreateGridButton(
                      icon: 'article',
                      label: 'Article',
                      onTap: () => _go(ctx, '/articles'),
                    ),
                    _CreateGridButton(
                      icon: 'video',
                      label: 'Reel',
                      onTap: () => _go(ctx, '/reels'),
                    ),
                    _CreateGridButton(
                      icon: 'live',
                      label: 'Go Live',
                      onTap: () => _go(ctx, '/live'),
                    ),
                    _CreateGridButton(
                      icon: 'group',
                      label: 'Group',
                      onTap: () => _go(ctx, '/groups'),
                    ),
                  ],
                ),
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

// ─── Create-sheet leading action row (Ask AI / Post) ───────────────

class _CreateAction extends StatelessWidget {
  final String icon;
  final String label;
  final String subtitle;
  final bool highlight;
  final VoidCallback onTap;

  const _CreateAction({
    required this.icon,
    required this.label,
    required this.subtitle,
    this.highlight = false,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return ListTile(
      leading: Container(
        width: 42,
        height: 42,
        decoration: BoxDecoration(
          color: highlight
              ? colorScheme.primary
              : colorScheme.primaryContainer.withValues(alpha: 0.5),
          borderRadius: AppShapes.radiusMd,
        ),
        child: Center(
          child: AppIcon(
            icon,
            size: AppIconSize.lg,
            color: highlight ? colorScheme.onPrimary : colorScheme.primary,
          ),
        ),
      ),
      title: Text(label, style: Theme.of(context).textTheme.titleSmall),
      subtitle: Text(subtitle, style: Theme.of(context).textTheme.bodySmall),
      trailing: AppIcon(
        'chevron_r',
        size: AppIconSize.xs,
        color: colorScheme.onSurfaceVariant,
      ),
      onTap: onTap,
    );
  }
}

// ─── Create-sheet grid button (Article / Reel / Live / Group) ──────

class _CreateGridButton extends StatelessWidget {
  final String icon;
  final String label;
  final VoidCallback onTap;

  const _CreateGridButton({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Expanded(
      child: InkWell(
        onTap: onTap,
        borderRadius: AppShapes.radiusMd,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 10),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 46,
                height: 46,
                decoration: BoxDecoration(
                  color: colorScheme.primaryContainer.withValues(alpha: 0.5),
                  borderRadius: AppShapes.radiusMd,
                ),
                child: Center(
                  child: AppIcon(
                    icon,
                    size: AppIconSize.lg,
                    color: colorScheme.primary,
                  ),
                ),
              ),
              const SizedBox(height: 6),
              Text(
                label,
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                      fontWeight: FontWeight.w600,
                    ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ─── Bottom-nav item (stroke icon + tiny label + top accent tick) ────

class _NavItem extends StatelessWidget {
  final String icon;
  final String label;
  final bool isSelected;
  final int badgeCount;
  final VoidCallback onTap;

  const _NavItem({
    required this.icon,
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
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Top accent tick — the Refined active indicator (no pill).
            AnimatedContainer(
              duration: AppMotion.fast,
              curve: AppMotion.curve,
              width: 18,
              height: 3,
              decoration: BoxDecoration(
                color: isSelected ? colorScheme.primary : Colors.transparent,
                borderRadius: AppShapes.radiusXs,
              ),
            ),
            const SizedBox(height: 4),
            AppBadge.count(
              count: badgeCount,
              child: AppIcon(
                icon,
                size: AppIconSize.lg,
                color: color,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              label,
              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    fontSize: 9,
                    fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                    color: color,
                    letterSpacing: 0.1,
                  ),
            ),
          ],
        ),
      ),
    );
  }
}

// ─── Center CREATE button (Refined outlined capsule) ────────────────

class _CreateNavButton extends StatelessWidget {
  final VoidCallback onTap;
  const _CreateNavButton({required this.onTap});

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Expanded(
      child: GestureDetector(
        onTap: onTap,
        // Long-press → the command palette (Refined ⌘K launcher).
        onLongPress: () => showCommandPalette(context),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 7),
            Container(
              width: 42,
              height: 30,
              decoration: BoxDecoration(
                border: Border.all(
                  color: colorScheme.onSurfaceVariant,
                  width: 1.5,
                ),
                borderRadius: AppShapes.radiusFull,
              ),
              child: Center(
                child: AppIcon(
                  'plus',
                  size: AppIconSize.sm,
                  color: colorScheme.onSurfaceVariant,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

