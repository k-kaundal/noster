import 'package:shared_preferences/shared_preferences.dart';

/// Device-local free-trial counter: N free AI messages per day (Basic tier
/// only), then paid-only. Resets at local midnight.
///
/// Client-side by design (no server): wiping app data resets the trial —
/// acceptable, the global free pool is still rate-limited per key.
class AiTrialStore {
  static const _countKey = 'ai:trial_count_v1';
  static const _dayKey = 'ai:trial_day_v1';

  String _today() {
    final now = DateTime.now();
    return '${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
  }

  Future<int> usedToday() async {
    final prefs = await SharedPreferences.getInstance();
    if (prefs.getString(_dayKey) != _today()) return 0;
    return prefs.getInt(_countKey) ?? 0;
  }

  Future<int> increment() async {
    final prefs = await SharedPreferences.getInstance();
    final today = _today();
    final current = prefs.getString(_dayKey) == today
        ? (prefs.getInt(_countKey) ?? 0)
        : 0;
    final next = current + 1;
    await prefs.setString(_dayKey, today);
    await prefs.setInt(_countKey, next);
    return next;
  }
}
