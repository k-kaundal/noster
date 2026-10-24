import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/features/notifications/application/notification_center.dart';

NostrEvent _event({
  required String pubkey,
  required int kind,
  List<List<String>> tags = const [],
  String content = '',
}) {
  return NostrEvent(
    id: 'id-$kind-${tags.length}',
    pubkey: pubkey,
    createdAt: 1700000000,
    kind: kind,
    tags: tags,
    content: content,
    sig: 'sig',
  );
}

void main() {
  const me = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const them = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

  // NotificationCenter needs a Ref; isNotificationForMe is pure, so test it
  // through a minimal container.
  late NotificationCenter center;
  setUp(() {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    center = container.read(notificationCenterProvider);
  });

  group('isNotificationForMe — the "I followed you" bug', () {
    test('my OWN kind-3 self-tag is NOT a notification for me', () {
      // When I follow someone, my kind-3 carries my ENTIRE contact list —
      // including ["p", me]. It must never banner "you started following you".
      final myFollowList = _event(
        pubkey: me,
        kind: 3,
        tags: [
          ['p', them],
          ['p', me], // ← self-tag, why the bug existed
        ],
      );
      expect(center.isNotificationForMe(myFollowList, me), isFalse);
    });

    test('someone ELSE following me IS a notification for me', () {
      final theirFollowList = _event(
        pubkey: them,
        kind: 3,
        tags: [
          ['p', me],
        ],
      );
      expect(center.isNotificationForMe(theirFollowList, me), isTrue);
    });
  });

  group('isNotificationForMe — zap receipts', () {
    String zapReceipt({required List<List<String>> requestTags}) {
      final request = {'tags': requestTags};
      return jsonEncode(request);
    }

    test('a zap whose REQUEST p-tags me IS for me', () {
      final receipt = _event(
        pubkey: them,
        kind: 9735,
        tags: [
          ['description', zapReceipt(requestTags: [
            ['p', me],
            ['amount', '21000'],
          ])],
        ],
      );
      expect(center.isNotificationForMe(receipt, me), isTrue);
    });

    test('my OWN outgoing zap echoed back is NOT for me', () {
      final receipt = _event(
        pubkey: me, // receipt of my own zap to someone else
        kind: 9735,
        tags: [
          ['description', zapReceipt(requestTags: [
            ['p', them],
            ['amount', '21000'],
          ])],
        ],
      );
      expect(center.isNotificationForMe(receipt, me), isFalse);
    });

    test('a zap request tagging someone else is NOT for me', () {
      final receipt = _event(
        pubkey: them,
        kind: 9735,
        tags: [
          ['description', zapReceipt(requestTags: [
            ['p', 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'],
          ])],
        ],
      );
      expect(center.isNotificationForMe(receipt, me), isFalse);
    });
  });

  group('isNotificationForMe — other engagement', () {
    test('my own like on my own post is NOT a notification', () {
      final myLike = _event(pubkey: me, kind: 7, tags: [
        ['e', 'somepost'],
        ['p', me],
      ]);
      expect(center.isNotificationForMe(myLike, me), isFalse);
    });

    test('someone else liking my post IS a notification', () {
      final theirLike = _event(pubkey: them, kind: 7, tags: [
        ['e', 'somepost'],
        ['p', me],
      ]);
      expect(center.isNotificationForMe(theirLike, me), isTrue);
    });
  });
}
