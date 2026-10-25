import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/nostr/filter.dart';

/// ADR-0007 Phase 0 — the filter oracle.
///
/// Strategy lifted straight from strfry's test suite: keep a deliberately
/// dead-simple, obviously-correct "dumb" matcher, generate random events and
/// random filter groups, and assert the compiled engine agrees with the dumb
/// one on every input. Any `&&`/`||`/empty-list/case bug in the optimized
/// engine shows up as a divergence.
void main() {
  // ── The dumb reference matcher ─────────────────────────────────────────
  // Written to mirror the NIP-01 text as literally as possible, with zero
  // concern for speed. If this and CompiledFilter disagree, the dumb one
  // wins (and this file fails).
  bool dumbMatches(NostrFilter f, NostrEvent e) {
    bool hexOk(String v) => RegExp(r'^[0-9a-fA-F]{64}$').hasMatch(v);

    if (f.ids != null) {
      final valid = f.ids!.where(hexOk).map((v) => v.toLowerCase()).toList();
      if (!valid.contains(e.id.toLowerCase())) return false;
    }
    if (f.authors != null) {
      final valid =
          f.authors!.where(hexOk).map((v) => v.toLowerCase()).toList();
      if (!valid.contains(e.pubkey.toLowerCase())) return false;
    }
    if (f.kinds != null && !f.kinds!.contains(e.kind)) return false;
    if (f.since != null && e.createdAt < f.since!) return false;
    if (f.until != null && e.createdAt > f.until!) return false;
    if (f.tagFilters != null) {
      for (final entry in f.tagFilters!.entries) {
        final wanted = entry.value;
        if (wanted.isEmpty) return false; // empty list matches NOTHING
        final hit = e.tags.any((t) =>
            t.length > 1 &&
            t[0] == entry.key &&
            wanted.any((w) =>
                w == t[1] ||
                ((entry.key == 'e' || entry.key == 'p') &&
                    w.toLowerCase() == t[1].toLowerCase())));
        if (!hit) return false;
      }
    }
    return true; // search/limit are not local predicates
  }

  bool dumbGroup(List<NostrFilter> filters, NostrEvent e) =>
      filters.any((f) => dumbMatches(f, e));

  // ── Helpers ────────────────────────────────────────────────────────────
  const hexChars = '0123456789abcdef';
  String hex(Random r, int n) =>
      List.generate(n, (_) => hexChars[r.nextInt(16)]).join();

  NostrEvent ev({
    String? id,
    String? pubkey,
    int kind = 1,
    int createdAt = 1000,
    List<List<String>> tags = const [],
  }) =>
      NostrEvent(
        id: id ?? 'a' * 64,
        pubkey: pubkey ?? 'b' * 64,
        createdAt: createdAt,
        kind: kind,
        tags: tags,
        content: 'x',
        sig: 'c' * 128,
      );

  group('compiled filter — pinned NIP-01 semantics', () {
    test('AND inside a filter', () {
      final f = CompiledFilter.from(NostrFilter(
        kinds: [1],
        authors: ['a' * 64],
        since: 100,
        until: 200,
      ));
      expect(f.matches(ev(kind: 1, pubkey: 'a' * 64, createdAt: 150)), isTrue);
      expect(f.matches(ev(kind: 7, pubkey: 'a' * 64, createdAt: 150)), isFalse);
      expect(f.matches(ev(kind: 1, pubkey: 'b' * 64, createdAt: 150)), isFalse);
      expect(f.matches(ev(kind: 1, pubkey: 'a' * 64, createdAt: 99)), isFalse);
      expect(f.matches(ev(kind: 1, pubkey: 'a' * 64, createdAt: 201)), isFalse);
    });

    test('OR across the group', () {
      final g = CompiledFilterGroup([
        NostrFilter(kinds: [4]),
        NostrFilter(kinds: [1059]),
      ]);
      expect(g.matches(ev(kind: 4)), isTrue);
      expect(g.matches(ev(kind: 1059)), isTrue);
      expect(g.matches(ev(kind: 1)), isFalse);
    });

    test('empty list attributes match NOTHING (the old bug)', () {
      // Old EventBus matcher skipped empty tag lists → everything passed.
      final f = CompiledFilter.from(NostrFilter(tagFilters: {'e': []}));
      expect(f.matches(ev(tags: [['e', 'a' * 64]])), isFalse);
      expect(f.isDead, isTrue);
      expect(CompiledFilter.from(NostrFilter(ids: [])).matches(ev()), isFalse);
      expect(CompiledFilter.from(NostrFilter(kinds: [])).matches(ev()), isFalse);
      expect(
        CompiledFilter.from(NostrFilter(authors: [])).matches(ev()),
        isFalse,
      );
    });

    test('since/until are inclusive bounds', () {
      final f = CompiledFilter.from(NostrFilter(since: 100, until: 200));
      expect(f.matches(ev(createdAt: 100)), isTrue);
      expect(f.matches(ev(createdAt: 200)), isTrue);
      expect(f.matches(ev(createdAt: 99)), isFalse);
      expect(f.matches(ev(createdAt: 201)), isFalse);
    });

    test('limit is not a predicate', () {
      final f = CompiledFilter.from(NostrFilter(kinds: [1], limit: 0));
      expect(f.matches(ev(kind: 1)), isTrue); // limit:0 ≠ match nothing locally
    });

    test('search is not a local predicate', () {
      final f = CompiledFilter.from(NostrFilter(search: 'anything'));
      expect(f.matches(ev()), isTrue);
    });

    test('hex constraints: uppercase event id matches lowercase filter', () {
      final id = 'A' * 64; // non-normalized upstream data
      final f = CompiledFilter.from(NostrFilter(ids: ['a' * 64]));
      expect(f.matches(ev(id: id)), isTrue);
    });

    test('garbage hex values are dropped at compile time', () {
      final good = 'aBcDeF${'0' * 58}';
      final f = CompiledFilter.from(NostrFilter(ids: ['nothex', good]));
      expect(f.matches(ev(id: good.toLowerCase())), isTrue);
      expect(f.matches(ev(id: 'f' * 64)), isFalse);
    });

    test('tag matching uses first values; #e is hex-case-insensitive', () {
      final e = ev(tags: [
        ['e', 'F' * 64, 'wss://relay', 'root'],
        ['p', 'b' * 64],
      ]);
      expect(
        CompiledFilter.from(NostrFilter(tagFilters: {'e': ['f' * 64]}))
            .matches(e),
        isTrue,
      );
      expect(
        CompiledFilter.from(NostrFilter(tagFilters: {'p': ['B' * 64]}))
            .matches(e),
        isTrue,
      );
      expect(
        CompiledFilter.from(NostrFilter(tagFilters: {'t': ['nostr']}))
            .matches(e),
        isFalse,
      );
    });

    test('empty filter group matches nothing', () {
      expect(CompiledFilterGroup(const []).matches(ev()), isFalse);
    });

    test('isDead short-circuits unplannable filters', () {
      expect(CompiledFilterGroup([NostrFilter(ids: [])]).isDead, isTrue);
      expect(CompiledFilterGroup([NostrFilter(kinds: [1])]).isDead, isFalse);
    });
  });

  group('oracle fuzz — compiled engine vs dumb reference', () {
    final tagNames = ['e', 'p', 'a', 't', 'd', 'h', 'q'];

    NostrEvent randomEvent(Random r) {
      final tags = <List<String>>[];
      final tagCount = r.nextInt(5);
      for (var i = 0; i < tagCount; i++) {
        final name = tagNames[r.nextInt(tagNames.length)];
        final value = (name == 'e' || name == 'p')
            ? hex(r, 64)
            : 'v${r.nextInt(20)}';
        tags.add([name, value]);
      }
      return ev(
        id: r.nextBool() ? hex(r, 64) : hex(r, 8),
        pubkey: hex(r, 64),
        kind: [0, 1, 3, 6, 7, 9735, 30023][r.nextInt(7)],
        createdAt: 1000 + r.nextInt(100000),
        tags: tags,
      );
    }

    NostrFilter randomFilter(Random r, List<NostrEvent> pool) {
      final f = NostrFilter();
      // Sometimes pick values from the event pool so matches actually happen.
      if (r.nextBool()) {
        f.ids = [
          if (pool.isNotEmpty && r.nextBool())
            pool[r.nextInt(pool.length)].id
          else
            hex(r, 64),
          if (r.nextInt(4) == 0) 'garbage', // non-hex, must never match
        ];
        if (r.nextInt(6) == 0) f.ids = []; // empty-list case
      }
      if (r.nextBool()) {
        f.authors = [
          if (pool.isNotEmpty && r.nextBool())
            pool[r.nextInt(pool.length)].pubkey
          else
            hex(r, 64),
        ];
      }
      if (r.nextBool()) {
        f.kinds = [0, 1, 3, 6, 7, 9735, 30023]
            .where((_) => r.nextBool())
            .toList();
      }
      if (r.nextBool()) f.since = 1000 + r.nextInt(100000);
      if (r.nextBool()) f.until = 1000 + r.nextInt(100000);
      if (r.nextBool()) {
        final name = tagNames[r.nextInt(tagNames.length)];
        final values = <String>[
          if (pool.isNotEmpty && r.nextBool())
            ...pool[r.nextInt(pool.length)]
                .tags
                .where((t) => t.length > 1 && t[0] == name)
                .map((t) => t[1])
          else if (name == 'e' || name == 'p')
            hex(r, 64)
          else
            'v${r.nextInt(20)}',
        ];
        if (r.nextInt(6) == 0) values.clear(); // empty-list case
        f.tagFilters = {name: values};
      }
      return f;
    }

    for (var seed = 0; seed < 5; seed++) {
      test('seed $seed: 500 events × 200 filter groups agree', () {
        final r = Random(seed);
        final events = List.generate(500, (_) => randomEvent(r));
        for (var round = 0; round < 200; round++) {
          final filters = List.generate(
            1 + r.nextInt(4),
            (_) => randomFilter(r, events),
          );
          final compiled = CompiledFilterGroup(filters);
          for (final e in events) {
            expect(
              compiled.matches(e),
              dumbGroup(filters, e),
              reason: 'divergence on event ${e.id} kind=${e.kind} '
                  'tags=${e.tags} with filters '
                  '${filters.map((f) => f.toJson()).toList()}',
            );
          }
        }
      });
    }
  });
}
