import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:nostrfeed_mobile/core/theme/app_spacing.dart';

/// LNURL-pay metadata resolved from a Lightning Address.
class LnurlPayInfo {
  /// The LNURL callback URL (https://…).
  final String callback;
  /// Minimum sendable millisatoshis.
  final int minSats;
  /// Maximum sendable millisatoshis.
  final int maxSats;
  /// Whether the callback allows Nostr zaps (kind 9734).
  final bool allowsNostr;
  /// The recipient's Nostr pubkey for zaps.
  final String? nostrPubkey;

  const LnurlPayInfo({
    required this.callback,
    required this.minSats,
    required this.maxSats,
    required this.allowsNostr,
    this.nostrPubkey,
  });
}

/// Resolve a Lightning Address (user@domain.com) or raw LNURL to pay info.
Future<LnurlPayInfo?> resolveLnurlPay(String addressOrLnurl) async {
  try {
    String lnurlEndpoint;
    if (addressOrLnurl.contains('@')) {
      final parts = addressOrLnurl.split('@');
      if (parts.length != 2) return null;
      lnurlEndpoint =
          'https://${parts[1]}/.well-known/lnurlp/${parts[0]}';
    } else if (addressOrLnurl.toLowerCase().startsWith('lnurl')) {
      // Decode bech32 LNURL — simplified: most modern stacks use lightning addresses
      return null;
    } else {
      return null;
    }

    final res = await http
        .get(Uri.parse(lnurlEndpoint))
        .timeout(AppDurations.queryShort);
    if (res.statusCode != 200) return null;
    final json = jsonDecode(res.body) as Map<String, dynamic>;
    if (json['tag'] != 'payRequest') return null;

    final callback = json['callback'] as String?;
    final minMsat = json['minSendable'] as int?;
    final maxMsat = json['maxSendable'] as int?;
    if (callback == null || minMsat == null || maxMsat == null) return null;

    return LnurlPayInfo(
      callback: callback,
      minSats: minMsat ~/ 1000,
      maxSats: maxMsat ~/ 1000,
      allowsNostr: json['allowsNostr'] == true,
      nostrPubkey: json['nostrPubkey'] as String?,
    );
  } catch (_) {
    return null;
  }
}

/// Request a BOLT11 invoice from an LNURL-pay callback.
/// If [zapRequestJson] is provided (NIP-57), include it as the `nostr` param.
Future<String?> fetchInvoice({
  required LnurlPayInfo info,
  required int sats,
  String? comment,
  String? zapRequestJson,
}) async {
  try {
    final uri = Uri.parse(info.callback).replace(queryParameters: {
      'amount': '${sats * 1000}',
      if (comment != null && comment.isNotEmpty) 'comment': comment,
      if (zapRequestJson != null) ...{
        'nostr': zapRequestJson,
        'lnurl': '',
      },
    });
    final res = await http.get(uri).timeout(AppDurations.http);
    if (res.statusCode != 200) return null;
    final json = jsonDecode(res.body) as Map<String, dynamic>;
    final pr = json['pr'] as String?;
    return pr;
  } catch (_) {
    return null;
  }
}
