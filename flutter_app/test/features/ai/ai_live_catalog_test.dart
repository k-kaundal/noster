import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/features/ai/data/ai_config_service.dart';
import 'package:nostrfeed_mobile/features/ai/domain/ai_gateway.dart';

/// The live-catalog merge keeps prices real-time and the free pool alive
/// WITHOUT an app release. These cover the four product rules:
/// 1. Known models take the LIVE USD price (never a stale hardcode).
/// 2. Dead free models leave (they 404 on send — keeping them breaks trial).
/// 3. New chat-capable free models join the trial pool (capped).
/// 4. Paid models NEVER auto-join — pricing is the operator's call.
void main() {
  const base = AiGatewayConfig(
    providers: [
      AiProviderConfig(
        id: 'openrouter',
        name: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
      ),
    ],
    fallbackModelIds: ['openrouter/free', 'dead/model:free'],
    models: [
      AiModelEntry(
        id: 'openrouter/free',
        providerId: 'openrouter',
        label: 'Basic',
        trialEligible: true,
      ),
      AiModelEntry(
        id: 'dead/model:free',
        providerId: 'openrouter',
        label: 'Dead Free',
        trialEligible: true,
      ),
      AiModelEntry(
        id: 'anthropic/claude-sonnet-4.5',
        providerId: 'openrouter',
        label: 'Claude Sonnet 4.5',
        tier: 4,
        promptUsdPerM: 3.00,
        completionUsdPerM: 15.00,
        modalities: {AiModality.text, AiModality.vision},
      ),
    ],
  );

  AiModelEntry catalogEntry(
    String id, {
    double prompt = 0,
    double completion = 0,
    Set<AiModality> modalities = const {AiModality.text},
    String? label,
  }) =>
      AiModelEntry(
        id: id,
        providerId: 'openrouter',
        label: label ?? id,
        promptUsdPerM: prompt,
        completionUsdPerM: completion,
        modalities: modalities,
      );

  test('known models take the LIVE prices, keeping label/tier/trial', () {
    final merged = AiConfigService.mergeLiveCatalog(base, 'openrouter', [
      catalogEntry('openrouter/free'),
      catalogEntry(
        'anthropic/claude-sonnet-4.5',
        prompt: 3.60, // the price moved — the config's 3.00 is stale
        completion: 18.00,
        modalities: {AiModality.text, AiModality.vision, AiModality.audio},
      ),
    ]);
    final sonnet = merged.model('anthropic/claude-sonnet-4.5')!;
    expect(sonnet.promptUsdPerM, 3.60);
    expect(sonnet.completionUsdPerM, 18.00);
    expect(sonnet.modalities, contains(AiModality.audio));
    // Operator-controlled fields are untouched.
    expect(sonnet.label, 'Claude Sonnet 4.5');
    expect(sonnet.tier, 4);
  });

  test('a free model the catalog dropped is removed + out of fallbacks', () {
    final merged = AiConfigService.mergeLiveCatalog(base, 'openrouter', [
      catalogEntry('openrouter/free'),
      catalogEntry('anthropic/claude-sonnet-4.5',
          prompt: 3.00, completion: 15.00),
    ]);
    expect(merged.model('dead/model:free'), isNull);
    expect(merged.fallbackModelIds, isNot(contains('dead/model:free')));
    expect(merged.fallbackModelIds, contains('openrouter/free'));
  });

  test('a paid model missing from the catalog is KEPT (operator-curated)', () {
    final merged = AiConfigService.mergeLiveCatalog(base, 'openrouter', [
      catalogEntry('openrouter/free'),
      // sonnet absent — the operator may have pinned it deliberately.
    ]);
    expect(merged.model('anthropic/claude-sonnet-4.5'), isNotNull);
  });

  test('new chat-capable free models join the trial pool', () {
    final merged = AiConfigService.mergeLiveCatalog(base, 'openrouter', [
      catalogEntry('openrouter/free'),
      catalogEntry('dead/model:free'),
      catalogEntry(
        'nvidia/nemotron-3-super-120b-a12b:free',
        label: 'NVIDIA: Nemotron 3 Super 120B (free)',
        modalities: {AiModality.text, AiModality.vision},
      ),
    ]);
    final added = merged.model('nvidia/nemotron-3-super-120b-a12b:free')!;
    expect(added.trialEligible, isTrue);
    expect(added.tier, 1);
    expect(added.isFreeUpstream, isTrue);
    // Label is prettified: vendor prefix + "(free)" stripped.
    expect(added.label, 'Nemotron 3 Super 120B');
  });

  test('non-chat free models never auto-join (pricing needs curation)', () {
    final merged = AiConfigService.mergeLiveCatalog(base, 'openrouter', [
      catalogEntry('openrouter/free'),
      catalogEntry('dead/model:free'),
      catalogEntry(
        'google/gemini-image:free',
        modalities: {AiModality.imageGen},
      ),
      catalogEntry(
        'fish-audio/s2:free',
        modalities: {AiModality.audio},
      ),
    ]);
    expect(merged.model('google/gemini-image:free'), isNull);
    expect(merged.model('fish-audio/s2:free'), isNull);
  });

  test('paid models never auto-join, even when chat-capable', () {
    final merged = AiConfigService.mergeLiveCatalog(base, 'openrouter', [
      catalogEntry('openrouter/free'),
      catalogEntry('dead/model:free'),
      catalogEntry('openai/gpt-5', prompt: 1.25, completion: 10.00),
    ]);
    expect(merged.model('openai/gpt-5'), isNull);
  });

  test('auto-added free models are capped', () {
    final catalog = [
      catalogEntry('openrouter/free'),
      catalogEntry('dead/model:free'),
      for (var i = 0; i < 20; i++) catalogEntry('vendor/model-$i:free'),
    ];
    final merged = AiConfigService.mergeLiveCatalog(base, 'openrouter', catalog);
    final autoAdded = merged.models
        .where((m) => m.id.startsWith('vendor/model-'))
        .length;
    expect(autoAdded, AiConfigService.maxAutoFreeModels);
  });
}
