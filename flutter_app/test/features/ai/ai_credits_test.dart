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
  });

  group('satsToCharge', () {
    test('converts usd → sats with margin, ceil', () {
      // $0.002 at 1111 sats/$ × 1.5 margin = 3.33 → 4 sats
      final sats = satsToCharge(costUsd: 0.002, satsPerUsd: 1111);
      expect(sats, 4);
    });

    test('never below minSats', () {
      final sats = satsToCharge(costUsd: 0, satsPerUsd: 1111);
      expect(sats, 1);
    });

    test('respects the cap', () {
      final sats = satsToCharge(
        costUsd: 10,
        satsPerUsd: 1111,
        capSats: 70,
      );
      expect(sats, 70);
    });
  });

  group('AiCreditPack', () {
    test('bonus pack grants bonus credits', () {
      const pack = AiCreditPack(20000, bonusCredits: 2000);
      expect(pack.creditsGranted, 22000);
      expect(pack.label, '20k sats');
    });

    test('plain pack grants face value', () {
      const pack = AiCreditPack(1000);
      expect(pack.creditsGranted, 1000);
    });
  });

  group('AiGatewayConfig', () {
    test('default gateway: openrouter provider + 12 visible models', () {
      final config = defaultAiGateway();
      expect(config.provider('openrouter'), isNotNull);
      expect(config.visibleModels.length, 12);
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
      // 1111 sats/USD ≈ $90k BTC
      expect(config.estimatePriceSats(free, satsPerUsd: 1111), 1);
      // sonnet: (800×$3 + 400×$15)/1M = $0.0084 → ×1111×1.5 = 14 sats,
      // + vision uplift 5 (sonnet is text+vision) = 19 sats
      expect(config.estimatePriceSats(sonnet, satsPerUsd: 1111), 19);
    });

    test('modality uplift: max of modalities, added on top of margin', () {
      final config = defaultAiGateway();
      // Gemini 2.5 Flash: text+vision+video+audio → max uplift = audio 15
      final flash = config.model('google/gemini-2.5-flash')!;
      expect(config.modalityUpliftFor(flash), 15);
      // Image-gen model → 40
      final image = config.model('google/gemini-3.1-flash-image')!;
      expect(config.modalityUpliftFor(image), 40);
      // Plain text → 0
      final deepseek = config.model('deepseek/deepseek-chat')!;
      expect(config.modalityUpliftFor(deepseek), 0);
      // Image-gen price = cost×margin + 40: (800×$0.5 + 400×$3)/1M = $0.0016
      // → ×1111×1.5 ≈ 3 → 3 + 40 = 43 sats
      expect(config.estimatePriceSats(image, satsPerUsd: 1111), 43);
      // Cheaper on a cheaper vision model than on a frontier one:
      expect(
        config.estimatePriceSats(deepseek, satsPerUsd: 1111),
        lessThan(config.estimatePriceSats(image, satsPerUsd: 1111)),
      );
    });

    test('config note overrides modality uplifts', () {
      final json = defaultAiGateway().toJson();
      json['modality_uplift_sats'] = {'imageGen': 100, 'vision': 8};
      final config = AiGatewayConfig.fromJson(json);
      expect(config.modalityUpliftSats[AiModality.imageGen], 100);
      expect(config.modalityUpliftSats[AiModality.vision], 8);
      // Untouched modalities keep defaults.
      expect(config.modalityUpliftSats[AiModality.audio], 15);
    });

    test('settle price uses exact cost × margin with floor', () {
      final config = defaultAiGateway();
      expect(config.settlePriceSats(0, satsPerUsd: 1111), 1);
      expect(config.settlePriceSats(0.002, satsPerUsd: 1111), 4);
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
      expect(config.visibleModels.length, 13);
    });
  });

  group('AiMessage', () {
    test('json round-trip preserves fields', () {
      final message = AiMessage(
        id: 'a-1',
        role: AiRole.assistant,
        content: 'hello',
        createdAt: DateTime.fromMillisecondsSinceEpoch(1234567890),
        costSats: 3,
        costUsd: 0.0002,
        model: 'openrouter/free',
      );
      final restored = AiMessage.fromJson(message.toJson());
      expect(restored.id, message.id);
      expect(restored.role, AiRole.assistant);
      expect(restored.content, 'hello');
      expect(restored.costSats, 3);
      expect(restored.model, 'openrouter/free');
    });
  });
}
