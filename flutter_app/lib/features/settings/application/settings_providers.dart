import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nostrfeed_mobile/core/config/env.dart';
import 'package:nostrfeed_mobile/features/wallet/data/lnbits_service.dart'
    as lnbits;
import 'package:shared_preferences/shared_preferences.dart';

/// Storage key for the user's chosen LNbits instance URL.
const _kLnbitsUrlKey = 'settings:lnbits_url';

/// The user's chosen LNbits instance URL.
///
/// Defaults to `Env.lnbitsUrl` (compile-time constant). The user can change
/// it in Settings — needed because different LNbits instances have different
/// `nostr_absolute_request_urls` configurations, and a URL that works on one
/// instance may be rejected by another.
final lnbitsUrlProvider = NotifierProvider<LnbitsUrlNotifier, String>(
  LnbitsUrlNotifier.new,
);

class LnbitsUrlNotifier extends Notifier<String> {
  @override
  String build() {
    _load();
    return Env.lnbitsUrl;
  }

  /// Keep the no-arg `LnbitsService()` pointed at the same instance.
  void _apply(String url) => lnbits.setActiveLnbitsUrl(url);

  Future<void> _load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final stored = prefs.getString(_kLnbitsUrlKey);
      if (stored != null && stored.isNotEmpty) {
        state = stored;
        _apply(stored);
      }
    } catch (_) {}
  }

  Future<void> setUrl(String url) async {
    final trimmed = url.trim().replaceAll(RegExp(r'/+$'), '');
    if (trimmed.isEmpty) return;
    state = trimmed;
    _apply(trimmed);
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_kLnbitsUrlKey, trimmed);
    } catch (_) {}
  }

  Future<void> reset() async {
    state = Env.lnbitsUrl;
    _apply(Env.lnbitsUrl);
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(_kLnbitsUrlKey);
    } catch (_) {}
  }
}
