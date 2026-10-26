import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:shared_preferences/shared_preferences.dart';

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

  // ── Deduplication + burst collapsing (the "again and again" fix) ───────
  //
  // Two real problems, both standard mobile-notification practice:
  //
  // 1. **No persistent notified-ID set** → after an app restart, the
  //    historical notifications fetch replays the same events and each one
  //    fired a NEW phone notification ("I got 40 notifications for the same
  //    likes on every launch"). Fix: a persisted set of event ids already
  //    notified, so an event notifies EXACTLY ONCE, ever.
  //
  // 2. **No burst collapsing** → a viral post's 30 likes = 30 separate
  //    notifications. Fix: Android-style grouping — same-type notifications
  //    within a short window REPLACE the previous one with a count ("Alice
  //    and 5 others liked your post"), like Instagram's collapsed tray.

  static const _notifiedIdsPrefKey = 'notified_event_ids_v1';
  static const _notifiedIdsCap = 500;

  /// Event ids we've already shown a phone notification for (persisted).
  Set<String>? _notifiedIds;

  Future<void> _loadNotifiedIds() async {
    if (_notifiedIds != null) return;
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_notifiedIdsPrefKey);
      if (raw != null) {
        _notifiedIds = (jsonDecode(raw) as List).cast<String>().toSet();
      } else {
        _notifiedIds = <String>{};
      }
    } catch (_) {
      _notifiedIds = <String>{};
    }
  }

  Future<void> _persistNotifiedIds() async {
    final ids = _notifiedIds;
    if (ids == null) return;
    try {
      final prefs = await SharedPreferences.getInstance();
      // Keep it bounded: newest 500 ids (drop oldest by insertion order).
      final list = ids.toList();
      final trimmed = list.length > _notifiedIdsCap
          ? list.sublist(list.length - _notifiedIdsCap)
          : list;
      await prefs.setString(_notifiedIdsPrefKey, jsonEncode(trimmed));
    } catch (_) {}
  }

  /// Has this event id already fired a phone notification? Marks it if not.
  /// Call this BEFORE showing — a true return means SKIP the notification.
  Future<bool> alreadyNotified(String eventId) async {
    await _loadNotifiedIds();
    final ids = _notifiedIds!;
    if (ids.contains(eventId)) return true;
    ids.add(eventId);
    unawaited(_persistNotifiedIds());
    return false;
  }

  /// Test/reset hook: wipe the dedup set (logout / account switch).
  Future<void> resetNotifiedIds() async {
    _notifiedIds = <String>{};
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(_notifiedIdsPrefKey);
    } catch (_) {}
  }

  /// Per-type burst state: replaces the previous notification of the same
  /// type within the window instead of stacking a new one.
  final _burstWindow = const Duration(seconds: 30);
  final Map<AppNotificationType, _Burst> _bursts = {};
  // (the tuple `key` above is only used for type clarity)

  /// Show a notification. [route] is the in-app route to open on tap.
  ///
  /// [eventId] — when provided, the dedup set guarantees this event fires
  /// EXACTLY ONCE across app launches (the historical-fetch replay fix).
  /// [collapseKey] — when provided (e.g. the author pubkey), repeats within
  /// the burst window UPDATE the existing notification with a count instead
  /// of stacking (the Instagram-style collapsed tray).
  Future<void> show({
    required AppNotificationType type,
    required String title,
    required String body,
    required String route,
    String? eventId,
    String? collapseKey,
  }) async {
    if (!_initialized) return;

    // Dedup: an event notifies exactly once, ever.
    if (eventId != null && await alreadyNotified(eventId)) return;

    // Burst collapsing: same type+key within the window → update, not stack.
    final now = DateTime.now();
    String effectiveBody = body;
    int id;
    if (collapseKey != null) {
      final burst = _bursts[type];
      if (burst != null &&
          burst.collapseKey == collapseKey &&
          now.difference(burst.at) < _burstWindow) {
        final newCount = burst.count + 1;
        id = burst.id;
        effectiveBody = _collapseBody(body, newCount);
        _bursts[type] = _Burst(id, collapseKey, now, newCount);
      } else {
        id = _nextId = (_nextId + 1) % 100000;
        _bursts[type] = _Burst(id, collapseKey, now, 1);
      }
    } else {
      id = _nextId = (_nextId + 1) % 100000;
    }

    try {
      await _plugin.show(
        id,
        title,
        effectiveBody,
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

  /// "Alice liked your post" + count → "Alice and 5 others liked your post".
  static String _collapseBody(String body, int count) {
    if (count <= 1) return body;
    // Body shape is "<name> <action>"; fold the name into "name and N others".
    final firstSpace = body.indexOf(' ');
    if (firstSpace <= 0) return body;
    final name = body.substring(0, firstSpace);
    final rest = body.substring(firstSpace + 1);
    return '$name and ${count - 1} others $rest';
  }

  /// Test hook for the collapse text (private logic, pinned by unit test).
  @visibleForTesting
  static String collapseBodyForTest(String body, int count) =>
      _collapseBody(body, count);

  // ── Typed helpers ──────────────────────────────────────────────────

  Future<void> showMessage({
    required String senderName,
    required String preview,
    required String peerPubkey,
    String? eventId,
  }) =>
      show(
        type: AppNotificationType.messages,
        title: senderName,
        body: preview.isEmpty ? 'Sent you an encrypted message' : preview,
        route: '/chat/$peerPubkey',
        eventId: eventId,
        // Each sender collapses into one conversation notification.
        collapseKey: peerPubkey,
      );

  Future<void> showSocial({
    required String text,
    String? eventId,
    String? authorPubkey,
    String? targetEventId,
  }) =>
      show(
        type: AppNotificationType.social,
        title: 'NostrFeed',
        body: text,
        // Deep-link to the POST the action happened on (nip19 note id), not
        // just the bell — a tap should land on the thread, like FB/Insta.
        route: targetEventId != null ? '/note/$targetEventId' : '/notifications',
        eventId: eventId,
        collapseKey: authorPubkey,
      );

  Future<void> showFollow({required String followerName, String? eventId, String? authorPubkey}) => show(
        type: AppNotificationType.follows,
        title: 'New follower',
        body: '$followerName started following you',
        // Deep-link to the NEW FOLLOWER's profile.
        route: authorPubkey != null ? '/npub/$authorPubkey' : '/notifications',
        eventId: eventId,
        collapseKey: authorPubkey,
      );

  Future<void> showZap({required String zapperName, required int sats, String? eventId, String? authorPubkey, String? targetEventId}) =>
      show(
        type: AppNotificationType.zaps,
        title: '⚡ Zap received',
        body: sats > 0
            ? '$zapperName zapped you $sats sats'
            : '$zapperName zapped you',
        // Deep-link to the zapped POST.
        route: targetEventId != null ? '/note/$targetEventId' : '/notifications',
        eventId: eventId,
        collapseKey: authorPubkey,
      );
}

/// One collapsed-notification slot: the id it last showed as, what it
/// collapses on, when, and how many it's folded so far.
class _Burst {
  _Burst(this.id, this.collapseKey, this.at, this.count);
  final int id;
  final String collapseKey;
  final DateTime at;
  int count;
}
