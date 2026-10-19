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
      tags: [['t', 'nostr']],
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

  test('NostrFilter serializes correctly', () {
    final filter = NostrFilter(
      kinds: [1, 7],
      authors: ['abc'],
      limit: 10,
      search: 'test',
      tagFilters: {'t': ['nostr']},
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
