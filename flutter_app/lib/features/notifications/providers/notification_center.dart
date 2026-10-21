import 'dart:async';
import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/services/local_notification_service.dart';

/// A social engagement event ready for display: like, comment, repost,
/// zap, reply, or new follower targeting the current user.
class SocialEvent {
  final NostrEvent event;

  /// Wall-clock arrival time (unix seconds). NIP-17-style backdating isn't
  /// an issue for these kinds, but arrival time keeps unread/banner logic
  /// consistent and immune to clock skew on the author's device.
  final int arrivedAt;

  const SocialEvent({required this.event, required this.arrivedAt});

  /// Sats amount for zap receipts (0 for other kinds).
  int get zapSats {
    if (event.kind != 9735) return 0;
    // Per NIP-57 the amount lives in the zap REQUEST (description tag).
    final desc = event.getTag('description');
    if (desc != null) {
      try {
        final req = jsonDecode(desc) as Map<String, dynamic>;
        for (final tag in (req['tags'] as List? ?? [])) {
          if (tag is List && tag.isNotEmpty && tag[0] == 'amount') {
            return (int.tryParse('${tag[1]}') ?? 0) ~/ 1000; // msats → sats
          }
        }
      } catch (_) {}
    }
    return 0;
  }
}

/// A pending in-app banner for a social interaction.
class SocialAlert {
  final SocialEvent event;
  const SocialAlert(this.event);
}

/// Real-time social engagement center: ingests likes, comments, reposts,
/// zaps, replies, and new followers from the live subscription, tracks
/// unread state, and drives in-app banners + the notifications badge.
class NotificationCenter {
  final Ref _ref;
  NotificationCenter(this._ref) {
    ready = _restoreLastRead();
  }

  /// Epoch counter: bumped by [reset] so an in-flight [_restoreLastRead]
  /// from before the reset can't write a stale watermark afterwards.
  int _epoch = 0;

  static const _lastReadPrefKey = 'notifications_last_read_v1';

  /// Live events (deduped by id), newest first.
  final List<SocialEvent> _events = [];
  final Set<String> _seen = {};

  /// Events that happened while the app was closed (from the historical
  /// fetch) and are newer than the last-read watermark. Set by [syncUnread].
  int _historicalUnread = 0;

  int _lastRead = 0;
  late final Future<void> ready;

  int get lastRead => _lastRead;

  List<SocialEvent> get events => List.unmodifiable(_events);

  /// Ingest one live event. Returns true when it was new.
  bool ingest(NostrEvent event) {
    if (!_isEngagementKind(event.kind)) return false;
    if (event.isExpired) return false;
    if (!_seen.add(event.id)) return false;
    final arrived = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    _events.insert(0, SocialEvent(event: event, arrivedAt: arrived));
    // Keep the in-memory list bounded.
    if (_events.length > 200) _events.removeRange(200, _events.length);
    _ref.read(notificationVersionProvider.notifier).state++;
    // Refresh the historical list so the notifications screen picks this up
    // too (debounced by Riverpod's own rebuild batching).
    _ref.invalidate(notificationsProvider);
    // Engagement on a specific event → refresh its counts live.
    final target = event.getTag('e');
    if (target != null) {
      _ref.invalidate(engagementProvider(target));
      _ref.invalidate(userInteractionsProvider([target]));
    }
    return true;
  }

  /// Total unread: live events since last-read + historical (from fetch).
  /// Historical events already seen live are not double-counted.
  int get unreadCount {
    final live = _events.where((e) => e.arrivedAt > _lastRead).length;
    return live + _historicalUnread;
  }

  /// Unread recomputed from a historical fetch, excluding anything already
  /// tracked live and anything at/before the watermark.
  void _recomputeHistorical(List<NostrEvent> history) {
    _historicalUnread = history.where((e) {
      if (!_isEngagementKind(e.kind)) return false;
      if (_seen.contains(e.id)) return false;
      // Second-precision boundary: events created in the same second as the
      // watermark are ambiguous — count them as unread (safe direction).
      return e.createdAt >= _lastRead;
    }).length;
  }

  /// Recompute the historical unread count from a notifications fetch.
  /// Called by the notifications screen / provider listener whenever the
  /// one-shot list updates.
  void syncUnreadFromHistory(List<NostrEvent> history) {
    _recomputeHistorical(history);
    _ref.read(notificationVersionProvider.notifier).state++;
  }

