import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nostrfeed_mobile/app/router.dart';
import 'package:nostrfeed_mobile/core/moderation/moderation_providers.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/providers/connectivity_providers.dart';
import 'package:nostrfeed_mobile/core/providers/ingest_pipeline_providers.dart';
import 'package:nostrfeed_mobile/core/services/background_sync.dart';
import 'package:nostrfeed_mobile/core/services/local_notification_service.dart';
import 'package:nostrfeed_mobile/core/theme/app_theme.dart';
import 'package:nostrfeed_mobile/features/chat/application/dm_notifier.dart';
import 'package:nostrfeed_mobile/features/chat/application/dm_store.dart';
import 'package:nostrfeed_mobile/features/notifications/application/notification_center.dart';
import 'package:nostrfeed_mobile/features/notifications/presentation/widgets/social_alert_banner.dart';
import 'package:nostrfeed_mobile/features/settings/application/app_update_providers.dart';
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
  /// after ~20min–1hr), run the background catch-up: reconnect dead relays
  /// (each re-issues its live subscriptions), restart the feed tails,
  /// resync wallets, and gap-fill DMs — so the user returns to current
  /// content without an app restart. Centralized in BackgroundSyncService
  /// (ADR-0005 P5) — the SAME pass a periodic scheduler will call.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      if (ref.read(nostrServiceProvider).isInitialized) {
        ref.read(backgroundSyncServiceProvider).syncNow();
      }
      // A new app version may have shipped while backgrounded — re-check
      // (soft, non-blocking; shows the drawer banner only if newer).
      ref.invalidate(appUpdateProvider);
    }
  }

  @override
  Widget build(BuildContext context) {
    final router = ref.watch(routerProvider);
    final themeMode = ref.watch(themeModeProvider);
    // OLED Black swaps the dark THEME for the true-black variant — the
    // resolved ThemeMode stays `dark` (see theme_providers.dart).
    final isOled = ref.watch(appAppearanceProvider) == AppAppearance.oled;

    // Global DM notification listener: shows an in-app banner when a new
    // encrypted message arrives from someone else (see DmNotifier).
    ref.watch(dmNotifierProvider);
    // Real-time DM subscription: ingests incoming DMs from all relays into
    // the store (messages arrive live, not just on manual refresh).
    ref.watch(dmLiveListenerProvider);
    // Real-time social engagement: likes, comments, reposts, zaps, follows.
    ref.watch(socialLiveListenerProvider);
    // ADR-0005 ingest pipeline: every gated bus event lands in the local
    // store exactly once; engagement counts tick live (debounced). This is
    // the single write path behind store-first feeds/threads/counts.
    ref.watch(ingestPipelineProvider);
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
      darkTheme: isOled ? AppTheme.oledTheme : AppTheme.darkTheme,
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
