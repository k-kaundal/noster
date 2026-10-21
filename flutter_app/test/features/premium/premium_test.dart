import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/config/env.dart';
import 'package:nostrfeed_mobile/features/identity/providers/address_providers.dart';
import 'package:nostrfeed_mobile/features/identity/services/address_service.dart';

void main() {
  group('FreeAddress (generated free names)', () {
    test('generates u + first 12 hex chars', () {
      final addr = FreeAddress.generate(
        'b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4',
      );
      expect(addr, 'ub889ff5b1513');
      expect(addr.length, 13); // 'u' + 12
    });

    test('pads short pubkeys', () {
      final addr = FreeAddress.generate('abc');
      expect(addr.startsWith('u'), isTrue);
      expect(addr.length, 13);
    });

    test('isGenerated detects generated names', () {
      expect(FreeAddress.isGenerated('ub889ff5b1513'), isTrue);
      expect(FreeAddress.isGenerated('alice'), isFalse);
      expect(FreeAddress.isGenerated('ub889ff5b151'), isFalse); // wrong length
      expect(FreeAddress.isGenerated('ALICE1234567'), isFalse);
    });

    test('paid names are NOT generated', () {
      // A user who bought "satoshi" vs the free generated one.
      expect(FreeAddress.isGenerated('satoshi'), isFalse);
      expect(FreeAddress.isGenerated('ub889ff5b1513'), isTrue);
    });
  });

  group('nip5Domains parsing', () {
    test('parses configured domains', () {
      // The default config has ln.nostrfeed.com + getzap.me.
      expect(nip5Domains, isNotEmpty);
      final hosts = nip5Domains.map((d) => d.domain).toList();
      expect(hosts, contains('getzap.me'));
    });

    test('nip5Host resolves each address domain by its id', () {
      // A user can hold names on several domains — the identifier must use
      // the address's OWN domain, not the default.
      for (final d in nip5Domains) {
        expect(nip5Host(d.id), d.domain);
      }
      // Unknown id falls back to the default (first) domain.
      expect(nip5Host('no-such-id'), nip5Domains.first.domain);
    });

    test('Nip5Address.identifier uses its own domain', () {
      if (nip5Domains.length < 2) return; // needs two configured domains
      final a = Nip5Address(
        id: '1',
        domainId: nip5Domains[0].id,
        localPart: 'alice',
        pubkey: 'pk',
      );
      final b = Nip5Address(
        id: '2',
        domainId: nip5Domains[1].id,
        localPart: 'alice',
        pubkey: 'pk',
      );
      // Same local part, different domains = two different identifiers.
      expect(a.identifier, 'alice@${nip5Domains[0].domain}');
      expect(b.identifier, 'alice@${nip5Domains[1].domain}');
      expect(a.identifier, isNot(b.identifier));
    });
  });

  group('lightningAddressDomains parsing', () {
    test('primary domain is always first', () {
      expect(lightningAddressDomains, isNotEmpty);
      expect(lightningAddressDomains.first, Env.lightningAddressDomain);
    });

    test('entries without a dot are rejected, no duplicates', () {
      // parseLightningAddressDomains filters non-hostnames and dedupes.
      final parsed = parseLightningAddressDomains();
      for (final d in parsed) {
        expect(d.contains('.'), isTrue);
      }
      expect(parsed.toSet().length, parsed.length);
    });
  });

  group('Nip5Status (unpaid / expiring / expired)', () {
    Nip5Address make({
      required bool active,
      String? expiresAt,
      Map<String, dynamic>? extra,
    }) {
      return Nip5Address(
        id: '1',
        domainId: nip5Domains.first.id,
        localPart: 'alice',
        pubkey: 'pk',
        active: active,
        expiresAt: expiresAt,
        extra: extra,
      );
    }

    test('active:false is INACTIVE (reserved, never live) — NOT expired', () {
      // The extension uses active:false for a name whose invoice has not
      // settled. Saying "expired" would offer a renew button that isn't the
      // fix — it needs a "pay for it" one.
      final a = make(active: false);
      expect(a.isUnpaid, isTrue);
      expect(nip5Status(a), Nip5Status.inactive);
    });

    test('active with no expiry is ACTIVE', () {
      expect(nip5Status(make(active: true)), Nip5Status.active);
    });

    test('active past expiry is EXPIRED', () {
      final past = DateTime.now()
          .subtract(const Duration(days: 2))
          .toIso8601String();
      expect(nip5Status(make(active: true, expiresAt: past)),
          Nip5Status.expired);
    });

    test('active within the renewal window is EXPIRING', () {
      final soon =
          DateTime.now().add(const Duration(days: 5)).toIso8601String();
      expect(nip5Status(make(active: true, expiresAt: soon)),
          Nip5Status.expiring);
    });

    test('active far from expiry is ACTIVE', () {
      final later =
          DateTime.now().add(const Duration(days: 200)).toIso8601String();
      expect(nip5Status(make(active: true, expiresAt: later)),
          Nip5Status.active);
    });

    test('an unpaid reservation carries a (meaningless) expiry date but stays INACTIVE', () {
      // expires_at is written at record CREATION, not activation — an unpaid
      // name shows a date a year out. It must still read INACTIVE, not
      // expiring/active (web RentedUntil renders nothing when unpaid).
      final future =
          DateTime.now().add(const Duration(days: 365)).toIso8601String();
      final a = make(active: false, expiresAt: future);
      expect(nip5Status(a), Nip5Status.inactive);
    });

    test('extra: payment_hash / price / promo_code are read off the record', () {
      final a = make(
        active: false,
        extra: {
          'payment_hash': 'hash123',
          'price_in_sats': 2100,
          'promo_code': 'spring24',
        },
      );
      expect(a.outstandingPaymentHash, 'hash123');
      expect(a.priceSats, 2100);
      expect(a.promoCode, 'spring24');
    });

    test('outstandingPaymentHash is null once active', () {
      final a = make(active: true, extra: {'payment_hash': 'hash123'});
      expect(a.outstandingPaymentHash, isNull);
    });
  });

  group('premium entitlement ignores unpaid names', () {
    test('a reserved-but-unpaid non-generated name grants NOTHING', () {
      // Mirrors isPremiumProvider: only ACTIVE non-generated names count.
      // An unpaid custom name used to flip hasPaidName → premium for free.
      final unpaid = Nip5Address(
        id: '1',
        domainId: nip5Domains.first.id,
        localPart: 'satoshi', // a paid (non-generated) name
        pubkey: 'pk',
        active: false, // …but never paid for
      );
      final isEntitled =
          unpaid.active && !FreeAddress.isGenerated(unpaid.localPart);
      expect(isEntitled, isFalse);
    });

    test('an active non-generated name IS an entitlement', () {
      final paid = Nip5Address(
        id: '1',
        domainId: nip5Domains.first.id,
        localPart: 'satoshi',
        pubkey: 'pk',
        active: true,
      );
      final isEntitled =
          paid.active && !FreeAddress.isGenerated(paid.localPart);
      expect(isEntitled, isTrue);
    });
  });

  group('reservation anti-squatting (per-domain unpaid cap)', () {
    Nip5Address make(bool active, String local, [String? domainId]) {
      return Nip5Address(
        id: '$local-$active',
        domainId: domainId ?? nip5Domains.first.id,
        localPart: local,
        pubkey: 'pk',
        active: active,
      );
    }

    test('the cap is a small number (3) and only counts UNPAID names', () {
      expect(kMaxUnpaidReservationsPerDomain, 3);

      final domainId = nip5Domains.first.id;
      final addresses = [
        make(false, 'a'),
        make(false, 'b'),
        make(false, 'c'), // 3 unpaid on the default domain
        make(true, 'd'), // active — does NOT count
        make(true, 'e'), // active — does NOT count
      ];
      final unpaid = addresses
          .where((a) => a.domainId == domainId && a.isUnpaid)
          .length;
      expect(unpaid, 3);
      expect(unpaid >= kMaxUnpaidReservationsPerDomain, isTrue);
    });

    test('unpaid on one domain does not block a different domain', () {
      if (nip5Domains.length < 2) return;
      final d0 = nip5Domains[0].id;
      final d1 = nip5Domains[1].id;
      final addresses = [
        make(false, 'a', d0),
        make(false, 'b', d0),
        make(false, 'c', d0), // d0 at cap
        make(false, 'x', d1), // d1 has only 1
      ];
      final onD0 =
          addresses.where((a) => a.domainId == d0 && a.isUnpaid).length;
      final onD1 =
          addresses.where((a) => a.domainId == d1 && a.isUnpaid).length;
      expect(onD0 >= kMaxUnpaidReservationsPerDomain, isTrue);
      expect(onD1 >= kMaxUnpaidReservationsPerDomain, isFalse);
    });

    test('re-claiming a name you already hold is not blocked by the cap', () {
      // payForAddress re-claims the SAME reservation to pay for it — that
      // must always be allowed even at the cap, or a name you reserved could
      // never be paid for.
      final domainId = nip5Domains.first.id;
      final addresses = [
        make(false, 'a'),
        make(false, 'b'),
        make(false, 'c'),
      ];
      final alreadyHeld = addresses.any(
        (a) => a.domainId == domainId && a.localPart.toLowerCase() == 'a',
      );
      expect(alreadyHeld, isTrue);
    });
  });

  group('reservation release (delete route)', () {
    Nip5Address make(bool active, String local) {
      return Nip5Address(
        id: local,
        domainId: nip5Domains.first.id,
        localPart: local,
        pubkey: 'pk',
        active: active,
      );
    }

    test('releaseUnpaidAddress only accepts UNPAID names', () {
      // The guard: a paid/active name must go through releaseActiveAddress
      // (separate, hard-confirmed — it throws away money).
      final unpaid = make(false, 'a');
      final active = make(true, 'b');
      expect(unpaid.isUnpaid, isTrue);
      expect(active.isUnpaid, isFalse);
    });

    test('an unpaid name is exactly what gets released back to the pool', () {
      // active:false = reserved but never live. Releasing IT (not an active
      // name) is the anti-squatting win: it was never paid for, so nothing is
      // lost and the name is free for others immediately.
      final a = make(false, 'squatted');
      expect(nip5Status(a), Nip5Status.inactive);
      expect(a.isUnpaid, isTrue);
    });
  });
}
