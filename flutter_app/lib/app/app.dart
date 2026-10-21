import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nostrfeed_mobile/app/router.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/services/local_notification_service.dart';
import 'package:nostrfeed_mobile/core/theme/app_theme.dart';
import 'package:nostrfeed_mobile/features/chat/providers/dm_notifier.dart';
import 'package:nostrfeed_mobile/features/chat/providers/dm_store.dart';
import 'package:nostrfeed_mobile/features/notifications/providers/notification_center.dart';
import 'package:nostrfeed_mobile/features/notifications/widgets/social_alert_banner.dart';

/// Root application widget. Wires up the router and theme.
class NostrFeedApp extends ConsumerStatefulWidget {
  const NostrFeedApp({super.key});

  @override
  ConsumerState<NostrFeedApp> createState() => _NostrFeedAppState();
}

class _NostrFeedAppState extends ConsumerState<NostrFeedApp>
    with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  /// When the app returns to the foreground (Android kills idle sockets
  /// after ~20min–1hr), reconnect any dead relays — each reconnect then
  /// re-issues its live subscriptions, so the feed/DMs/notifications resume
  /// without an app restart.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      final nostr = ref.read(nostrServiceProvider);
      if (nostr.isInitialized) {
        nostr.relayPool.reconnectDead();
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final router = ref.watch(routerProvider);
    final themeMode = ref.watch(themeModeProvider);

    // Global DM notification listener: shows an in-app banner when a new
    // encrypted message arrives from someone else (see DmNotifier).
    ref.watch(dmNotifierProvider);
    // Real-time DM subscription: ingests incoming DMs from all relays into
    // the store (messages arrive live, not just on manual refresh).
    ref.watch(dmLiveListenerProvider);
    // Real-time social engagement: likes, comments, reposts, zaps, follows.
    ref.watch(socialLiveListenerProvider);

    // Notification taps deep-link into the app (set once the router exists).
    LocalNotificationService.instance.onNotificationTap = (route) {
      ref.read(routerProvider).go(route);
    };

    return MaterialApp.router(
      title: 'NostrFeed',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.lightTheme,
      darkTheme: AppTheme.darkTheme,
      themeMode: themeMode,
      routerConfig: router,
      // Overlay host for the in-app "new message" banner — sits above every
      // route so incoming DM alerts show no matter which screen is open.
      builder: (context, child) => Stack(
        children: [
          child ?? const SizedBox.shrink(),
          // In-app banners stack vertically at the top (DM first, then social).
          const Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              DmAlertBanner(),
              SocialAlertBanner(),
            ],
          ),
        ],
      ),
    );
  }
}
