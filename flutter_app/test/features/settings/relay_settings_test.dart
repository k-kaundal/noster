import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/features/settings/application/relay_settings_providers.dart';

void main() {
  group('ManagedRelay', () {
    test('round-trips through JSON', () {
      const r = ManagedRelay('wss://a.example', read: true, write: false);
      final decoded = ManagedRelay.fromJson(r.toJson());
      expect(decoded.url, r.url);
      expect(decoded.read, isTrue);
      expect(decoded.write, isFalse);
    });

    test('defaults to read+write', () {
      final r = ManagedRelay.fromJson({'url': 'wss://b.example'});
      expect(r.read, isTrue);
      expect(r.write, isTrue);
    });

    test('copyWith changes only the named intent', () {
      const r = ManagedRelay('wss://a.example');
      final readOnly = r.copyWith(write: false);
      expect(readOnly.read, isTrue);
      expect(readOnly.write, isFalse);
    });
  });

  group('NIP-65 read/write marker shape', () {
    // The kind 10002 tag shape: bare = both, 'read'/'write' markers for one.
    List<List<String>> tagsFor(List<ManagedRelay> relays) => [
          for (final r in relays)
            if (r.read && r.write)
              ['r', r.url]
            else if (r.read)
              ['r', r.url, 'read']
            else if (r.write)
              ['r', r.url, 'write'],
        ];

    test('a relay doing both carries no marker', () {
      expect(tagsFor([const ManagedRelay('wss://a')]), [
        ['r', 'wss://a'],
      ]);
    });

    test('read-only and write-only carry markers', () {
      expect(
        tagsFor([
          const ManagedRelay('wss://read', write: false),
          const ManagedRelay('wss://write', read: false),
        ]),
        [
          ['r', 'wss://read', 'read'],
          ['r', 'wss://write', 'write'],
        ],
      );
    });
  });
}
