import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/features/feed/feed_screen.dart';
import 'package:nostrfeed_mobile/features/feed/thread_screen.dart';
import 'package:nostrfeed_mobile/features/explore/hashtag_screen.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/features/profile/profile_screen.dart';
import 'package:nostrfeed_mobile/features/compose/compose_screen.dart';
import 'package:nostrfeed_mobile/features/search/search_screen.dart';
import 'package:nostrfeed_mobile/features/notifications/notifications_screen.dart';
import 'package:nostrfeed_mobile/features/chat/chat_screen.dart';
import 'package:nostrfeed_mobile/features/wallet/wallet_screen.dart';
import 'package:nostrfeed_mobile/features/wallet/nwc_screen.dart';
import 'package:nostrfeed_mobile/features/wallet/cashu_wallet_screen.dart';
import 'package:nostrfeed_mobile/features/wallet/lnbits_screen.dart';
import 'package:nostrfeed_mobile/features/wallet/buy_name_screen.dart';
import 'package:nostrfeed_mobile/features/settings/settings_screen.dart';
import 'package:nostrfeed_mobile/features/bookmarks/bookmarks_screen.dart';
import 'package:nostrfeed_mobile/features/communities/communities_screen.dart';
import 'package:nostrfeed_mobile/features/communities/community_detail_screen.dart';
import 'package:nostrfeed_mobile/features/articles/articles_screen.dart';
import 'package:nostrfeed_mobile/features/lists/list_detail_screen.dart';
import 'package:nostrfeed_mobile/features/lists/models/nostr_list.dart';
import 'package:nostrfeed_mobile/features/groups/group_chat_screen.dart';
import 'package:nostrfeed_mobile/features/live/live_room_screen.dart';
import 'package:nostrfeed_mobile/features/live/models/live_event.dart';
import 'package:nostrfeed_mobile/features/market/market_screen.dart';
import 'package:nostrfeed_mobile/features/explore/explore_screen.dart';
import 'package:nostrfeed_mobile/features/explore/trending_screen.dart';
import 'package:nostrfeed_mobile/features/reels/reels_screen.dart';
import 'package:nostrfeed_mobile/features/lists/lists_screen.dart';
import 'package:nostrfeed_mobile/features/calendar/calendar_screen.dart';
import 'package:nostrfeed_mobile/features/groups/groups_screen.dart';
import 'package:nostrfeed_mobile/features/p2p/p2p_screen.dart';
import 'package:nostrfeed_mobile/features/live/live_screen.dart';
import 'package:nostrfeed_mobile/features/identity/identity_screen.dart';
import 'package:nostrfeed_mobile/features/studio/studio_screen.dart';
import 'package:nostrfeed_mobile/features/bounties/bounties_screen.dart';
import 'package:nostrfeed_mobile/features/memberships/memberships_screen.dart';
import 'package:nostrfeed_mobile/features/sats_drops/sats_drops_screen.dart';
import 'package:nostrfeed_mobile/features/premium/premium_screen.dart';
import 'package:nostrfeed_mobile/features/docs/docs_screen.dart';
import 'package:nostrfeed_mobile/features/auth/login_screen.dart';
import 'package:nostrfeed_mobile/core/utils/nip19.dart';
import 'package:nostrfeed_mobile/core/widgets/app_shell.dart';

