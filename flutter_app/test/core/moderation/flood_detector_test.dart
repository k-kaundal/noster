import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/moderation/flood_detector.dart';

NostrEvent ev(String pk, String content, int createdAt) => NostrEvent(
      id: '$pk$content$createdAt'.padRight(16, '0').substring(0, 16),
      pubkey: pk,
      createdAt: createdAt,
      kind: 1,
      tags: const [],
      content: content,
      sig: 's',
    );

void main() {
  final now = 1700000000;

  group('author flood (same author, same content, in window)', () {
    test('3+ identical posts by one author trips flood', () {
      final d = FloodDetector();
      final e1 = ev('alice', 'join my call now!', now);
      d.observe(e1, nowSeconds: now);
      expect(d.verdictFor(e1, nowSeconds: now), FloodVerdict.clean);

      final e2 = ev('alice', 'join my call now!', now + 10);
      d.observe(e2, nowSeconds: now);
      expect(d.verdictFor(e2, nowSeconds: now), FloodVerdict.clean);

      final e3 = ev('alice', 'join my call now!', now + 20);
      d.observe(e3, nowSeconds: now);
      expect(d.verdictFor(e3, nowSeconds: now), FloodVerdict.authorFlood);
    });

    test('near-duplicates (casing/space/punct) cluster as the same', () {
      final d = FloodDetector();
      final a = ev('bob', 'Join my call NOW!', now);
      final b = ev('bob', 'join  my  call now', now + 5);
      final c = ev('bob', 'JOIN MY CALL NOW!!!', now + 9);
      for (final e in [a, b, c]) {
        d.observe(e, nowSeconds: now);
      }
      expect(d.verdictFor(c, nowSeconds: now), FloodVerdict.authorFlood);
    });

    test('old posts outside the window do not count', () {
      final d = FloodDetector(window: const Duration(minutes: 10));
      final old = ev('carol', 'same thing', now - 4000);
      d.observe(old, nowSeconds: now);
      final e1 = ev('carol', 'same thing', now);
      d.observe(e1, nowSeconds: now);
      // Only 2 in-window → clean.
      expect(d.verdictFor(e1, nowSeconds: now), FloodVerdict.clean);
    });
  });

  group('spray (same content, many distinct authors)', () {
    test('4+ distinct authors posting the same text trips spray', () {
      final d = FloodDetector(sprayThreshold: 4);
      const spam = 'cheap sats here bala://offer/xyz';
      for (final pk in ['u1', 'u2', 'u3', 'u4']) {
        final e = ev(pk, spam, now);
        d.observe(e, nowSeconds: now);
      }
      final last = ev('u4', spam, now);
      expect(d.verdictFor(last, nowSeconds: now), FloodVerdict.spray);
    });

    test('below the spray threshold stays clean', () {
      final d = FloodDetector(sprayThreshold: 5);
      const text = 'a normal shared meme';
      for (final pk in ['u1', 'u2', 'u3']) {
        d.observe(ev(pk, text, now), nowSeconds: now);
      }
      expect(
        d.verdictFor(ev('u3', text, now), nowSeconds: now),
        FloodVerdict.clean,
      );
    });
  });

  group('rapid-fire (one author, any content, too fast)', () {
    test('8+ posts by one author in the burst window trips rapid-fire', () {
      final d = FloodDetector(rateThreshold: 8);
      for (var i = 0; i < 8; i++) {
        d.observe(ev('spammer', 'message $i', now + i), nowSeconds: now);
      }
      expect(
        d.verdictFor(ev('spammer', 'message 7', now + 7), nowSeconds: now),
        FloodVerdict.rapidFire,
      );
    });

    test('a normal posting cadence stays clean', () {
      final d = FloodDetector(rateThreshold: 8);
      d.observe(ev('human', 'gm', now), nowSeconds: now);
      d.observe(ev('human', 'nice weather', now + 100), nowSeconds: now);
      expect(
        d.verdictFor(ev('human', 'nice weather', now + 100), nowSeconds: now),
        FloodVerdict.clean,
      );
    });
  });

  group('legit content is never flagged', () {
    test('distinct normal posts by many users all pass', () {
      final d = FloodDetector();
      final posts = [
        ev('a', 'good morning nostr', now),
        ev('b', 'just shipped a thing', now + 1),
        ev('c', 'bitcoin is interesting', now + 2),
        ev('a', 'coffee time', now + 3),
        ev('d', 'these are different posts', now + 4),
      ];
      for (final e in posts) {
        d.observe(e, nowSeconds: now);
        expect(d.verdictFor(e, nowSeconds: now), FloodVerdict.clean);
      }
    });

    test('non-kind-1 events are always clean', () {
      final d = FloodDetector();
      final e = NostrEvent(
        id: 'x' * 16,
        pubkey: 'p',
        createdAt: now,
        kind: 20, // picture post — not flood-judged
        tags: const [],
        content: 'same same same',
        sig: 's',
      );
      d.observe(e, nowSeconds: now);
      expect(d.verdictFor(e, nowSeconds: now), FloodVerdict.clean);
    });
  });
}
