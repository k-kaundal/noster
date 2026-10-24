import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/features/ai/domain/ai_credits.dart';
import 'package:nostrfeed_mobile/features/ai/domain/ai_gateway.dart';
import 'package:nostrfeed_mobile/features/ai/domain/ai_models.dart';

void main() {
  group('AiCreditsLedger', () {
    test('credit adds to balance and totalPurchased', () {
      const ledger = AiCreditsLedger();
      final next = ledger.credit(1000);
      expect(next.balance, 1000);
      expect(next.totalPurchased, 1000);
      expect(next.totalSpent, 0);
    });

    test('debit subtracts and tracks totalSpent', () {
      final ledger = const AiCreditsLedger().credit(1000).debit(300);
      expect(ledger.balance, 700);
      expect(ledger.totalSpent, 300);
      expect(ledger.totalPurchased, 1000);
    });

    test('debit throws on insufficient balance', () {
      final ledger = const AiCreditsLedger().credit(100);
      expect(
        () => ledger.debit(101),
        throwsA(isA<InsufficientAiCredits>()),
      );
      expect(ledger.canAfford(100), isTrue);
      expect(ledger.canAfford(101), isFalse);
    });

    test('serialization round-trips', () {
      final ledger = const AiCreditsLedger().credit(5000).debit(1200);
      final restored = AiCreditsLedger.fromJson(ledger.toJson());
      expect(restored.balance, ledger.balance);
      expect(restored.totalPurchased, ledger.totalPurchased);
      expect(restored.totalSpent, ledger.totalSpent);
    });

    test('tampered json restores as zeroed ledger', () {
      final ledger = const AiCreditsLedger().credit(5000);
      final json = ledger.toJson()..['balance'] = 999999;
      final restored = AiCreditsLedger.fromJson(json);
      expect(restored.balance, 0);
    });

    test('updatedAt round-trips and stamps mutations', () {
      final ledger = const AiCreditsLedger().credit(1000);
      expect(ledger.updatedAt, greaterThan(0));
      final restored = AiCreditsLedger.fromJson(ledger.toJson());
      expect(restored.updatedAt, ledger.updatedAt);
    });

    test('legacy json without updatedAt deserializes (stamp 0)', () {
      // A payload written before updatedAt existed: the field defaults to 0
      // and the checksum (computed over updatedAt=0) still validates.
      final legacy = {
        'balance': 500,
        'totalPurchased': 500,
        'totalSpent': 0,
        'checksum': const AiCreditsLedger(
          balance: 500,
          totalPurchased: 500,
        ).checksum,
      };
      final restored = AiCreditsLedger.fromJson(legacy);
      expect(restored.balance, 500);
      expect(restored.updatedAt, 0);
    });

    test('a pre-updatedAt (4-field checksum) ledger survives the upgrade', () {
      // Ledgers persisted by an OLD build carry a checksum over only
      // balance|purchased|spent. Reading it with the new 5-field checksum
      // would call it "tampered" and zero the balance — the upgrade bug.
      String legacyChecksum(int b, int p, int s) {
        const salt = 'nf-ai-credits-v1';
        final raw = '$salt|$b|$p|$s';
        var hash = 0x811c9dc5;
        for (final unit in raw.codeUnits) {
          hash ^= unit;
          hash = (hash * 0x01000193) & 0xffffffff;
        }
        return hash.toRadixString(16);
      }

      final oldPayload = {
        'balance': 700,
        'totalPurchased': 1000,
        'totalSpent': 300,
        'checksum': legacyChecksum(700, 1000, 300),
      };
      final restored = AiCreditsLedger.fromJson(oldPayload);
      expect(restored.balance, 700);
      expect(restored.totalPurchased, 1000);
      expect(restored.totalSpent, 300);
      expect(restored.updatedAt, 0);
    });

    group('mergeWith (relay backup union)', () {
      test('a fresh device adopts the remote purchases', () {
        final local = const AiCreditsLedger();
        final remote = const AiCreditsLedger().credit(22000).debit(300);
        final merged = local.mergeWith(remote);
        expect(merged.totalPurchased, 22000);
        expect(merged.totalSpent, 300);
        expect(merged.balance, 21700);
      });

      test('balance is derived, never max — a remote spend is honored', () {
        // Two devices both bought 1000; device A spent 400 (balance 600).
        // Merging must NOT take the higher balance (1000) — the 400 spend
        // counts on both.
        final a = const AiCreditsLedger().credit(1000).debit(400);
        final b = const AiCreditsLedger().credit(1000);
        final merged = a.mergeWith(b);
        expect(merged.totalPurchased, 1000);
        expect(merged.totalSpent, 400);
        expect(merged.balance, 600);
      });

      test('merge is symmetric and never loses either side', () {
        final a = const AiCreditsLedger().credit(5000).debit(100);
        final b = const AiCreditsLedger().credit(22000).debit(50);
        final ab = a.mergeWith(b);
        final ba = b.mergeWith(a);
        expect(ab.balance, ba.balance);
        expect(ab.totalPurchased, 22000);
        expect(ab.totalSpent, 100);
        expect(ab.balance, 21900);
      });

      test('a stale local never downgrades the merged ledger', () {
        final fresh = const AiCreditsLedger().credit(10000).debit(9000);
        final stale = const AiCreditsLedger().credit(10000);
        final merged = stale.mergeWith(fresh);
        expect(merged.balance, 1000);
        expect(merged.totalSpent, 9000);
      });
    });
  });

  group('settle/estimate pricing (tokens, dollar-pegged)', () {
    test('settle converts usd → tokens with fee + margin, ceil', () {
      final config = defaultAiGateway();
      // $0.002 upstream → real cost $0.00211 (×1.055 fee) → ×1.5 margin
      // = $0.003165 → ×1000 tokens/$ = 3.165 → 4 tokens
      expect(config.settlePriceTokens(0.002), 4);
    });

    test('settle never below the floor', () {
      final config = defaultAiGateway();
      expect(config.settlePriceTokens(0), 1);
    });

    test('cappedSettle bounds the runaway top-up', () {
      final config = defaultAiGateway();
      // Exact 500, reserved 100 → cap = 100 × 2 = 200
      expect(config.cappedSettleTokens(500, 100), 200);
      // Under the cap, exact wins.
      expect(config.cappedSettleTokens(150, 100), 150);
    });
  });

  group('AiCreditPack', () {
    test('bonus pack grants bonus tokens', () {
      const pack = AiCreditPack(20000, bonusTokens: 2000);
      expect(pack.creditsGranted, 22000);
      expect(pack.label, '20k tokens');
    });

    test('plain pack grants face value', () {
      const pack = AiCreditPack(1000);
      expect(pack.creditsGranted, 1000);
    });

    test('priceSats converts tokens → sats at the live rate + buffer', () {
      const pack = AiCreditPack(1000); // $1
      // $1 at 1111 sats/$ = 1111 sats; +3% buffer = 1145 (ceil)
      expect(pack.priceSats(satsPerUsd: 1111), 1111);
      expect(pack.priceSats(satsPerUsd: 1111, volatilityBuffer: 0.03), 1145);
    });
  });

  group('AiGatewayConfig', () {
    test('default gateway: openrouter provider + 21 visible models', () {
      final config = defaultAiGateway();
      expect(config.provider('openrouter'), isNotNull);
      expect(config.visibleModels.length, 21);
      expect(config.enabled, isTrue);
      expect(config.freeTrialPerDay, 5);
      expect(config.profitMargin, 1.5);
    });

    test('catalog covers every modality the picker filters by', () {
      final config = defaultAiGateway();
      final covered = <AiModality>{
        for (final m in config.visibleModels) ...m.modalities,
      };
      expect(covered, containsAll(AiModality.values));
      // Spot-check: image-gen models generate images, vision models see.
      expect(
        config.model('google/gemini-3.1-flash-image')!.modalities,
        contains(AiModality.imageGen),
      );
      expect(
        config.model('google/gemini-2.5-flash')!.modalities,
        containsAll([AiModality.text, AiModality.vision, AiModality.video]),
      );
    });

    test('modalitiesFrom maps provider catalog architecture', () {
      final vision = AiModelEntry.modalitiesFrom(
        inputs: ['text', 'image', 'video'],
        outputs: ['text'],
      );
      expect(vision, containsAll([AiModality.text, AiModality.vision, AiModality.video]));
      final imageGen = AiModelEntry.modalitiesFrom(
        inputs: ['text'],
        outputs: ['image', 'text'],
      );
      expect(imageGen, contains(AiModality.imageGen));
      expect(imageGen, isNot(contains(AiModality.text)));
    });

    test('free models price at the floor; paid models scale with margin', () {
      final config = defaultAiGateway();
      final free = config.model('openrouter/free')!;
      final sonnet = config.model('anthropic/claude-sonnet-4.5')!;
      expect(config.estimatePriceTokens(free), 1);
      // sonnet: (1500×$3 + 800×$15)/1M = $0.0165 → ×1.055 fee = $0.0174
      // → ×1.5 margin = $0.0261 → ×1000 tokens/$ ≈ 27, + vision uplift 4
      // = 31 tokens
      expect(config.estimatePriceTokens(sonnet), 31);
    });

    test('modality uplift: max of modalities, added on top of margin', () {
      final config = defaultAiGateway();
      // Gemini 2.5 Flash: text+vision+video+audio → max uplift = audio 12
      final flash = config.model('google/gemini-2.5-flash')!;
      expect(config.modalityUpliftFor(flash), 12);
      // Image-gen model → 33
      final image = config.model('google/gemini-3.1-flash-image')!;
      expect(config.modalityUpliftFor(image), 33);
      // Plain text → 0
      final deepseek = config.model('deepseek/deepseek-v3.2')!;
      expect(config.modalityUpliftFor(deepseek), 0);
      // Cheaper on a cheaper vision model than on a frontier one:
      expect(
        config.estimatePriceTokens(deepseek),
        lessThan(config.estimatePriceTokens(image)),
      );
    });

    test('config note overrides modality uplifts (both keys parse)', () {
      final json = defaultAiGateway().toJson();
      json['modality_uplift_tokens'] = {'imageGen': 100, 'vision': 8};
      final config = AiGatewayConfig.fromJson(json);
      expect(config.modalityUpliftTokens[AiModality.imageGen], 100);
      expect(config.modalityUpliftTokens[AiModality.vision], 8);
      // Untouched modalities keep defaults.
      expect(config.modalityUpliftTokens[AiModality.audio], 12);
      // Legacy sats key also parses (older notes).
      final legacy = defaultAiGateway().toJson()
        ..remove('modality_uplift_tokens')
        ..['modality_uplift_sats'] = {'imageGen': 77};
      final legacyConfig = AiGatewayConfig.fromJson(legacy);
      expect(legacyConfig.modalityUpliftTokens[AiModality.imageGen], 77);
    });

    test('settle price uses exact cost × fee × margin with floor', () {
      final config = defaultAiGateway();
      expect(config.settlePriceTokens(0), 1);
      expect(config.settlePriceTokens(0.002), 4);
    });

    test('visible models sort by tier then price', () {
      final config = defaultAiGateway();
      final tiers = config.visibleModels.map((m) => m.tier).toList();
      final sorted = [...tiers]..sort();
      expect(tiers, sorted);
      expect(config.visibleModels.first.trialEligible, isTrue);
    });

    test('json round-trip (config note format)', () {
      final config = defaultAiGateway();
      final restored = AiGatewayConfig.fromJson(config.toJson());
      expect(restored.providers.length, config.providers.length);
      expect(restored.models.length, config.models.length);
      expect(restored.profitMargin, 1.5);
      expect(restored.fallbackModelIds, config.fallbackModelIds);
      expect(restored.models.first.id, config.models.first.id);
    });

    test('provider switch is config-only: a second provider parses', () {
      final json = defaultAiGateway().toJson();
      (json['providers'] as List).add({
        'id': 'other',
        'name': 'OtherAI',
        'base_url': 'https://api.other.ai/v1',
        'api_key_env': 'OTHER_API_KEY',
      });
      (json['models'] as List).add({
        'id': 'other/model-x',
        'provider': 'other',
        'label': 'Model X',
        'tier': 2,
        'prompt_usd_per_m': 1.0,
        'completion_usd_per_m': 2.0,
      });
      final config = AiGatewayConfig.fromJson(json);
      expect(config.provider('other')!.name, 'OtherAI');
      expect(config.model('other/model-x')!.providerId, 'other');
      expect(config.visibleModels.length, 22);
    });
  });

  group('AiMessage', () {
    test('json round-trip preserves fields', () {
      final message = AiMessage(
        id: 'a-1',
        role: AiRole.assistant,
        content: 'hello',
        createdAt: DateTime.fromMillisecondsSinceEpoch(1234567890),
        costTokens: 3,
        costUsd: 0.0002,
        model: 'openrouter/free',
      );
      final restored = AiMessage.fromJson(message.toJson());
      expect(restored.id, message.id);
      expect(restored.role, AiRole.assistant);
      expect(restored.content, 'hello');
      expect(restored.costTokens, 3);
      expect(restored.model, 'openrouter/free');
    });

    test('legacy costSats json still parses (upgrade path)', () {
      final restored = AiMessage.fromJson({
        'id': 'a-1',
        'role': 'assistant',
        'content': 'hello',
        'createdAt': 1234567890,
        'costSats': 7,
      });
      expect(restored.costTokens, 7);
    });
  });
}