final routerProvider = Provider<GoRouter>((ref) {
  final authListenable = ValueNotifier(0);
  ref
    ..onDispose(authListenable.dispose)
    ..listen(authStateProvider, (_, _) => authListenable.value++);

  return GoRouter(
    initialLocation: '/feed',
    refreshListenable: authListenable,
    // Dismiss the keyboard on every navigation — a stale keyboard (e.g. from
    // the reel upload sheet) must never survive a route change and cover the
    // bottom nav on the destination screen.
    observers: [_KeyboardDismissObserver()],
    redirect: (context, state) {
      final auth = ref.read(authStateProvider);
      final onLoginPage = state.matchedLocation == '/login';

      // Not signed in → only the login page is reachable.
      if (!auth.isLoggedIn && !onLoginPage) return '/login';
      // Signed in → the login page bounces to the feed.
      if (auth.isLoggedIn && onLoginPage) return '/feed';
      return null;
    },
    routes: [
      // Auth — no shell, full-screen
      GoRoute(path: '/login', builder: (_, _) => const LoginScreen()),

      // Main app shell with bottom nav — ONLY the 4 primary tabs.
      // Detail screens push on top and hide the bottom nav.
      ShellRoute(
        builder: (context, state, child) => AppShell(child: child),
        routes: [
          // Primary bottom-nav tabs
          GoRoute(path: '/feed', builder: (_, _) => const FeedScreen()),
          GoRoute(path: '/chat', builder: (_, _) => const ChatScreen()),
          GoRoute(path: '/wallet', builder: (_, _) => const WalletScreen()),
        ],
      ),

      // ── Detail screens (no bottom nav) ────────────────────────────
      // These push on top of the shell. The bottom nav is hidden.

      // NIP-19 identifiers at root level
      GoRoute(
        path: '/:nip19(npub1[a-z0-9]+|note1[a-z0-9]+|nevent1[a-z0-9]+|naddr1[a-z0-9]+|nprofile1[a-z0-9]+)',
        builder: (context, state) {
          final id = state.pathParameters['nip19']!;
          final decoded = decodeNip19(id);
          return switch (decoded) {
            Nip19Pubkey(pubkey: final pk) => ProfileScreen(pubkey: pk),
            Nip19Profile(pubkey: final pk) => ProfileScreen(pubkey: pk),
            Nip19Note(eventId: final eid) => _EventLoader(eventId: eid),
            Nip19Event(eventId: final eid) => _EventLoader(eventId: eid),
            Nip19Address() => Nip19HandlerPage(identifier: id),
            _ => Nip19HandlerPage(identifier: id),
          };
        },
      ),

      // Thread / post detail
      GoRoute(
        path: '/thread',
        builder: (_, state) => ThreadScreen(rootEvent: state.extra as NostrEvent),
      ),

      // Profile (other users)
      GoRoute(
        path: '/profile/:pubkey',
        builder: (_, state) => ProfileScreen(pubkey: state.pathParameters['pubkey']),
      ),

      // Compose
      GoRoute(path: '/compose', builder: (_, _) => const ComposeScreen()),

      // Search (from drawer or chat)
      GoRoute(path: '/search', builder: (_, _) => const SearchScreen()),

      // Notifications (from drawer)
      GoRoute(path: '/notifications', builder: (_, _) => const NotificationsScreen()),

      // Chat thread (no bottom nav — immersive conversation)
      GoRoute(
        path: '/chat/:npub',
        builder: (_, state) => ChatScreen(peerNpub: state.pathParameters['npub']),
      ),

      // Discover
      GoRoute(path: '/explore', builder: (_, _) => const ExploreScreen()),
      GoRoute(path: '/trending', builder: (_, _) => const TrendingScreen()),
      GoRoute(path: '/hashtag/:tag', builder: (_, state) => HashtagScreen(tag: Uri.decodeComponent(state.pathParameters['tag']!))),
      GoRoute(path: '/articles', builder: (_, _) => const ArticlesScreen()),
      GoRoute(path: '/lists', builder: (_, _) => const ListsScreen()),
      GoRoute(path: '/calendar', builder: (_, _) => const CalendarScreen()),
      GoRoute(path: '/communities', builder: (_, _) => const CommunitiesScreen()),
      GoRoute(path: '/groups', builder: (_, _) => const GroupsScreen()),
      // Reels — full-screen immersive page (like Instagram), no bottom nav.
      GoRoute(path: '/reels', builder: (_, _) => const ReelsScreen()),
      GoRoute(path: '/live', builder: (_, _) => const LiveScreen()),
      GoRoute(
        path: '/live/room',
        builder: (_, state) => LiveRoomScreen(event: state.extra as LiveEvent),
      ),
      GoRoute(
        path: '/groups/chat',
        builder: (_, state) => GroupChatScreen(groupEvent: state.extra as NostrEvent),
      ),
      GoRoute(
        path: '/communities/detail',
        builder: (_, state) => CommunityDetailScreen(community: state.extra as NostrEvent),
      ),
      GoRoute(
        path: '/articles/reader',
        builder: (_, state) => ArticleReaderScreen(event: state.extra as NostrEvent),
      ),
      GoRoute(
        path: '/lists/detail',
        builder: (_, state) => ListDetailScreen(list: state.extra as NostrList),
      ),

      // Wallet detail screens
      GoRoute(path: '/wallet/nwc', builder: (_, _) => const NwcScreen()),
      GoRoute(path: '/wallet/cashu', builder: (_, _) => const CashuWalletScreen()),
      GoRoute(path: '/wallet/lnbits', builder: (_, _) => const LnbitsScreen()),
      GoRoute(path: '/wallet/buy-name', builder: (_, _) => const BuyNameScreen()),

      // Market & economy
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
  );
});

/// Dismisses the software keyboard whenever the route changes.
///
/// Without this, a keyboard opened in one screen (upload sheet, search,
/// compose) stays visible after navigating away — covering the bottom nav
/// and making the app look "stuck".
class _KeyboardDismissObserver extends NavigatorObserver {
  @override
  void didPush(Route route, Route? previousRoute) => _unfocus();
  @override
  void didPop(Route route, Route? previousRoute) => _unfocus();
  @override
  void didReplace({Route? newRoute, Route? oldRoute}) => _unfocus();

  void _unfocus() {
    // Post-frame so the new route's own autofocus (if any) wins.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      FocusManager.instance.primaryFocus?.unfocus();
    });
  }
}

/// Loads a Nostr event by ID and shows it in a thread view.
class _EventLoader extends ConsumerStatefulWidget {
  final String eventId;
  const _EventLoader({required this.eventId});

  @override
  ConsumerState<_EventLoader> createState() => _EventLoaderState();
}

class _EventLoaderState extends ConsumerState<_EventLoader> {
  NostrEvent? _event;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final nostr = ref.read(nostrServiceProvider);
      if (!nostr.isInitialized) await nostr.init();
      final events = await nostr.relayPool.query(
        [NostrFilter(ids: [widget.eventId], limit: 1)],
        timeout: const Duration(seconds: 8),
      );
      if (mounted) {
        setState(() {
          _event = events.isEmpty ? null : events.first;
          _loading = false;
          _error = events.isEmpty ? 'Event not found' : null;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = e.toString();
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return Scaffold(
        appBar: AppBar(title: const Text('Loading…')),
        body: const Center(child: CircularProgressIndicator()),
      );
    }
    if (_error != null || _event == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Event')),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.error_outline,
                    size: 48, color: Theme.of(context).colorScheme.error),
                const SizedBox(height: 16),
                Text(_error ?? 'Event not found'),
                const SizedBox(height: 16),
                FilledButton(onPressed: _load, child: const Text('Retry')),
              ],
            ),
          ),
        ),
      );
    }
    return ThreadScreen(rootEvent: _event!);
  }
}
