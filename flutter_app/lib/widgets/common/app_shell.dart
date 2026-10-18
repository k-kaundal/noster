import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../providers/app_providers.dart';
import '../../services/auth_service.dart';

class AppShell extends ConsumerStatefulWidget {
  final Widget child;
  const AppShell({super.key, required this.child});

  @override
  ConsumerState<AppShell> createState() => _AppShellState();
}

class _AppShellState extends ConsumerState<AppShell> {
  static const _mainRoutes = ['/feed', '/search', '/notifications', '/chat', '/wallet'];
  static const _mainIcons = [Icons.home_outlined, Icons.search, Icons.notifications_outlined, Icons.chat_bubble_outline, Icons.account_balance_wallet_outlined];
  static const _mainSelectedIcons = [Icons.home, Icons.search, Icons.notifications, Icons.chat_bubble, Icons.account_balance_wallet];
  static const _mainLabels = ['Feed', 'Search', 'Alerts', 'Chat', 'Wallet'];

  int _currentIndex(String location) {
    for (var i = 0; i < _mainRoutes.length; i++) {
      if (location.startsWith(_mainRoutes[i])) return i;
    }
    return 0;
  }

  @override
  Widget build(BuildContext context) {
    final location = GoRouterState.of(context).uri.toString();
    final index = _currentIndex(location);
    final auth = ref.watch(authStateProvider);

    return Scaffold(
      body: widget.child,
      bottomNavigationBar: NavigationBar(
        selectedIndex: index,
        onDestinationSelected: (i) => context.go(_mainRoutes[i]),
        destinations: List.generate(
          _mainRoutes.length,
          (i) => NavigationDestination(
            icon: Icon(_mainIcons[i]),
            selectedIcon: Icon(_mainSelectedIcons[i]),
            label: _mainLabels[i],
          ),
        ),
      ),
      drawer: _buildDrawer(context, auth),
      floatingActionButton: index == 0 && auth.isLoggedIn && !auth.isReadOnly
          ? FloatingActionButton(
              onPressed: () => context.push('/compose'),
              child: const Icon(Icons.edit),
            )
          : null,
    );
  }

  Widget _buildDrawer(BuildContext context, AuthState auth) {
    final colorScheme = Theme.of(context).colorScheme;
    return Drawer(
      child: ListView(
        padding: EdgeInsets.zero,
        children: [
          DrawerHeader(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [colorScheme.primary, colorScheme.tertiary],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                CircleAvatar(
                  radius: 30,
                  backgroundColor: Colors.white,
                  backgroundImage: auth.profile?.picture != null
                      ? NetworkImage(auth.profile!.picture!)
                      : null,
                  child: auth.profile?.picture == null
                      ? Icon(Icons.person, size: 36, color: colorScheme.primary)
                      : null,
                ),
                const SizedBox(height: 10),
                Text(
                  auth.isLoggedIn
                      ? (auth.profile?.displayNameOrName ?? 'Nostr User')
                      : 'NostrFeed',
                  style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold),
                ),
                Text(
                  auth.isLoggedIn
                      ? (auth.isReadOnly ? 'Read-only mode' : '@${auth.profile?.name ?? "anon"}')
                      : 'Nostr Operating System',
                  style: const TextStyle(color: Colors.white70, fontSize: 13),
                ),
              ],
            ),
          ),
          if (!auth.isLoggedIn)
            ListTile(
              leading: const Icon(Icons.login),
              title: const Text('Login'),
              onTap: () { Navigator.pop(context); context.push('/login'); },
            ),
          if (auth.isLoggedIn) ...[
            ListTile(
              leading: const Icon(Icons.person),
              title: const Text('Profile'),
              onTap: () {
                Navigator.pop(context);
                if (auth.pubkey != null) context.push('/profile/${auth.pubkey}');
              },
            ),
            ListTile(
              leading: const Icon(Icons.edit_note),
              title: const Text('Write Article'),
              onTap: () { Navigator.pop(context); context.push('/articles'); },
            ),
          ],
          const Divider(),
          _drawerSection('Discover'),
          _drawerItem(context, Icons.explore, 'Explore', '/explore'),
          _drawerItem(context, Icons.trending_up, 'Trending', '/trending'),
          _drawerItem(context, Icons.video_library, 'Reels', '/reels'),
          _drawerItem(context, Icons.article, 'Articles', '/articles'),
          _drawerItem(context, Icons.list, 'Lists', '/lists'),
          _drawerItem(context, Icons.calendar_month, 'Calendar', '/calendar'),
          _drawerItem(context, Icons.groups, 'Communities', '/communities'),
          _drawerItem(context, Icons.group, 'Groups', '/groups'),
          _drawerItem(context, Icons.live_tv, 'Live', '/live'),
          const Divider(),
          _drawerSection('Sats'),
          _drawerItem(context, Icons.account_balance_wallet, 'Wallet', '/wallet'),
          _drawerItem(context, Icons.store, 'Market', '/market'),
          _drawerItem(context, Icons.swap_horiz, 'P2P', '/p2p'),
          _drawerItem(context, Icons.workspace_premium, 'Premium', '/premium'),
          _drawerItem(context, Icons.water_drop, 'Sats Drops', '/sats-drops'),
          _drawerItem(context, Icons.card_membership, 'Memberships', '/memberships'),
          const Divider(),
          _drawerSection('Creator'),
          _drawerItem(context, Icons.dashboard, 'Studio', '/studio'),
          _drawerItem(context, Icons.emoji_events, 'Bounties', '/bounties'),
          const Divider(),
          _drawerSection('Manage'),
          _drawerItem(context, Icons.bookmark, 'Bookmarks', '/bookmarks'),
          _drawerItem(context, Icons.key, 'Identity', '/identity'),
          _drawerItem(context, Icons.settings, 'Settings', '/settings'),
          _drawerItem(context, Icons.help, 'Docs', '/docs'),
          if (auth.isLoggedIn) ...[
            const Divider(),
            ListTile(
              leading: const Icon(Icons.logout, color: Colors.red),
              title: const Text('Logout', style: TextStyle(color: Colors.red)),
              onTap: () {
                ref.read(authStateProvider.notifier).logout();
                Navigator.pop(context);
                context.go('/feed');
              },
            ),
          ],
        ],
      ),
    );
  }

  Widget _drawerSection(String title) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      child: Text(
        title.toUpperCase(),
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w600,
          color: Theme.of(context).colorScheme.primary,
          letterSpacing: 1.2,
        ),
      ),
    );
  }

  Widget _drawerItem(BuildContext context, IconData icon, String title, String route) {
    return ListTile(
      leading: Icon(icon),
      title: Text(title),
      dense: true,
      onTap: () { Navigator.pop(context); context.push(route); },
    );
  }
}
