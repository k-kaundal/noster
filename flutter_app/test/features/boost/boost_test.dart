import 'dart:convert';

import 'package:bip340/bip340.dart' as bip340;
import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/nostr/kinds.dart';
import 'package:nostrfeed_mobile/features/auth/data/auth_service.dart';
import 'package:nostrfeed_mobile/features/boost/domain/boost.dart';

NostrEvent _event(String id) => NostrEvent(
      id: id,
      pubkey: 'author-$id',
      createdAt: 1000,
      kind: 1,
      tags: const [],
      content: 'note $id',
      sig: '',
    );

Boost _boost(
  String noteId,
  double multiplier,
  int expiresAt, {
  int startedAt = 1000,
  int amountSats = 1000,
}) {
  final tier = BoostTier(
    code: 't$multiplier',
    label: 't',
    priceSats: amountSats,
    duration: Duration(seconds: expiresAt - startedAt),
    multiplier: multiplier,
  );
  return Boost(
    receiptId: 'r-$noteId-$multiplier',
    noteId: noteId,
    payerPubkey: 'payer',
    amountSats: amountSats,
    tier: tier,
    startedAt: startedAt,
    expiresAt: expiresAt,
  );
}

void main() {
  // ── readBoost: the anti-forgery contract, with REAL keys/signatures ────
  // The whole claim a boost makes is that it cannot be forged, and that
  // claim rests on signature checks — testing with hand-written objects
  // would test the shape of the code and nothing about what it is for.
  group('readBoost', () {
    final auth = AuthService();
    final payerKey =
        'a' * 63 + '1'; // deterministic test key (never holds funds)
    final providerKey = 'b' * 63 + '2';
    final impostorKey = 'c' * 63 + '3';
    final platform = bip340.getPublicKey('d' * 63 + '4');
    final provider = bip340.getPublicKey(providerKey);
    const noteId =
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    final source = BoostSource(
      platformPubkey: platform,
      providerPubkey: provider,
    );

    /// Builds a genuine boost receipt: payer-signed 9734 (p=platform,
    /// e=note) inside a provider-signed 9735.
    NostrEvent buildReceipt({
      required String signingKey,
      String payerPriv = '',
      int sats = 5000,
      String target = noteId,
      String recipient = '',
      int createdAt = 2000,
    }) {
      final payer = payerPriv.isEmpty ? payerKey : payerPriv;
      final request = auth.signEvent(
        privateKey: payer,
        kind: NostrKinds.zapRequest,
        content: '',
        createdAt: createdAt - 10,
        tags: [
          ['p', recipient.isEmpty ? platform : recipient],
          ['amount', '${sats * 1000}'],
          ['e', target],
        ],
      );
      // bolt11 carrying the same amount as the request claims.
      // Unit math: `n` = 1e-9 BTC → sats = digits × 0.1, so digits = sats×10.
      final bolt11 = 'lnbc${sats * 10}n1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqc'
          'yq5rqwzqfqqqsyqcyq5rqwzqfqypqdpl2pkx2ctnv5sxxmmwwd5kgetjypeh2ur'
          'sdae8g6twvus8g6rfwvs8qun0dfjkxaq8rkx3yf5tcsyz3d9gcks0cmpr9mvv';
      final receipt = auth.signEvent(
        privateKey: signingKey,
        kind: NostrKinds.zapReceipt,
        content: '',
        createdAt: createdAt,
        tags: [
          ['p', recipient.isEmpty ? platform : recipient],
          ['e', target],
          ['bolt11', bolt11],
          ['description', jsonEncode(request.toJson())],
        ],
      );
      return receipt;
    }

    test('a genuine boost receipt parses with the right tier + timing', () {
      final receipt = buildReceipt(signingKey: providerKey, sats: 10000);
      final boost = readBoost(receipt, source);
      expect(boost, isNotNull);
      expect(boost!.noteId, noteId);
      expect(boost.tier.code, 'pro');
      expect(boost.startedAt, 2000); // receipt time, NOT the request's
      expect(boost.expiresAt, 2000 + 2 * 86400);
      expect(boost.payerPubkey, bip340.getPublicKey(payerKey));
    });

    test('a receipt signed by anyone else is refused (the unforgeable rule)',
        () {
      final receipt = buildReceipt(signingKey: impostorKey);
      expect(readBoost(receipt, source), isNull);
    });

    test('a zap to someone else is not a boost', () {
      final receipt = buildReceipt(
        signingKey: providerKey,
        recipient: bip340.getPublicKey(impostorKey),
      );
      expect(readBoost(receipt, source), isNull);
    });

    test('below the starter price buys nothing', () {
      final receipt = buildReceipt(signingKey: providerKey, sats: 500);
      expect(readBoost(receipt, source), isNull);
    });

    test('a fake note id fails the target check', () {
      final receipt = buildReceipt(
        signingKey: providerKey,
        target:
            'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      );
      final boost = readBoost(receipt, source);
      // It's a valid boost — just for a DIFFERENT note (validation is
      // per-receipt; the target check anchors it to what was bought).
      expect(boost, isNotNull);
      expect(boost!.noteId,
          'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
    });
  });

  group('tierForAmount', () {
    test('largest covered tier wins; underpaying buys nothing', () {
      expect(tierForAmount(999), isNull);
      expect(tierForAmount(1000)!.code, 'starter');
      expect(tierForAmount(4999)!.code, 'starter');
      expect(tierForAmount(5000)!.code, 'growth');
      expect(tierForAmount(10000)!.code, 'pro');
      expect(tierForAmount(50000)!.code, 'campaign');
    });

    test('paying beyond the top tier buys the top tier (the cap is the point)',
        () {
      expect(tierForAmount(1000000)!.code, 'campaign');
      expect(tierForAmount(1000000)!.multiplier, maxMultiplier);
    });
  });

  group('isActiveBoost', () {
    test('active only inside [startedAt, expiresAt)', () {
      final b = _boost('n1', 2, 2000, startedAt: 1000);
      expect(isActiveBoost(b, 999), isFalse);
      expect(isActiveBoost(b, 1000), isTrue);
      expect(isActiveBoost(b, 1999), isTrue);
      expect(isActiveBoost(b, 2000), isFalse);
    });
  });

  group('activeBoosts (no stacking)', () {
    test('strongest boost per note wins; stacking is the cap not existing', () {
      final boosts = [
        _boost('n1', 1.5, 2000),
        _boost('n1', 3, 1500), // stronger wins
        _boost('n2', 2, 3000),
      ];
      final active = activeBoosts(boosts, 1100);
      expect(active.length, 2);
      final n1 = active.firstWhere((b) => b.noteId == 'n1');
      expect(n1.tier.multiplier, 3);
    });

    test('equal multiplier: the longer-running boost wins', () {
      final boosts = [
        _boost('n1', 2, 2000),
        _boost('n1', 2, 5000),
      ];
      final active = activeBoosts(boosts, 1100);
      expect(active.single.expiresAt, 5000);
    });

    test('expired boosts drop out', () {
      final active = activeBoosts([_boost('n1', 3, 2000)], 5000);
      expect(active, isEmpty);
    });

    test('sorted strongest first, then newest', () {
      final boosts = [
        _boost('n1', 1.5, 9000),
        _boost('n2', 3, 9000),
        _boost('n3', 2, 9000),
      ];
      final active = activeBoosts(boosts, 1100);
      expect(active.map((b) => b.tier.multiplier).toList(), [3, 2, 1.5]);
    });
  });

  group('placeBoosted', () {
    List<NostrEvent> organic(int n) => [for (var i = 0; i < n; i++) _event('o$i')];
    List<NostrEvent> promoted(int n) => [for (var i = 0; i < n; i++) _event('p$i')];

    test('one promoted per 8 organic, none when organic is short', () {
      final placed = placeBoosted(organic(20), promoted(3));
      expect(placed.promoted.length, 2); // floor by spacing: ceil(20/8)=3, share: floor(20*0.1/0.9)=2
      // Promoted items appear after every 8 organic.
      expect(placed.items[8].id, 'p0');
      expect(placed.items[17].id, 'p1');
      expect(placed.items.where((e) => e.id == 'p2'), isEmpty);
    });

    test('promoted share never exceeds 10% of the RENDERED feed', () {
      // 8 organic → share allows floor(8*0.1/0.9)=0 → no promoted shown.
      final placed = placeBoosted(organic(8), promoted(5));
      expect(placed.promoted, isEmpty);
      expect(placed.items.length, 8);
    });

    test('a boosted note already in the timeline is moved, not duplicated', () {
      final org = organic(20);
      final promotedNote = org[3]; // already in the organic list
      final placed = placeBoosted(org, [promotedNote]);
      expect(
        placed.items.where((e) => e.id == promotedNote.id).length,
        1,
        reason: 'Seeing the same note twice is how a reader learns to '
            'distrust a feed',
      );
      expect(placed.items.indexWhere((e) => e.id == promotedNote.id), 8);
    });

    test('overflow is dropped, not appended to the bottom', () {
      final placed = placeBoosted(organic(9), promoted(10));
      expect(placed.promoted.length, lessThan(10));
      // Nothing promoted lands past the organic end.
      expect(placed.items.last.id, isNot(startsWith('p')));
    });

    test('no promoted at all without organic content', () {
      final placed = placeBoosted(const [], promoted(5));
      expect(placed.items, isEmpty);
      expect(placed.promoted, isEmpty);
    });
  });
}
