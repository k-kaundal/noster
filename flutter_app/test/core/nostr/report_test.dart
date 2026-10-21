import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:nostrfeed_mobile/core/nostr/report_types.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/features/auth/services/auth_service.dart';

void main() {
  group('NIP-56 report types', () {
    test('child safety maps to illegal type', () {
      expect(Nip56ReportType.illegal.type, 'illegal');
      expect(
        Nip56ReportType.illegal.label,
        contains('Child safety'),
      );
    });

    test('all NIP-56 canonical types are present', () {
      final types = Nip56ReportType.values.map((t) => t.type).toSet();
      expect(
        types,
        containsAll([
          'illegal',
          'nudity',
          'malware',
          'profanity',
          'spam',
          'impersonation',
          'other',
        ]),
      );
    });
  });

  group('createReport (kind 1984)', () {
    test('report on a post includes e + p tags with the report type', () {
      SharedPreferences.setMockInitialValues({});
      final c = ProviderContainer();
      addTearDown(c.dispose);
      // Log in with a generated key so signing works.
      final auth = AuthService();
      final kp = auth.generateEphemeralKeypair();
      c.read(authStateProvider.notifier).state = AuthState(
        pubkey: kp.pub,
        privateKey: kp.priv,
        isLoggedIn: true,
      );
      final nostr = c.read(nostrServiceProvider);
      nostr.setAuth(c.read(authStateProvider));

      final report = nostr.createReport(
        eventId: 'event123',
        pubkey: 'badactor456',
        reportType: Nip56ReportType.illegal.type,
        reason: '[illegal] test report',
      );

      expect(report.kind, 1984);
      // e tag with type as 3rd positional (per NIP-56).
      final eTags = report.tags.where((t) => t[0] == 'e').toList();
      expect(eTags, hasLength(1));
      expect(eTags.first[1], 'event123');
      expect(eTags.first[3], 'illegal');
      // p tag with type as 3rd positional.
      final pTags = report.tags.where((t) => t[0] == 'p').toList();
      expect(pTags, hasLength(1));
      expect(pTags.first[1], 'badactor456');
      expect(pTags.first[2], 'illegal');
      expect(report.content, contains('test report'));
    });

    test('profile-only report has p tag, no e tag', () {
      SharedPreferences.setMockInitialValues({});
      final c = ProviderContainer();
      addTearDown(c.dispose);
      final auth = AuthService();
      final kp = auth.generateEphemeralKeypair();
      c.read(authStateProvider.notifier).state = AuthState(
        pubkey: kp.pub,
        privateKey: kp.priv,
        isLoggedIn: true,
      );
      final nostr = c.read(nostrServiceProvider);
      nostr.setAuth(c.read(authStateProvider));

      final report = nostr.createReport(
        pubkey: 'spammer999',
        reportType: Nip56ReportType.spam.type,
      );

      expect(report.kind, 1984);
      expect(report.tags.where((t) => t[0] == 'p'), hasLength(1));
      expect(report.tags.where((t) => t[0] == 'e'), isEmpty);
    });

    test('signing fails when logged out', () {
      final c = ProviderContainer();
      addTearDown(c.dispose);
      final nostr = c.read(nostrServiceProvider);
      expect(
        () => nostr.createReport(
          pubkey: 'x',
          reportType: Nip56ReportType.illegal.type,
        ),
        throwsA(isA<StateError>()),
      );
    });
  });
}
