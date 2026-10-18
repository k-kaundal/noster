import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../screens/feed/feed_screen.dart';
import '../screens/feed/thread_screen.dart';
import '../models/nostr_models.dart';
import '../screens/profile/profile_screen.dart';
import '../screens/compose/compose_screen.dart';
import '../screens/search/search_screen.dart';
import '../screens/notifications/notifications_screen.dart';
import '../screens/chat/chat_screen.dart';
import '../screens/wallet/wallet_screen.dart';
import '../screens/settings/settings_screen.dart';
import '../screens/bookmarks/bookmarks_screen.dart';
import '../screens/communities/communities_screen.dart';
import '../screens/articles/articles_screen.dart';
import '../screens/market/market_screen.dart';
import '../screens/explore/explore_screen.dart';
import '../screens/trending/trending_screen.dart';
import '../screens/reels/reels_screen.dart';
import '../screens/lists/lists_screen.dart';
import '../screens/calendar/calendar_screen.dart';
import '../screens/groups/groups_screen.dart';
import '../screens/p2p/p2p_screen.dart';
import '../screens/live/live_screen.dart';
import '../screens/identity/identity_screen.dart';
import '../screens/studio/studio_screen.dart';
import '../screens/bounties/bounties_screen.dart';
import '../screens/memberships/memberships_screen.dart';
import '../screens/sats_drops/sats_drops_screen.dart';
import '../screens/premium/premium_screen.dart';
import '../screens/docs/docs_screen.dart';
import '../screens/auth/login_screen.dart';
import '../widgets/common/app_shell.dart';

final routerProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    initialLocation: '/feed',
    routes: [
      // Auth
      GoRoute(path: '/login', builder: (_, _) => const LoginScreen()),

      // Main app shell with bottom nav
      ShellRoute(
        builder: (context, state, child) => AppShell(child: child),
        routes: [
          // Main tabs
          GoRoute(path: '/feed', builder: (_, _) => const FeedScreen()),
          GoRoute(
            path: '/thread',
            builder: (_, state) => ThreadScreen(rootEvent: state.extra as NostrEvent),
          ),
          GoRoute(path: '/search', builder: (_, _) => const SearchScreen()),
          GoRoute(path: '/notifications', builder: (_, _) => const NotificationsScreen()),
          GoRoute(path: '/chat', builder: (_, _) => const ChatScreen()),
          GoRoute(path: '/chat/:npub', builder: (_, state) => ChatScreen(peerNpub: state.pathParameters['npub'])),

          // Profile
          GoRoute(path: '/profile/:pubkey', builder: (_, state) => ProfileScreen(pubkey: state.pathParameters['pubkey'])),

          // Compose
          GoRoute(path: '/compose', builder: (_, _) => const ComposeScreen()),

          // Discover
          GoRoute(path: '/explore', builder: (_, _) => const ExploreScreen()),
          GoRoute(path: '/trending', builder: (_, _) => const TrendingScreen()),
          GoRoute(path: '/reels', builder: (_, _) => const ReelsScreen()),
          GoRoute(path: '/articles', builder: (_, _) => const ArticlesScreen()),
          GoRoute(path: '/lists', builder: (_, _) => const ListsScreen()),
          GoRoute(path: '/calendar', builder: (_, _) => const CalendarScreen()),
          GoRoute(path: '/communities', builder: (_, _) => const CommunitiesScreen()),
          GoRoute(path: '/groups', builder: (_, _) => const GroupsScreen()),
          GoRoute(path: '/live', builder: (_, _) => const LiveScreen()),

          // Sats
          GoRoute(path: '/wallet', builder: (_, _) => const WalletScreen()),
          GoRoute(path: '/market', builder: (_, _) => const MarketScreen()),
          GoRoute(path: '/p2p', builder: (_, _) => const P2PScreen()),
          GoRoute(path: '/premium', builder: (_, _) => const PremiumScreen()),

          // Manage
          GoRoute(path: '/bookmarks', builder: (_, _) => const BookmarksScreen()),
          GoRoute(path: '/identity', builder: (_, _) => const IdentityScreen()),
          GoRoute(path: '/settings', builder: (_, _) => const SettingsScreen()),
          GoRoute(path: '/studio', builder: (_, _) => const StudioScreen()),
          GoRoute(path: '/bounties', builder: (_, _) => const BountiesScreen()),
          GoRoute(path: '/memberships', builder: (_, _) => const MembershipsScreen()),
          GoRoute(path: '/sats-drops', builder: (_, _) => const SatsDropsScreen()),
          GoRoute(path: '/docs', builder: (_, _) => const DocsScreen()),
        ],
      ),
    ],
  );
});
