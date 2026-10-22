import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/features/ai/data/ai_trial_store.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('increment decrements the remaining trial (not stuck)', () async {
    SharedPreferences.setMockInitialValues({});
    final store = AiTrialStore();
    expect(await store.usedToday(), 0);
    expect(await store.increment(), 1);
    expect(await store.increment(), 2);
    expect(await store.usedToday(), 2);
  });

  test('a new day resets the counter', () async {
    // Pretend yesterday was recorded.
    SharedPreferences.setMockInitialValues({
      'ai:trial_day_v1': '1999-01-01',
      'ai:trial_count_v1': 4,
    });
    final store = AiTrialStore();
    expect(await store.usedToday(), 0); // old day → 0
    expect(await store.increment(), 1); // fresh day → 1
  });
}
