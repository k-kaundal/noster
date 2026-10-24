import 'package:shared_preferences/shared_preferences.dart';

/// Device-local free-trial counter: N free AI messages per day (Basic tier
/// only), then paid-only. Resets at local midnight.
///
/// Client-side by design (no server): wiping app data resets the trial —
/// acceptable, the global free pool is still rate-limited per key.
class AiTrialStore {
  static const _countKey = 'ai:trial_count_v1';
  static const _dayKey = 'ai:trial_day_v1';

  /// `shared_preferences_android` can throw "No instance with no name has
  /// been registered" after a background engine detaches
  /// (flutter/flutter#194920). On a transient failure we keep the counter
  /// in memory so the trial still decrements this session — a swallowed
  /// write must never reset the count to 0 (the "trial stuck at 5" bug).
  int _memoryCount = 0;
  String _memoryDay = '';

  String _today() {
    final now = DateTime.now();
    return '${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
  }

  Future<int> usedToday() async {
    final today = _today();
    try {
      final prefs = await SharedPreferences.getInstance();
      if (prefs.getString(_dayKey) != today) return 0;
      return prefs.getInt(_countKey) ?? 0;
    } catch (_) {
      // Fall back to the in-memory count for THIS session.
      return _memoryDay == today ? _memoryCount : 0;
    }
  }

  Future<int> increment() async {
    final today = _today();
    var current = 0;
    try {
      final prefs = await SharedPreferences.getInstance();
      current = prefs.getString(_dayKey) == today
          ? (prefs.getInt(_countKey) ?? 0)
          : 0;
    } catch (_) {
      current = _memoryDay == today ? _memoryCount : 0;
    }
    final next = current + 1;
    // Always advance the in-memory count so the session decrements even if
    // the disk write fails.
    _memoryDay = today;
    _memoryCount = next;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_dayKey, today);
      await prefs.setInt(_countKey, next);
    } catch (_) {
      // In-memory count already advanced — persists next successful write.
    }
    return next;
  }
}
