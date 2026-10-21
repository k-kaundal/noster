import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

/// Notification categories — each gets its own Android channel so users can
/// control them independently in system settings (like FB/Insta).
enum AppNotificationType {
  messages('channel_messages', 'Messages', 'Encrypted direct messages'),
  social('channel_social', 'Social', 'Likes, replies, reposts, mentions'),
  follows('channel_follows', 'Followers', 'New followers'),
  zaps('channel_zaps', 'Zaps', 'Lightning zaps');

  const AppNotificationType(this.channelId, this.channelName, this.description);
  final String channelId;
  final String channelName;
  final String description;
}

/// Background notification tap handler. MUST be a PUBLIC top-level function —
/// the plugin invokes it as a Flutter entry point from the native side,
/// and instance/closures are not accessible there. It also cannot be
/// library-private (leading `_`): `PluginUtilities.getCallbackHandle`
/// returns null for private names, which trips the plugin's assertion
/// on iOS ("The backgroundHandler needs to be either a static function
/// or a top level function").
@pragma('vm:entry-point')
void onBackgroundNotificationTap(NotificationResponse response) {
  LocalNotificationService.instance.handleTap(response.payload);
}

/// Local push notifications driven by the app's live relay listeners.
///
/// Unlike FCM, these fire from the app's own WebSocket subscriptions, so
/// they work whenever the app process is alive — including backgrounded
/// (like FB/Insta while the OS keeps the process). Tapping a notification
/// deep-links to the correct route via the payload.
class LocalNotificationService {
  LocalNotificationService._();
  static final LocalNotificationService instance = LocalNotificationService._();

  final _plugin = FlutterLocalNotificationsPlugin();
  bool _initialized = false;

  /// Called with the route path when the user taps a notification
  /// (e.g. `/chat/<pubkey>` or `/notifications`). Set by app.dart after the
  /// router exists.
  void Function(String route)? onNotificationTap;

  Future<void> init() async {
    if (_initialized) return;
    const androidInit = AndroidInitializationSettings('@mipmap/ic_launcher');
    const darwinInit = DarwinInitializationSettings(
      requestAlertPermission: true,
      requestBadgePermission: true,
      requestSoundPermission: true,
    );
    await _plugin.initialize(
      const InitializationSettings(android: androidInit, iOS: darwinInit),
      onDidReceiveNotificationResponse: (response) => handleTap(response.payload),
      // iOS: the plugin validates the background callback as a Flutter entry
      // point and crashes if it can't resolve it. iOS forwards notification
      // taps through onDidReceiveNotificationResponse on app reopen anyway,
      // so we only register the background entry point on Android.
      onDidReceiveBackgroundNotificationResponse:
          defaultTargetPlatform == TargetPlatform.android
              ? onBackgroundNotificationTap
              : null,
    );

    // Create Android channels (one per type).
    final android = _plugin.resolvePlatformSpecificImplementation<
        AndroidFlutterLocalNotificationsPlugin>();
    if (android != null) {
      for (final type in AppNotificationType.values) {
        await android.createNotificationChannel(
          AndroidNotificationChannel(
            type.channelId,
            type.channelName,
            description: type.description,
            importance: type == AppNotificationType.messages
                ? Importance.high
                : Importance.defaultImportance,
          ),
        );
      }
      // Android 13+ runtime permission.
      await android.requestNotificationsPermission();
    }
    _initialized = true;
  }

  /// Handles a notification tap payload (foreground or background entry).
  void handleTap(String? payload) {
    if (payload != null && payload.isNotEmpty) {
      onNotificationTap?.call(payload);
    }
  }

  int _nextId = 1;

  /// Show a notification. [route] is the in-app route to open on tap.
  Future<void> show({
    required AppNotificationType type,
    required String title,
    required String body,
    required String route,
  }) async {
    if (!_initialized) return;
    final id = _nextId = (_nextId + 1) % 100000;
    try {
      await _plugin.show(
        id,
        title,
        body,
        NotificationDetails(
          android: AndroidNotificationDetails(
            type.channelId,
            type.channelName,
            channelDescription: type.description,
            importance: type == AppNotificationType.messages
                ? Importance.high
                : Importance.defaultImportance,
            priority: type == AppNotificationType.messages
                ? Priority.high
                : Priority.defaultPriority,
            icon: '@mipmap/ic_launcher',
          ),
          iOS: const DarwinNotificationDetails(
            presentAlert: true,
            presentBadge: true,
            presentSound: true,
          ),
        ),
        payload: route,
      );
    } catch (e) {
      debugPrint('LocalNotificationService.show failed: $e');
    }
  }

  // ── Typed helpers ──────────────────────────────────────────────────

  Future<void> showMessage({
    required String senderName,
    required String preview,
    required String peerPubkey,
  }) =>
      show(
        type: AppNotificationType.messages,
        title: senderName,
        body: preview.isEmpty ? 'Sent you an encrypted message' : preview,
        route: '/chat/$peerPubkey',
      );

  Future<void> showSocial({required String text}) => show(
        type: AppNotificationType.social,
        title: 'NostrFeed',
        body: text,
        route: '/notifications',
      );

  Future<void> showFollow({required String followerName}) => show(
        type: AppNotificationType.follows,
        title: 'New follower',
        body: '$followerName started following you',
        route: '/notifications',
      );

  Future<void> showZap({required String zapperName, required int sats}) =>
      show(
        type: AppNotificationType.zaps,
        title: '⚡ Zap received',
        body: sats > 0
            ? '$zapperName zapped you $sats sats'
            : '$zapperName zapped you',
        route: '/notifications',
      );
}
