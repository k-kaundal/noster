import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../config/env.dart';

/// Storage key for the user's chosen LNbits instance URL.
const _kLnbitsUrlKey = 'settings:lnbits_url';

/// The user's chosen LNbits instance URL.
///
/// Defaults to `Env.lnbitsUrl` (compile-time constant). The user can change
/// it in Settings — needed because different LNbits instances have different
/// `nostr_absolute_request_urls` configurations, and a URL that works on one
/// instance may be rejected by another.
final lnbitsUrlProvider =
    StateNotifierProvider<LnbitsUrlNotifier, String>((ref) {
  return LnbitsUrlNotifier();
});

class LnbitsUrlNotifier extends StateNotifier<String> {
  LnbitsUrlNotifier() : super(Env.lnbitsUrl) {
    _load();
  }

  Future<void> _load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final stored = prefs.getString(_kLnbitsUrlKey);
      if (stored != null && stored.isNotEmpty) {
        state = stored;
      }
    } catch (_) {}
  }

  Future<void> setUrl(String url) async {
    final trimmed = url.trim().replaceAll(RegExp(r'/+$'), '');
    if (trimmed.isEmpty) return;
    state = trimmed;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_kLnbitsUrlKey, trimmed);
    } catch (_) {}
  }

  Future<void> reset() async {
    state = Env.lnbitsUrl;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(_kLnbitsUrlKey);
    } catch (_) {}
  }
}
