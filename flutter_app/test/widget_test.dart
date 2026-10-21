import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:nostrfeed_mobile/core/theme/app_theme.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';

void main() {
  test('AppTheme has light and dark themes', () {
    expect(AppTheme.lightTheme.useMaterial3, isTrue);
    expect(AppTheme.darkTheme.useMaterial3, isTrue);
  });

  test('NostrEvent can be created and serialized', () {
    const event = NostrEvent(
      id: 'test123',
      pubkey: 'abc123',
      createdAt: 1700000000,
      kind: 1,
      tags: [
        ['t', 'nostr']
      ],
      content: 'Hello Nostr!',
      sig: 'sig123',
    );

    expect(event.id, 'test123');
    expect(event.kind, 1);
    expect(event.content, 'Hello Nostr!');
    expect(event.getTag('t'), 'nostr');
    expect(event.hashtags, ['nostr']);

    final json = event.toJson();
    final restored = NostrEvent.fromJson(json);
    expect(restored.id, event.id);
    expect(restored.content, event.content);
  });

  test('NostrProfile displayName fallback works', () {
    const profile = NostrProfile(name: 'alice');
    expect(profile.displayNameOrName, 'alice');

    const profile2 = NostrProfile(displayName: 'Alice Wonder', name: 'alice');
    expect(profile2.displayNameOrName, 'Alice Wonder');

    const empty = NostrProfile();
    expect(empty.displayNameOrName, 'Anonymous');
  });

  test('NostrProfile.fromJson sanitizes nip05/lud16/picture (UTF-16 crash)',
      () {
    // Relay data can carry lone UTF-16 surrogates. The profile handle renders
    // `nip05` in a Text widget and picture/banner reach HTTP image headers —
    // unsanitized, both crash ("string is not well-formed UTF-16"). This is
    // the regression test for that crash.
    const lone = '\uD83D'; // a lone high surrogate
    final profile = NostrProfile.fromJson({
      'name': 'ali${lone}ce',
      'nip05': 'alice${lone}@example.com',
      'lud16': 'alice${lone}@wallet.com',
      'picture': 'https://x.com/${lone}a.png',
      'banner': 'https://x.com/b.png$lone',
      'lud06': 'lnurl1${lone}x',
    });

    bool wellFormed(String s) {
      final units = s.codeUnits;
      for (var i = 0; i < units.length; i++) {
        final u = units[i];
        if (u >= 0xD800 && u <= 0xDBFF) {
          if (i + 1 >= units.length ||
              units[i + 1] < 0xDC00 ||
              units[i + 1] > 0xDFFF) {
            return false;
          }
          i++;
        } else if (u >= 0xDC00 && u <= 0xDFFF) {
          return false;
        }
      }
      return true;
    }

    expect(wellFormed(profile.nip05!), isTrue);
    expect(wellFormed(profile.lud16!), isTrue);
    expect(wellFormed(profile.picture!), isTrue);
    expect(wellFormed(profile.banner!), isTrue);
    expect(wellFormed(profile.lud06!), isTrue);
    // The lone surrogate is dropped, not replaced.
    expect(profile.nip05, 'alice@example.com');
  });

  test('NostrFilter serializes correctly', () {
    final filter = NostrFilter(
      kinds: [1, 7],
      authors: ['abc'],
      limit: 10,
      search: 'test',
      tagFilters: {
        't': ['nostr']
      },
    );

    final json = filter.toJson();
    expect(json['kinds'], [1, 7]);
    expect(json['authors'], ['abc']);
    expect(json['limit'], 10);
    expect(json['search'], 'test');
    expect(json['#t'], ['nostr']);
  });

  testWidgets('Material app builds with theme', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.lightTheme,
        home: const Scaffold(body: Text('NostrFeed')),
      ),
    );
    expect(find.text('NostrFeed'), findsOneWidget);
  });
}
