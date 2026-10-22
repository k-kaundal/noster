import 'package:nostrfeed_mobile/core/services/http_helper.dart';
import 'package:nostrfeed_mobile/features/wallet/data/wallet_tools_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Real-time BTC→sats exchange rate for AI pricing.
///
/// The sats price of an AI message is only honest if the conversion is the
/// LIVE market rate — a hardcoded rate sells sats at the wrong price the
/// moment BTC moves (the operator loses on a pump, the user overpays on a
/// dump). Sources, in order:
///
/// 1. The house LNbits rate API (`walletToolsService.fiatRate`) — the same
///    rate the wallet UI quotes, so AI prices and wallet balances agree.
/// 2. mempool.space's public price endpoint — independent fallback when the
///    house API is unreachable.
/// 3. The last successful rate, cached to disk — a stale live rate beats a
///    blind constant (the volatility buffer in the pricing config covers
///    normal drift between refreshes).
///
/// Every successful fetch is cached with its timestamp.
class AiExchangeRateService {
  static const _cacheKey = 'ai:sats_per_usd_rate';
  static const _cacheTsKey = 'ai:sats_per_usd_ts';

  final WalletToolsService _tools;
  final ApiHttpClient _http;

  AiExchangeRateService(this._tools, {ApiHttpClient? httpClient})
      : _http = httpClient ?? const ApiHttpClient();

  /// Fetches the live sats-per-USD rate; null when every source fails.
  /// Caches the winner to disk before returning.
  Future<double?> fetchSatsPerUsd() async {
    // 1. House LNbits rate API (price of 1 BTC in USD → sats per $1).
    try {
      final btcUsd = await _tools.fiatRate('USD');
      if (btcUsd != null && btcUsd > 0) {
        final rate = 1e8 / btcUsd;
        await _save(rate);
        return rate;
      }
    } catch (_) {
      // Fall through to the public source.
    }

    // 2. mempool.space — no key, no house dependency.
    try {
      final json = await _http.getJson(
        Uri.parse('https://mempool.space/api/v1/prices'),
      );
      final btcUsd = (json['USD'] as num?)?.toDouble();
      if (btcUsd != null && btcUsd > 0) {
        final rate = 1e8 / btcUsd;
        await _save(rate);
        return rate;
      }
    } catch (_) {
      // Fall through — caller uses the disk cache / constant.
    }
    return null;
  }

  /// The last successfully fetched rate, however old. Null if never fetched.
  Future<double?> loadCached() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      return prefs.getDouble(_cacheKey);
    } catch (_) {
      return null;
    }
  }

  Future<void> _save(double rate) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setDouble(_cacheKey, rate);
      await prefs.setInt(
        _cacheTsKey,
        DateTime.now().millisecondsSinceEpoch ~/ 1000,
      );
    } catch (_) {}
  }
}
