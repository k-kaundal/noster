import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/features/lists/domain/nostr_list.dart';

NostrEvent _listEvent({
  String id = 'e1',
  String pubkey = 'author',
  String d = 'bitcoin-devs',
  String title = 'Bitcoin Devs',
  String description = 'Core contributors',
  String? image,
  List<String> members = const ['pk1', 'pk2', 'pk3'],
  int createdAt = 1000,
}) =>
    NostrEvent(
      id: id,
      pubkey: pubkey,
      createdAt: createdAt,
      kind: 30000,
      content: '',
      tags: [
        ['d', d],
        ['title', title],
        ['description', description],
        if (image != null) ['image', image],
        for (final pk in members) ['p', pk],
      ],
      sig: 'sig',
    );

void main() {
  group('NostrList (NIP-51 kind 30000)', () {
    test('parses all fields from an event', () {
      final list = NostrList.fromEvent(
        _listEvent(image: 'https://x.com/cover.jpg'),
      );
      expect(list.dTag, 'bitcoin-devs');
      expect(list.title, 'Bitcoin Devs');
      expect(list.description, 'Core contributors');
      expect(list.image, 'https://x.com/cover.jpg');
      expect(list.members, ['pk1', 'pk2', 'pk3']);
      expect(list.authorPubkey, 'author');
    });

    test('coordinate is kind:pubkey:d', () {
      final list = NostrList.fromEvent(_listEvent());
      expect(list.coordinate, '30000:author:bitcoin-devs');
    });

    test('title falls back to d tag, then Untitled', () {
      final e = NostrEvent(
        id: 'e2',
        pubkey: 'a',
        createdAt: 1,
        kind: 30000,
        content: '',
        tags: [
          ['d', 'my-list'],
        ],
        sig: 's',
      );
      expect(NostrList.fromEvent(e).title, 'my-list');

      final e2 = NostrEvent(
        id: 'e3',
        pubkey: 'a',
        createdAt: 1,
        kind: 30000,
        content: '',
        tags: const [],
        sig: 's',
      );
      expect(NostrList.fromEvent(e2).title, 'Untitled list');
    });

    test('toTags round-trips to an equivalent list', () {
      final original = NostrList.fromEvent(
        _listEvent(image: 'https://x.com/c.jpg'),
      );
      final tags = original.toTags();
      final rebuilt = NostrList.fromEvent(
        NostrEvent(
          id: original.id,
          pubkey: original.authorPubkey,
          createdAt: original.createdAt,
          kind: 30000,
          content: '',
          tags: tags,
          sig: 's',
        ),
      );
      expect(rebuilt.dTag, original.dTag);
      expect(rebuilt.title, original.title);
      expect(rebuilt.description, original.description);
      expect(rebuilt.image, original.image);
      expect(rebuilt.members, original.members);
    });

    test('empty optional fields are omitted from tags', () {
      final list = NostrList.fromEvent(
        _listEvent(description: '', image: null),
      );
      final tags = list.toTags();
      expect(tags.any((t) => t[0] == 'description'), isFalse);
      expect(tags.any((t) => t[0] == 'image'), isFalse);
      expect(tags.any((t) => t[0] == 'd'), isTrue);
    });
  });
}
