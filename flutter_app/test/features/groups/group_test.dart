import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/features/auth/data/auth_service.dart';
import 'package:nostrfeed_mobile/features/groups/domain/group_models.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';

ProviderContainer _makeContainer() {
  SharedPreferences.setMockInitialValues({});
  final c = ProviderContainer();
  final auth = AuthService();
  final kp = auth.generateEphemeralKeypair();
  c.read(authStateProvider.notifier).state = AuthState(
    pubkey: kp.pub,
    privateKey: kp.priv,
    isLoggedIn: true,
  );
  final nostr = c.read(nostrServiceProvider);
  nostr.setAuth(c.read(authStateProvider));
  return c;
}

void main() {
  group('GroupInfo (NIP-29 kind 39000)', () {
    NostrEvent metaEvent(List<List<String>> tags) => NostrEvent(
          id: 'g1',
          pubkey: 'relay',
          createdAt: 1000,
          kind: 39000,
          content: '',
          tags: tags,
          sig: 'sig',
        );

    test('parses name, about, picture, flags', () {
      final g = GroupInfo.fromEvent(metaEvent([
        ['d', 'bitcoin-devs'],
        ['name', 'Bitcoin Devs'],
        ['about', 'Core contributors'],
        ['picture', 'https://x.com/p.png'],
        ['open', ''],
        ['public', ''],
      ]));
      expect(g.groupId, 'bitcoin-devs');
      expect(g.name, 'Bitcoin Devs');
      expect(g.about, 'Core contributors');
      expect(g.picture, 'https://x.com/p.png');
      expect(g.isOpen, isTrue);
      expect(g.isPublic, isTrue);
    });

    test('closed flag → not open; private flag → not public', () {
      final g = GroupInfo.fromEvent(metaEvent([
        ['d', 'vip'],
        ['name', 'VIP'],
        ['closed', ''],
        ['private', ''],
      ]));
      expect(g.isOpen, isFalse);
      expect(g.isPublic, isFalse);
    });

    test('missing name → Unnamed Group', () {
      final g = GroupInfo.fromEvent(metaEvent([
        ['d', 'x'],
      ]));
      expect(g.name, 'Unnamed Group');
    });
  });

  group('Group repository event creators', () {
    test('join request has h tag + optional code', () {
      final c = _makeContainer();
      addTearDown(c.dispose);
      final nostr = c.read(nostrServiceProvider);

      final join = nostr.createGroupJoinRequest('devs', inviteCode: 'abc123');
      expect(join.kind, 9021);
      expect(join.getTag('h'), 'devs');
      expect(join.getTag('code'), 'abc123');

      final plain = nostr.createGroupJoinRequest('devs');
      expect(plain.getTag('code'), isNull);
    });

    test('leave request has h tag', () {
      final c = _makeContainer();
      addTearDown(c.dispose);
      final nostr = c.read(nostrServiceProvider);
      final leave = nostr.createGroupLeaveRequest('devs');
      expect(leave.kind, 9022);
      expect(leave.getTag('h'), 'devs');
    });

    test('put-user (9000) with roles; remove-user (9001); delete-event (9005)', () {
      final c = _makeContainer();
      addTearDown(c.dispose);
      final nostr = c.read(nostrServiceProvider);

      final put = nostr.createGroupPutUser('devs', 'target-pk',
          roles: ['moderator'], reason: 'promoted');
      expect(put.kind, 9000);
      expect(put.getTag('h'), 'devs');
      final pTags = put.tags.where((t) => t[0] == 'p').toList();
      expect(pTags.first[1], 'target-pk');
      expect(pTags.first, contains('moderator'));

      final remove = nostr.createGroupRemoveUser('devs', 'bad-pk');
      expect(remove.kind, 9001);
      expect(remove.getTag('p'), 'bad-pk');

      final del = nostr.createGroupDeleteEvent('devs', 'msg-1');
      expect(del.kind, 9005);
      expect(del.getTag('e'), 'msg-1');
    });

    test('createGroup (kind 39000) has d, name, about, picture, flags', () {
      final c = _makeContainer();
      addTearDown(c.dispose);
      final nostr = c.read(nostrServiceProvider);

      final open = nostr.createGroup(
        groupId: 'devs',
        name: 'Devs',
        about: 'Builders',
        picture: 'https://x.com/p.png',
        isOpen: true,
        isPublic: true,
      );
      expect(open.kind, 39000);
      expect(open.getTag('d'), 'devs');
      expect(open.getTag('name'), 'Devs');
      expect(open.getTag('about'), 'Builders');
      expect(open.getTag('picture'), 'https://x.com/p.png');
      expect(open.getTag('open'), isNotNull);
      expect(open.getTag('public'), isNotNull);
      expect(open.getTag('closed'), isNull);
      expect(open.getTag('private'), isNull);

      final closed = nostr.createGroup(
        groupId: 'vip',
        name: 'VIP',
        isOpen: false,
        isPublic: false,
      );
      expect(closed.getTag('closed'), isNotNull);
      expect(closed.getTag('private'), isNotNull);
    });
  });
}