  /// Mark all notifications as read (opening the notifications screen).
  /// Watermark = the newest arrival time we know of (live events) or the
  /// wall clock — whichever is LATER. Device clocks can drift a second
  /// either way, and comparing against max(...) makes the boundary exact.
  Future<void> markAllRead() async {
    var watermark = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    for (final e in _events) {
      if (e.arrivedAt > watermark) watermark = e.arrivedAt;
    }
    _lastRead = watermark;
    _historicalUnread = 0;
    _ref.read(notificationVersionProvider.notifier).state++;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setInt(_lastReadPrefKey, _lastRead);
    } catch (_) {}
  }

  /// Wipe in-memory state (logout / account switch / tests). The next
  /// account's unread state starts clean — persisted watermark included.
  void reset() {
    _epoch++; // invalidate any in-flight _restoreLastRead
    _events.clear();
    _seen.clear();
    _historicalUnread = 0;
    _lastRead = 0;
    _ref.read(notificationVersionProvider.notifier).state++;
    SharedPreferences.getInstance()
        .then((p) => p.remove(_lastReadPrefKey))
        .ignore();
  }

  Future<void> _restoreLastRead() async {
    final epoch = _epoch;
    try {
      final prefs = await SharedPreferences.getInstance();
      final stored = prefs.getInt(_lastReadPrefKey) ?? 0;
      // A reset() happened while the prefs read was in flight — keep the
      // reset state, drop the stale watermark.
      if (epoch != _epoch) return;
      _lastRead = stored;
    } catch (_) {
      if (epoch == _epoch) _lastRead = 0;
    }
  }

  static bool _isEngagementKind(int kind) =>
      kind == 1 || kind == 3 || kind == 6 || kind == 7 || kind == 16 ||
      kind == 1111 || kind == 9735;

  /// Human-readable banner text for an event (without the author's name —
  /// the banner widget prepends it).
  static String actionText(NostrEvent e) => switch (e.kind) {
        7 => 'liked your post',
        6 || 16 => 'reposted your post',
        1 => 'replied to you',
        1111 => 'commented on your post',
        9735 => 'zapped you',
        3 => 'started following you',
        _ => 'interacted with you',
      };
}

final notificationCenterProvider = Provider<NotificationCenter>((ref) {
  return NotificationCenter(ref);
});

/// Bumped on every notification-center mutation (ingest, mark-read, sync).
final notificationVersionProvider = StateProvider<int>((ref) => 0);

/// Total unread social notifications — drives the bell badge in the AppBar.
final unreadNotificationsProvider = Provider<int>((ref) {
  ref.watch(notificationVersionProvider);
  return ref.read(notificationCenterProvider).unreadCount;
});

/// Real-time engagement stream: reactions, replies, reposts, comments,
/// zaps, and new followers p-tagged to the current user.
final liveSocialEventsProvider = StreamProvider.autoDispose<NostrEvent>((ref) {
  final auth = ref.watch(authStateProvider);
  if (!auth.isLoggedIn || auth.pubkey == null) return const Stream.empty();
  final nostr = ref.watch(nostrServiceProvider);
  if (!nostr.isInitialized) return const Stream.empty();
  final since = DateTime.now().millisecondsSinceEpoch ~/ 1000 - 3600;
  return nostr.relayPool.subscribe([
    NostrFilter(
      kinds: [1, 3, 6, 7, 16, 1111, 9735],
      tagFilters: {
        'p': [auth.pubkey!],
      },
      since: since,
    ),
  ]);
});

/// The pending social banner (auto-dismissed by the banner widget).
final socialAlertProvider = StateProvider<SocialAlert?>((ref) => null);

/// Wires the live engagement stream into the center + banner state.
/// Watch once at the app root (app.dart).
final socialLiveListenerProvider = Provider<void>((ref) {
  // Ingest live events.
  ref.listen(liveSocialEventsProvider, (_, next) {
    next.whenData((event) {
      final center = ref.read(notificationCenterProvider);
      final auth = ref.read(authStateProvider);
      // Never banner my own actions (liking my own post, self-replies).
      if (event.pubkey == auth.pubkey) {
        center.ingest(event);
        return;
      }
      if (center.ingest(event)) {
        final socialEvent = SocialEvent(
          event: event,
          arrivedAt: DateTime.now().millisecondsSinceEpoch ~/ 1000,
        );
        ref.read(socialAlertProvider.notifier).state = SocialAlert(socialEvent);

        // ── Phone notification, typed per category ──────────────────
        final name = ref
                .read(profileProvider(event.pubkey))
                .valueOrNull
                ?.displayNameOrName ??
            '${event.pubkey.substring(0, 8)}…';
        final notifs = LocalNotificationService.instance;
        switch (event.kind) {
          case 3:
            notifs.showFollow(followerName: name);
          case 9735:
            notifs.showZap(zapperName: name, sats: socialEvent.zapSats);
          default:
            notifs.showSocial(text: '$name ${NotificationCenter.actionText(event)}');
        }
      }
    });
  });
  // Keep historical unread in sync with the one-shot fetch.
  ref.listen(notificationsProvider, (_, next) {
    next.whenData((events) {
      ref.read(notificationCenterProvider).syncUnreadFromHistory(events);
    });
  });
});
