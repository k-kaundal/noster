import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/features/auth/services/auth_service.dart';
import 'package:nostrfeed_mobile/features/notifications/providers/notification_center.dart';

const _me = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const _them = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

ProviderContainer _makeContainer() {
  SharedPreferences.setMockInitialValues({});
  final c = ProviderContainer();
  c.read(authStateProvider.notifier).state = const AuthState(
    pubkey: _me,
    privateKey: '1111111111111111111111111111111111111111111111111111111111111111',
    isLoggedIn: true,
  );
  return c;
}

Future<NotificationCenter> _freshCenter(ProviderContainer c) async {
  // Each test gets a clean center: let any in-flight restore finish, THEN
  // reset so no stale watermark/events survive from the previous test.
  final center = c.read(notificationCenterProvider);
  await center.ready;
  center.reset();
  return center;
}

NostrEvent _event({
  required String id,
  required int kind,
  int createdAt = 1000,
  String content = '',
  List<List<String>> tags = const [],
}) =>
    NostrEvent(
      id: id,
      pubkey: _them,
      createdAt: createdAt,
      kind: kind,
      tags: tags,
      content: content,
      sig: 'sig',
    );

void main() {
  group('NotificationCenter', () {
    test('ingest dedupes and counts unread', () async {
      final c = _makeContainer();
      addTearDown(c.dispose);
      final center = await _freshCenter(c);


      final like = _event(id: 'e1', kind: 7);
      expect(center.ingest(like), isTrue);
      expect(center.ingest(like), isFalse); // duplicate
      expect(center.unreadCount, 1);
    });

    test('markAllRead clears unread and persists', () async {
      final c = _makeContainer();
      addTearDown(c.dispose);
      final center = await _freshCenter(c);


      center.ingest(_event(id: 'e1', kind: 7));
      center.ingest(_event(id: 'e2', kind: 6));
      expect(center.unreadCount, 2);

      await center.markAllRead();
      expect(center.unreadCount, 0);
    });

    test('ignores non-engagement kinds', () async {
      final c = _makeContainer();
      addTearDown(c.dispose);
      final center = await _freshCenter(c);


      expect(center.ingest(_event(id: 'e1', kind: 30023)), isFalse);
      expect(center.unreadCount, 0);
    });

    test('zapSats parses amount from zap request description', () {
      final zap = _event(
        id: 'z1',
        kind: 9735,
        tags: [
          [
            'description',
            '{"tags":[["amount","21000"]]}',
          ],
        ],
      );
      final se = SocialEvent(event: zap, arrivedAt: 100);
      expect(se.zapSats, 21);
    });

    test('zapSats falls back to bolt11 amount prefix', () {
      // lnbc210n = 210 nano-BTC = 21 sats (no description tag).
      final zap = _event(
        id: 'z2',
        kind: 9735,
        tags: [
          ['bolt11', 'lnbc210n1pjxxxxx'],
        ],
      );
      final se = SocialEvent(event: zap, arrivedAt: 100);
      expect(se.zapSats, 21);
    });

    test('zapSats is 0 for non-zap kinds', () {
      final like = _event(id: 'l1', kind: 7);
      expect(SocialEvent(event: like, arrivedAt: 1).zapSats, 0);
    });

    test('actionText covers all engagement kinds', () {
      expect(NotificationCenter.actionText(_event(id: 'a', kind: 7)),
          'liked your post');
      expect(NotificationCenter.actionText(_event(id: 'b', kind: 6)),
          'reposted your post');
      expect(NotificationCenter.actionText(_event(id: 'c', kind: 1)),
          'replied to you');
      expect(NotificationCenter.actionText(_event(id: 'd', kind: 1111)),
          'commented on your post');
      expect(NotificationCenter.actionText(_event(id: 'e', kind: 9735)),
          'zapped you');
      expect(NotificationCenter.actionText(_event(id: 'f', kind: 3)),
          'started following you');
    });

    test('syncUnreadFromHistory counts only new historical events', () async {
      final c = _makeContainer();
      addTearDown(c.dispose);
      final center = await _freshCenter(c);

      final now = DateTime.now().millisecondsSinceEpoch ~/ 1000;
      // Read watermark set to 1 hour ago — events older than that are "seen".
      await center.markAllRead();
      final old = now - 7200; // 2h ago — before the watermark
      center.syncUnreadFromHistory([
        _event(id: 'h1', kind: 7, createdAt: now), // new
        _event(id: 'h2', kind: 7, createdAt: old), // before watermark
      ]);
      expect(center.unreadCount, 1, reason: 'lastRead=${center.lastRead}, now=$now');
    });
  });
}
