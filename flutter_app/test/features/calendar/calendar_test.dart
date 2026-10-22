import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/features/auth/data/auth_service.dart';

ProviderContainer _makeContainer() {
  SharedPreferences.setMockInitialValues({});
  final c = ProviderContainer();
  final auth = AuthService();
  final kp = auth.generateEphemeralKeypair();
  c.read(authStateProvider.notifier).state = AuthState(
    pubkey: kp.pub,
    privateKey: kp.priv,
    isLoggedIn: true,
  );
  final nostr = c.read(nostrServiceProvider);
  nostr.setAuth(c.read(authStateProvider));
  return c;
}

void main() {
  group('createCalendarEvent (NIP-52 kind 31923)', () {
    test('has d, title, start, D tags', () {
      final c = _makeContainer();
      addTearDown(c.dispose);
      final nostr = c.read(nostrServiceProvider);

      final event = nostr.createCalendarEvent(
        title: 'Nostr Meetup',
        start: 1735689600, // 2025-01-01 00:00 UTC
        location: 'Berlin',
        hashtags: ['nostr', 'meetup'],
      );

      expect(event.kind, 31923);
      expect(event.getTag('d'), isNotNull);
      expect(event.getTag('title'), 'Nostr Meetup');
      expect(event.getTag('start'), '1735689600');
      expect(event.getTag('location'), 'Berlin');
      // D tag = day-granularity timestamp (start of day).
      expect(event.getTag('D'), '${(1735689600 ~/ 86400) * 86400}');
      expect(event.getTags('t'), containsAll(['nostr', 'meetup']));
    });

    test('end tag included only when provided', () {
      final c = _makeContainer();
      addTearDown(c.dispose);
      final nostr = c.read(nostrServiceProvider);

      final withEnd = nostr.createCalendarEvent(
        title: 'T',
        start: 1000,
        end: 2000,
      );
      expect(withEnd.getTag('end'), '2000');

      final noEnd = nostr.createCalendarEvent(title: 'T', start: 1000);
      expect(noEnd.getTag('end'), isNull);
    });
  });

  group('createCalendarRsvp (NIP-52 kind 31925)', () {
    NostrEvent calendarEvent(String pubkey) => NostrEvent(
          id: 'calev1',
          pubkey: pubkey,
          createdAt: 1000,
          kind: 31923,
          content: '',
          tags: [
            ['d', 'meetup-1'],
            ['title', 'Meetup'],
          ],
          sig: 'sig',
        );

    test('has a, e, d, status, p tags per NIP-52', () {
      final c = _makeContainer();
      addTearDown(c.dispose);
      final nostr = c.read(nostrServiceProvider);
      final organizer = 'organizerpubkey123';

      final rsvp = nostr.createCalendarRsvp(
        calendarEvent: calendarEvent(organizer),
        status: 'accepted',
      );

      expect(rsvp.kind, 31925);
      // a tag = coordinate kind:pubkey:d
      expect(rsvp.getTag('a'), '31923:$organizer:meetup-1');
      // e tag = event id
      expect(rsvp.getTag('e'), 'calev1');
      // d tag present
      expect(rsvp.getTag('d'), isNotNull);
      // status
      expect(rsvp.getTag('status'), 'accepted');
      // p tag = organizer (so they get notified)
      final pTags = rsvp.tags.where((t) => t[0] == 'p').toList();
      expect(pTags.any((t) => t[1] == organizer), isTrue);
    });

    test('supports all three statuses', () {
      final c = _makeContainer();
      addTearDown(c.dispose);
      final nostr = c.read(nostrServiceProvider);
      final ev = calendarEvent('org');

      for (final status in ['accepted', 'tentative', 'declined']) {
        final rsvp = nostr.createCalendarRsvp(
          calendarEvent: ev,
          status: status,
        );
        expect(rsvp.getTag('status'), status);
      }
    });
  });
}
