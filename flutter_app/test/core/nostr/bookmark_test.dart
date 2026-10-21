import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/nostr/repositories/social_repository.dart';

NostrEvent _bm(int createdAt, List<String> ids) => NostrEvent(
      id: 'list-$createdAt',
      pubkey: 'me',
      createdAt: createdAt,
      kind: 10003,
      tags: [
        for (final id in ids) ['e', id],
      ],
      content: '',
      sig: 's',
    );

void main() {
  group('newestBookmarkRevision (replaceable kind-10003 merge)', () {
    test('picks the NEWEST revision across relays, never the first', () {
      // Relay A holds a stale revision (older, missing post-3); relay B holds
      // the fresh one. `limit: 1` could return either — the merge must take B.
      final stale = _bm(1000, ['post-1', 'post-2']);
      final fresh = _bm(2000, ['post-1', 'post-2', 'post-3']);

      // Order deliberately stale-first, as an unordered query returns.
      final newest =
          SocialRepository.newestBookmarkRevision([stale, fresh]);
      expect(newest!.createdAt, 2000);
      expect(newest.eventRefs, containsAll(['post-1', 'post-2', 'post-3']));
    });

    test('order in the list does not matter', () {
      final stale = _bm(1000, ['a']);
      final fresh = _bm(3000, ['a', 'b']);
      final mid = _bm(2000, ['a']);

      for (final perm in [
        [stale, fresh, mid],
        [fresh, mid, stale],
        [mid, stale, fresh],
      ]) {
        expect(
          SocialRepository.newestBookmarkRevision(perm)!.createdAt,
          3000,
        );
      }
    });

    test('empty input is null, single revision is itself', () {
      expect(SocialRepository.newestBookmarkRevision([]), isNull);
      final only = _bm(500, ['x']);
      expect(SocialRepository.newestBookmarkRevision([only]), same(only));
    });
  });
}
