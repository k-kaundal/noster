import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';

void main() {
  group('NostrEvent', () {
    NostrEvent makeEvent({
      String id = 'id1',
      String pubkey = 'pk1',
      int kind = 1,
      List<List<String>> tags = const [],
      String content = '',
      int createdAt = 1700000000,
    }) =>
        NostrEvent(
          id: id,
          pubkey: pubkey,
          createdAt: createdAt,
          kind: kind,
          tags: tags,
          content: content,
          sig: 'sig',
        );

    test('JSON round-trip preserves all fields', () {
      final event = makeEvent(
        tags: [
          ['t', 'nostr'],
          ['e', 'abc', '', 'root'],
        ],
        content: 'hello',
      );
      final restored = NostrEvent.fromJson(event.toJson());
      expect(restored.id, event.id);
      expect(restored.pubkey, event.pubkey);
      expect(restored.createdAt, event.createdAt);
      expect(restored.kind, event.kind);
      expect(restored.tags, event.tags);
      expect(restored.content, event.content);
      expect(restored.sig, event.sig);
    });

    test('getTag returns first value, getTags returns all', () {
      final event = makeEvent(tags: [
        ['t', 'a'],
        ['t', 'b'],
        ['x'],
      ]);
      expect(event.getTag('t'), 'a');
      expect(event.getTags('t'), ['a', 'b']);
      expect(event.getTag('missing'), isNull);
      // tag with no value is ignored
      expect(event.getTag('x'), isNull);
    });

    test('rootId prefers tagged root marker', () {
      final event = makeEvent(tags: [
        ['e', 'reply-id', '', 'reply'],
        ['e', 'root-id', '', 'root'],
      ]);
      expect(event.rootId, 'root-id');
      expect(event.replyToId, 'reply-id');
      expect(event.isReply, isTrue);
    });

    test('rootId falls back to first e-tag when no marker', () {
      final event = makeEvent(tags: [
        ['e', 'first'],
        ['e', 'second'],
      ]);
      expect(event.rootId, 'first');
      expect(event.replyToId, 'second');
    });

    test('isAddressable only for 30000-39999', () {
      expect(makeEvent(kind: 1).isAddressable, isFalse);
      expect(makeEvent(kind: 30023).isAddressable, isTrue);
      expect(makeEvent(kind: 39999).isAddressable, isTrue);
      expect(makeEvent(kind: 40000).isAddressable, isFalse);
    });

    test('address composes kind:pubkey:dTag', () {
      final event = makeEvent(
        kind: 30023,
        pubkey: 'pk',
        tags: [
          ['d', 'my-article'],
        ],
      );
      expect(event.address, '30023:pk:my-article');
    });

    test('expiration detection', () {
      final expired = makeEvent(tags: [
        ['expiration', '1000'],
      ]);
      expect(expired.isExpired, isTrue);

      final future = makeEvent(tags: [
        ['expiration', '9999999999'],
      ]);
      expect(future.isExpired, isFalse);

      expect(makeEvent().isExpired, isFalse);
    });

    test('computeId is deterministic sha256 of serialized event', () {
      final id1 = NostrEvent.computeId('pk', 1, 1, const [], 'c');
      final id2 = NostrEvent.computeId('pk', 1, 1, const [], 'c');
      final id3 = NostrEvent.computeId('pk', 1, 1, const [], 'different');
      expect(id1, id2);
      expect(id1, isNot(id3));
      expect(id1.length, 64); // sha256 hex
    });
  });

  group('NostrFilter', () {
    test('toJson includes tag filters with # prefix', () {
      final filter = NostrFilter(
        kinds: [1],
        authors: ['pk'],
        tagFilters: {
          't': ['nostr'],
        },
        limit: 10,
        search: 'hello',
      );
      final json = filter.toJson();
      expect(json['kinds'], [1]);
      expect(json['authors'], ['pk']);
      expect(json['#t'], ['nostr']);
      expect(json['limit'], 10);
      expect(json['search'], 'hello');
    });

    test('toJson omits null fields', () {
      final json = NostrFilter().toJson();
      expect(json, isEmpty);
    });
  });

  group('NostrProfile', () {
    test('displayName fallback chain', () {
      expect(
        const NostrProfile(displayName: 'D', name: 'n').displayNameOrName,
        'D',
      );
      expect(const NostrProfile(name: 'n').displayNameOrName, 'n');
      expect(const NostrProfile().displayNameOrName, 'Anonymous');
    });

    test('fromJson/toJson round trip', () {
      final profile = NostrProfile.fromJson(const {
        'name': 'alice',
        'display_name': 'Alice',
        'about': 'about me',
        'picture': 'https://x/p.png',
        'nip05': 'alice@x.com',
        'lud16': 'alice@wallet.com',
      });
      expect(profile.name, 'alice');
      expect(profile.displayName, 'Alice');
      expect(profile.about, 'about me');
      expect(profile.nip05, 'alice@x.com');
      final json = profile.toJson();
      expect(json['name'], 'alice');
      expect(json['display_name'], 'Alice');
    });
  });
}
