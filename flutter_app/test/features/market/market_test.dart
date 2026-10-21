import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/features/auth/services/auth_service.dart';
import 'package:nostrfeed_mobile/features/market/models/listing.dart';
import 'package:nostrfeed_mobile/features/p2p/models/p2p_order.dart';

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
  group('Listing (NIP-99 kind 30402)', () {
    NostrEvent listingEvent() => NostrEvent(
          id: 'l1',
          pubkey: 'seller',
          createdAt: 1000,
          kind: 30402,
          content: 'A great guitar in mint condition.',
          tags: [
            ['d', 'guitar-1'],
            ['title', 'Vintage Guitar'],
            ['summary', 'Beautiful vintage guitar'],
            ['published_at', '1000'],
            ['location', 'Austin, TX'],
            ['price', '500', 'USD'],
            ['image', 'https://x.com/g.jpg'],
            ['status', 'active'],
            ['t', 'music'],
          ],
          sig: 'sig',
        );

    test('parses all fields incl. price + status', () {
      final l = Listing.fromEvent(listingEvent());
      expect(l.title, 'Vintage Guitar');
      expect(l.summary, 'Beautiful vintage guitar');
      expect(l.location, 'Austin, TX');
      expect(l.price!.amount, '500');
      expect(l.price!.currency, 'USD');
      expect(l.price!.display, '500 USD');
      expect(l.status, 'active');
      expect(l.isActive, isTrue);
      expect(l.coordinate, '30402:seller:guitar-1');
    });

    test('kind 30403 without a status tag → draft status', () {
      final e = listingEvent();
      // 30403 draft with NO explicit status tag → defaults to draft.
      final draft = Listing.fromEvent(NostrEvent(
        id: e.id,
        pubkey: e.pubkey,
        createdAt: e.createdAt,
        kind: 30403,
        content: e.content,
        tags: const [
          ['d', 'guitar-1'],
          ['title', 'Vintage Guitar'],
        ],
        sig: e.sig,
      ));
      expect(draft.status, 'draft');
      expect(draft.isActive, isFalse);
    });

    test('SAT price shows "sats"', () {
      final e = listingEvent();
      final satListing = Listing.fromEvent(NostrEvent(
        id: e.id,
        pubkey: e.pubkey,
        createdAt: e.createdAt,
        kind: 30402,
        content: e.content,
        tags: [
          ['d', 'x'],
          ['title', 'T'],
          ['price', '21000', 'SAT'],
        ],
        sig: e.sig,
      ));
      expect(satListing.price!.display, '21000 sats');
    });
  });

  group('createListing event shape', () {
    test('has d, title, summary, published_at, price, status tags', () {
      final c = _makeContainer();
      addTearDown(c.dispose);
      final nostr = c.read(nostrServiceProvider);

      final e = nostr.createListing(
        dTag: 'item-1',
        title: 'Item',
        description: 'For sale',
        summary: 'Short',
        location: 'NYC',
        priceAmount: '100',
        priceCurrency: 'USD',
        hashtags: ['test'],
      );

      expect(e.kind, 30402);
      expect(e.getTag('d'), 'item-1');
      expect(e.getTag('title'), 'Item');
      expect(e.getTag('summary'), 'Short');
      expect(e.getTag('published_at'), isNotNull);
      expect(e.getTag('location'), 'NYC');
      final priceTags = e.tags.where((t) => t[0] == 'price').toList();
      expect(priceTags.first.sublist(1), containsAll(['100', 'USD']));
      expect(e.getTag('status'), 'active');
      expect(e.getTags('t'), contains('test'));
    });
  });

  group('P2POrder (NIP-69 kind 38383)', () {
    NostrEvent orderEvent({String type = 'sell'}) => NostrEvent(
          id: 'o1',
          pubkey: 'maker',
          createdAt: 1000,
          kind: 38383,
          content: '',
          tags: [
            ['d', 'order-1'],
            ['k', type],
            ['f', 'usd'],
            ['s', 'pending'],
            ['amt', '0'],
            ['fa', '100'],
            ['pm', 'bank transfer'],
            ['pm', 'face to face'],
            ['premium', '1'],
            ['network', 'mainnet'],
            ['layer', 'lightning'],
            ['name', 'Nakamoto'],
          ],
          sig: 'sig',
        );

    test('parses all fields', () {
      final o = P2POrder.fromEvent(orderEvent());
      expect(o.type, 'sell');
      expect(o.isSell, isTrue);
      expect(o.currency, 'usd');
      expect(o.status, 'pending');
      expect(o.isOpen, isTrue);
      expect(o.fiatAmount, '100');
      expect(o.paymentMethods, ['bank transfer', 'face to face']);
      expect(o.premium, '1');
      expect(o.makerName, 'Nakamoto');
      expect(o.amountDisplay, '100 USD');
    });

    test('buy order', () {
      final o = P2POrder.fromEvent(orderEvent(type: 'buy'));
      expect(o.isBuy, isTrue);
      expect(o.typeLabel, 'BUY');
    });

    test('createP2POrder event shape', () {
      final c = _makeContainer();
      addTearDown(c.dispose);
      final nostr = c.read(nostrServiceProvider);

      final e = nostr.createP2POrder(
        type: 'sell',
        currency: 'USD',
        fiatAmount: '100',
        paymentMethods: ['bank transfer'],
        premium: '1',
        makerName: 'Test',
      );

      expect(e.kind, 38383);
      expect(e.getTag('k'), 'sell');
      expect(e.getTag('f'), 'usd');
      expect(e.getTag('s'), 'pending');
      expect(e.getTag('fa'), '100');
      expect(e.getTag('premium'), '1');
      expect(e.getTag('network'), 'mainnet');
      expect(e.getTag('layer'), 'lightning');
      expect(e.getTag('name'), 'Test');
      expect(e.getTag('y'), 'nostrfeed');
    });
  });
}
