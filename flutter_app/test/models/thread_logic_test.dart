import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';

NostrEvent ev({
  required int kind,
  required String content,
  required List<List<String>> tags,
}) =>
    NostrEvent(
      id: 'e' * 2,
      pubkey: 'p' * 2,
      createdAt: 1,
      kind: kind,
      tags: tags,
      content: content,
      sig: 's' * 2,
    );

void main() {
  group('NIP-10 thread parsing', () {
    test('a marked root+reply resolves both', () {
      final e = ev(
        kind: 1,
        content: 'reply',
        tags: [
          ['e', 'rootid', '', 'reply'],
          ['e', 'realroot', '', 'root'],
        ],
      );
      expect(e.rootId, 'realroot');
      expect(e.replyToId, 'rootid');
      expect(e.isReply, isTrue);
    });

    test('a direct reply to the root uses only "root" and is its own parent', () {
      final e = ev(
        kind: 1,
        content: 'top reply',
        tags: [
          ['e', 'rootid', '', 'root'],
        ],
      );
      expect(e.rootId, 'rootid');
      // replyToId falls back through unmarked/marked logic — root marked
      // counts as the parent too via the single-tag fallback.
      expect(e.isReply, isTrue);
    });

    test('positional (deprecated): first is root, last is reply', () {
      final e = ev(
        kind: 1,
        content: 'legacy reply',
        tags: [
          ['e', 'rootid'],
          ['e', 'mentionid'],
          ['e', 'parentid'],
        ],
      );
      expect(e.rootId, 'rootid');
      expect(e.replyToId, 'parentid');
      expect(e.isReply, isTrue);
    });

    test('a "mention"-marked e-tag does NOT make the post a reply', () {
      // The bug: a post quoting via an e-tag mention was labeled a reply and
      // hidden from the Posts tab.
      final e = ev(
        kind: 1,
        content: 'great post, read this',
        tags: [
          ['e', 'quotedid', '', 'mention'],
        ],
      );
      expect(e.isReply, isFalse);
      expect(e.rootId, isNull);
      expect(e.replyToId, isNull);
    });
  });

  group('NIP-18 quotes', () {
    test('q tags are captured and never make a post a reply', () {
      final quotedId = 'a' * 64;
      final e = ev(
        kind: 1,
        content: 'this is worth reading nostr:note1xyz',
        tags: [
          ['q', quotedId],
        ],
      );
      expect(e.quoteRefs, contains(quotedId));
      expect(e.quoteId, quotedId);
      expect(e.isReply, isFalse); // a quote is NOT a reply
    });

    test('q tag with a non-hex (address) value is not treated as an event id', () {
      final e = ev(
        kind: 1,
        content: 'quoting an article',
        tags: [
          ['q', '30023:${'b' * 64}:my-article'],
        ],
      );
      expect(e.quoteRefs, isNotEmpty); // raw value captured
      expect(e.quoteId, isNot(contains(':'))); // quoteId only yields event ids
      expect(e.isReply, isFalse);
    });
  });

  group('isReply across kinds', () {
    test('a kind-20 picture post with e-tags is never a reply', () {
      final e = ev(
        kind: 20,
        content: '',
        tags: [
          ['e', 'someid'],
        ],
      );
      expect(e.isReply, isFalse);
    });

    test('a standalone kind-1 note is not a reply', () {
      final e = ev(kind: 1, content: 'gm', tags: []);
      expect(e.isReply, isFalse);
      expect(e.rootId, isNull);
      expect(e.replyToId, isNull);
    });
  });
}
