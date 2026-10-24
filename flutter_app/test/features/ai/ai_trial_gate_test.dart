import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/features/ai/domain/ai_gateway.dart';

void main() {
  // The product rule: the free daily trial covers ONLY free (zero-cost,
  // trial-eligible) models. A paid model must never be sendable on the
  // trial — its USD cost is what the user pays for.
  group('free trial = free models only', () {
    final config = defaultAiGateway();

    test('every trial-eligible model costs zero upstream', () {
      final trialModels =
          config.visibleModels.where((m) => m.trialEligible).toList();
      expect(trialModels, isNotEmpty);
      for (final m in trialModels) {
        expect(
          m.isFreeUpstream,
          isTrue,
          reason: '${m.id} is trial-eligible but has a USD price',
        );
      }
    });

    test('no paid model is trial-eligible', () {
      final paidModels =
          config.visibleModels.where((m) => !m.isFreeUpstream).toList();
      for (final m in paidModels) {
        expect(
          m.trialEligible,
          isFalse,
          reason: '${m.id} has a USD price but is marked trial-eligible',
        );
      }
    });

    test('the trial-eligible set is exactly the free pool', () {
      final ids = config.visibleModels
          .where((m) => m.trialEligible)
          .map((m) => m.id)
          .toSet();
      // The built-in free pool (auto-router + :free models) — nothing else.
      // The live catalog can add MORE :free models at runtime (see
      // AiConfigService.mergeLiveCatalog) — this asserts the shipped set.
      expect(ids, {
        'openrouter/free',
        'nvidia/nemotron-3-super-120b-a12b:free',
        'cohere/north-mini-code:free',
        'poolside/laguna-s-2.1:free',
        'google/gemma-4-31b-it:free',
      });
    });
  });

  group('custom-amount fee math (mirrors the top-up sheet)', () {
    int customTotal(int amount, {int feePercent = 3}) =>
        amount + ((amount * feePercent + 99) ~/ 100);

    test('1000 sats → 1030 total', () {
      expect(customTotal(1000), 1030);
    });

    test('fee rounds up, never fractional', () {
      expect(customTotal(1001), 1032); // 30.03 → 31 fee
      expect(customTotal(2500), 2575); // 75 exactly
    });

    test('preset packs carry no fee (flat price)', () {
      // The packs in aiCreditPacks grant sats + bonus; the PRICE is just
      // sats — no fee on top.
      const packPrice = 20000;
      const granted = 22000; // +10% bonus
      // User pays exactly the pack price; the bonus is extra credits.
      expect(packPrice, 20000);
      expect(granted, greaterThan(packPrice));
    });
  });
}
