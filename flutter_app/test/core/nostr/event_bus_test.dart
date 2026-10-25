import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/nostr/event_bus.dart';

void main() {
  NostrEvent ev({
    required String id,
    int kind = 1,
    String pubkey = 'ab',
    int createdAt = 1000,
    List<List<String>> tags = const [],
  }) =>
      NostrEvent(
        id: id,
        pubkey: pubkey,
        createdAt: createdAt,
        kind: kind,
        tags: tags,
        content: 'hello',
        sig: 'cd',
      );

  /// A fake L1 transport: counts REQs and feeds events from test-controlled
  /// controllers keyed by spec.
  ({EventBus bus, List<List<NostrFilter>> reqs, StreamController<NostrEvent> Function(int) feed})
      makeBus() {
    final reqs = <List<NostrFilter>>[];
    final controllers = <StreamController<NostrEvent>>[];
    final bus = EventBus(subscribe: (filters) {
      reqs.add(filters);
      final c = StreamController<NostrEvent>.broadcast();
      controllers.add(c);
      return c.stream;
    });
    return (
      bus: bus,
      reqs: reqs,
      feed: (i) => controllers[i],
    );
  }

  group('spec registry (ref-counted dedup)', () {
    test('identical filter-sets share ONE relay REQ', () {
      final f = makeBus();
      final spec = [NostrFilter(kinds: [1])];

      final h1 = f.bus.acquire(spec);
      final h2 = f.bus.acquire([NostrFilter(kinds: [1])]); // same, new object

      expect(f.reqs.length, 1); // one REQ, not two
      expect(f.bus.activeSubscriptionCount, 1);

      h1.dispose();
      expect(f.bus.activeSubscriptionCount, 1); // h2 still holds it
      h2.dispose();
      expect(f.bus.activeSubscriptionCount, 0); // last leaver closes
    });

    test('different orderings of the same filters still dedup', () {
      final f = makeBus();
      final h1 = f.bus.acquire([
        NostrFilter(kinds: [1, 7], authors: ['a', 'b']),
      ]);
      final h2 = f.bus.acquire([
        NostrFilter(kinds: [7, 1], authors: ['b', 'a']),
      ]);
      expect(f.reqs.length, 1);
      h1.dispose();
      h2.dispose();
    });

    test('different filters get separate REQs', () {
      final f = makeBus();
      final h1 = f.bus.acquire([NostrFilter(kinds: [1])]);
      final h2 = f.bus.acquire([NostrFilter(kinds: [7])]);
      expect(f.reqs.length, 2);
      h1.dispose();
      h2.dispose();
    });

    test('double dispose is safe (release exactly once)', () {
      final f = makeBus();
      final h = f.bus.acquire([NostrFilter(kinds: [1])]);
      h.dispose();
      h.dispose(); // no-op, must not underflow the refcount
      expect(f.bus.activeSubscriptionCount, 0);
    });
  });

  group('cross-spec event dedup', () {
    test('the same event on two REQs is delivered ONCE', () async {
      final f = makeBus();
      final h1 = f.bus.acquire([NostrFilter(kinds: [1])]);
      final h2 = f.bus.acquire([NostrFilter(kinds: [1, 7])]);

      final received = <NostrEvent>[];
      final sub = f.bus.stream.listen(received.add);

      final e = ev(id: 'x1');
      f.feed(0).add(e); // arrives on REQ 1
      f.feed(1).add(e); // same event on REQ 2 (overlapping filters)
      await Future<void>.delayed(Duration.zero);

      expect(received.length, 1);
      await sub.cancel();
      h1.dispose();
      h2.dispose();
    });
  });

  group('local filter matching', () {
    test('kind + tag + since matching mirrors relay semantics', () {
      final spec = [
        NostrFilter(
          kinds: [1, 7],
          tagFilters: {'p': ['me']},
          since: 500,
        ),
      ];
      expect(spec.matchesAny(ev(id: 'a', kind: 1, createdAt: 600, tags: [['p', 'me']])), isTrue);
      expect(spec.matchesAny(ev(id: 'b', kind: 6, createdAt: 600, tags: [['p', 'me']])), isFalse); // kind
      expect(spec.matchesAny(ev(id: 'c', kind: 1, createdAt: 400, tags: [['p', 'me']])), isFalse); // since
      expect(spec.matchesAny(ev(id: 'd', kind: 1, createdAt: 600, tags: [['p', 'you']])), isFalse); // tag value
      expect(spec.matchesAny(ev(id: 'e', kind: 1, createdAt: 600)), isFalse); // no tag
    });

    test('authors + ids filters (NIP-01: 64-hex values)', () {
      final alice = 'a' * 64;
      final bob = 'b' * 64;
      expect(
        [NostrFilter(authors: [alice])].matchesAny(ev(id: 'x', pubkey: alice)),
        isTrue,
      );
      expect(
        [NostrFilter(authors: [alice])].matchesAny(ev(id: 'x', pubkey: bob)),
        isFalse,
      );
      expect([NostrFilter(ids: [alice])].matchesAny(ev(id: alice)), isTrue);
      expect([NostrFilter(ids: [alice])].matchesAny(ev(id: bob)), isFalse);
    });

    test('OR semantics across the set', () {
      final spec = [NostrFilter(kinds: [4]), NostrFilter(kinds: [1059])];
      expect(spec.matchesAny(ev(id: 'a', kind: 1059)), isTrue);
      expect(spec.matchesAny(ev(id: 'b', kind: 4)), isTrue);
      expect(spec.matchesAny(ev(id: 'c', kind: 1)), isFalse);
    });

    test('until bound', () {
      final spec = [NostrFilter(until: 1000)];
      expect(spec.matchesAny(ev(id: 'a', createdAt: 999)), isTrue);
      expect(spec.matchesAny(ev(id: 'b', createdAt: 1001)), isFalse);
    });
  });
}
