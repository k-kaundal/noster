import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nostrfeed_mobile/app/router.dart';
import 'package:nostrfeed_mobile/core/moderation/moderation_providers.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/providers/connectivity_providers.dart';
import 'package:nostrfeed_mobile/core/services/local_notification_service.dart';
import 'package:nostrfeed_mobile/core/theme/app_theme.dart';
import 'package:nostrfeed_mobile/features/chat/application/dm_gap_fill.dart';
import 'package:nostrfeed_mobile/features/chat/application/dm_notifier.dart';
import 'package:nostrfeed_mobile/features/chat/application/dm_store.dart';
import 'package:nostrfeed_mobile/features/notifications/application/notification_center.dart';
import 'package:nostrfeed_mobile/features/notifications/presentation/widgets/social_alert_banner.dart';
import 'package:nostrfeed_mobile/features/wallet/application/lnbits_live_providers.dart';
import 'package:nostrfeed_mobile/features/wallet/application/wallet_sync_service.dart';
import 'package:nostrfeed_mobile/features/wallet/presentation/widgets/wallet_payment_banner.dart';

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
      // Money can move while the app is backgrounded (zaps received, credits
      // bought on another device) — resync every wallet on return.
      ref.read(walletSyncServiceProvider).syncNow();
      // The LNbits live socket dies with the OS idle timeout — reopen it
      // (the 30s poll covered the gap; this restores the realtime channel).
      ref.read(lnbitsLiveServiceProvider).resync();
      // DMs sent while we were dead can't be delivered retroactively by the
      // live sub — gap-fill fetches exactly what arrived in the gap.
      ref.read(dmGapFillProvider).fillGap();
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
    // NIP-51 mute list: fetch and merge the user's blocked words/authors
    // once per session, so their blocks follow them across clients.
    ref.watch(muteListSyncProvider);
    // Connectivity watcher: reconnect dead relays the moment the network
    // comes back (offline → online), so feeds/notifications resume at once.
    ref.watch(connectivityWatcherProvider);
    // Wallet sync: periodic 30s balance/AI-credit refresh — money surfaces
    // stay live without an app restart.
    ref.watch(walletSyncServiceProvider);
    // LNbits realtime: websocket payment events refresh the balance,
    // notify on incoming sats, and land AI-credit top-ups instantly.
    ref.watch(lnbitsLiveServiceProvider);

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
          // In-app banners stack vertically at the top (DM first, then
          // social, then incoming-payment).
          const Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              DmAlertBanner(),
              SocialAlertBanner(),
              WalletPaymentBanner(),
            ],
          ),
        ],
      ),
    );
  }
}
