import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/features/sats_drops/application/sats_drops_providers.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  group('SatsDrop model', () {
    test('JSON round-trip preserves all fields', () {
      final drop = SatsDrop(
        id: '123',
        label: 'Test Drop',
        amountSats: 1000,
        totalClaims: 50,
        claimed: 12,
        createdAt: DateTime.fromMillisecondsSinceEpoch(1700000000000),
      );
      final restored = SatsDrop.fromJson(drop.toJson());
      expect(restored.id, drop.id);
      expect(restored.label, drop.label);
      expect(restored.amountSats, drop.amountSats);
      expect(restored.totalClaims, drop.totalClaims);
      expect(restored.claimed, drop.claimed);
      expect(restored.createdAt, drop.createdAt);
    });

    test('copyWith bumps claimed only', () {
      final drop = SatsDrop(
        id: '1',
        label: 'L',
        amountSats: 100,
        totalClaims: 10,
        claimed: 3,
        createdAt: DateTime(2026),
      );
      final bumped = drop.copyWith(claimed: 4);
      expect(bumped.claimed, 4);
      expect(bumped.label, 'L');
      expect(bumped.totalClaims, 10);
    });
  });
}
