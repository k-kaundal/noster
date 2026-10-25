import 'dart:convert';


import 'package:nostrfeed_mobile/core/config/env.dart';
import 'package:nostrfeed_mobile/core/services/http_helper.dart';

/// Paid relay admission — bought once per pubkey, checked against the relay
/// itself (never local state). Mirrors the web app's `src/lib/paidRelay.ts`.
///
/// The relay is the only authority: nothing stored on the device can grant
/// access, and a failed check is NOT a refusal — the relay lives on another
/// origin/host, so "we could not ask" gets its own answer ([AdmissionState.unknown]),
/// never treated as unpaid (that would invite somebody to pay twice).
class AdmissionException implements Exception {
  final String message;
  const AdmissionException(this.message);
  @override
  String toString() => message;
}

/// Three-valued, because "the relay did not answer" is not "the relay said no".
enum AdmissionState { admitted, unpaid, unknown }

/// An invoice for admission, as the relay describes one.
class AdmissionInvoice {
  /// Absent when the key was already admitted and there is nothing to pay.
  final String? bolt11;

  /// The payment hash, which is also the id the status route takes.
  final String? id;
  final int amountSats;

  /// Where to poll. Given by the relay rather than built, so a moved route
  /// follows on its own.
  final String? statusUrl;

  /// Seconds since epoch, or null when the relay did not say.
  final int? expiresAt;
  final AdmissionInvoiceStatus status;

  /// Whether this key is already in. The relay answers a POST for an
  /// admitted key with this set and no invoice — the case that must never
  /// turn into a second charge.
  final bool userAdmitted;

  const AdmissionInvoice({
    this.bolt11,
    this.id,
    this.amountSats = 0,
    this.statusUrl,
    this.expiresAt,
    this.status = AdmissionInvoiceStatus.unknown,
    this.userAdmitted = false,
  });
}

enum AdmissionInvoiceStatus { pending, completed, expired, unknown }

class AdmissionService {
  static const _timeout = Duration(seconds: 8);

  /// What admission costs when the relay has not said. A fallback for first
  /// paint and for a relay whose fee cannot be quoted — never preferred over
  /// the invoice endpoint's own `amount_sats`, because the price is the
  /// operator's to change and this constant goes stale the moment they do.
  static const fallbackAdmissionSats = 2100;

  final ApiHttpClient _client;
  const AdmissionService([this._client = const ApiHttpClient()]);

  /// Where admission is bought and checked. nostream serves both over HTTP.
  static String get _base => (Env.paidRelayAdmission.isNotEmpty
          ? Env.paidRelayAdmission
          : Env.paidRelay.replaceFirst('wss://', 'https://'))
      .replaceAll(RegExp(r'/+$'), '');

  /// Where to ask about one key.
  static Uri checkUrl(String pubkey) => Uri.parse('$_base/admissions/check/$pubkey');

  /// Where invoices are made, and read (`GET` quotes the fee without minting).
  static Uri invoicesUrl() => Uri.parse('$_base/invoices');

  /// Asks the relay whether [pubkey] may write. Any failure — offline,
  /// timeout, non-JSON, non-2xx — resolves to [AdmissionState.unknown],
  /// which must never be shown as "has not paid".
  Future<AdmissionState> check(String pubkey) async {
    // Probe-style: tryGetJson returns null on any failure, and a failed
    // check is never a refusal.
    final body = await const ApiHttpClient(timeout: _timeout).tryGetJson(
      checkUrl(pubkey),
      headers: const {'Accept': 'application/json'},
    );
    final admitted = readAdmission(body);
    if (admitted == null) return AdmissionState.unknown;
    return admitted ? AdmissionState.admitted : AdmissionState.unpaid;
  }

  /// Quotes the admission fee from the endpoint that will actually charge it.
  ///
  /// Asked of the minting endpoint rather than NIP-11, because a plain JSON
  /// GET has no CORS preflight to be misconfigured away. Returns null when
  /// the relay did not quote a usable price.
  Future<int?> quoteFeeSats() async {
    try {
      final body = await _client.tryGetJson(
        invoicesUrl(),
        headers: const {'Accept': 'application/json'},
      );
      final sats = body?['amount_sats'];
      if (sats is num && sats > 0) return sats.round();
      return null;
    } catch (_) {
      return null;
    }
  }

  /// Mints an admission invoice for [pubkey].
  ///
  /// JSON first, form-encoded second — the relay documents both and they
  /// fail differently (JSON needs a CORS preflight the relay's nginx has to
  /// answer; form-encoded needs none). Trying the documented shape first and
  /// falling back to the one that cannot be preflighted away means a
  /// misconfigured OPTIONS costs a round trip rather than the whole feature.
  Future<AdmissionInvoice> mintInvoice(String pubkey) async {
    final url = invoicesUrl();
    final attempts = <(Map<String, String>, Object)>[
      (
        {'Accept': 'application/json', 'Content-Type': 'application/json'},
        jsonEncode({'pubkey': pubkey, 'tosAccepted': true, 'feeSchedule': 'admission'}),
      ),
      (
        {
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        'pubkey=${Uri.encodeQueryComponent(pubkey)}&tosAccepted=yes&feeSchedule=admission',
      ),
    ];

    var failure = 'The relay did not answer';
    const client = ApiHttpClient(timeout: _timeout);
    for (final (headers, body) in attempts) {
      final json = await client.tryPostRaw(url, headers: headers, body: body);
      if (json == null) {
        failure = 'The relay returned an error';
        continue;
      }
      final invoice = readInvoice(json);
      if (invoice != null) return invoice;
      failure = 'The relay did not return an invoice';
    }
    throw AdmissionException(failure);
  }

  /// Polls one invoice's status route once.
  Future<AdmissionInvoiceStatus> pollStatus(String statusUrl) async {
    try {
      final body = await _client.tryGetJson(
        Uri.parse(statusUrl),
        headers: const {'Accept': 'application/json'},
      );
      return readInvoiceStatus(body);
    } catch (_) {
      return AdmissionInvoiceStatus.unknown;
    }
  }

  /// Reads the relay's invoice, in whichever shape it sent one.
  ///
  /// The documented response quotes `amount_sats`, and nostream's own API has
  /// historically quoted millisats under `amount`. Each is read from its own
  /// field and neither is converted into the other — reading the wrong one is
  /// a factor of a thousand on a number shown next to a QR code.
  static AdmissionInvoice? readInvoice(Object? body) {
    if (body is! Map) return null;
    final nested = body['invoice'];

    Object? pick(List<Object?> values) {
      for (final v in values) {
        if (v != null && v != '') return v;
      }
      return null;
    }

    final userAdmitted = body['userAdmitted'] == true;

    final bolt11 = pick([
      body['bolt11'],
      body['paymentRequest'],
      body['payment_request'],
      nested is Map ? nested['bolt11'] : null,
      nested is Map ? nested['paymentRequest'] : null,
      nested is Map ? nested['payment_request'] : null,
    ]);

    // An admitted key comes back with no invoice, which is an answer rather
    // than a failure — everything else with no invoice is a failure.
    if (bolt11 is! String && !userAdmitted) return null;

    num? asNum(Object? v) => v is num ? v : num.tryParse('$v');
    final sats = asNum(pick([
      body['amount_sats'],
      nested is Map ? nested['amount_sats'] : null,
    ]));
    final msats = asNum(pick([
      body['amount'],
      nested is Map ? nested['amount'] : null,
    ]));

    final expires = pick([
      body['expires_at'],
      nested is Map ? nested['expires_at'] : null,
    ]);
    int? expiresAt;
    if (expires is num) {
      expiresAt = expires.toInt();
    } else if (expires is String) {
      expiresAt = DateTime.tryParse(expires) != null
          ? DateTime.parse(expires).millisecondsSinceEpoch ~/ 1000
          : null;
    }

    return AdmissionInvoice(
      bolt11: bolt11 is String ? bolt11 : null,
      id: pick([body['id'], nested is Map ? nested['id'] : null]) as String?,
      amountSats: sats != null && sats > 0
          ? sats.round()
          : msats != null && msats > 0
              ? (msats / 1000).ceil()
              : 0,
      statusUrl:
          pick([body['status_url'], nested is Map ? nested['status_url'] : null])
              as String?,
      expiresAt: expiresAt,
      status: readStatus(pick([body['status'], nested is Map ? nested['status'] : null])),
      userAdmitted: userAdmitted,
    );
  }

  /// Reads a poll of the status route.
  static AdmissionInvoiceStatus readInvoiceStatus(Object? body) {
    if (body is! Map) return AdmissionInvoiceStatus.unknown;
    return readStatus(body['status']);
  }

  /// Reads the relay's admission answer. `null` rather than `false` for
  /// anything unrecognised — an nginx error page or an HTML login screen says
  /// nothing about whether this key has paid, and reading it as "no" would
  /// charge somebody twice.
  static bool? readAdmission(Object? body) {
    if (body is! Map) return null;
    final value = body['userAdmitted'];
    return value is bool ? value : null;
  }

  static AdmissionInvoiceStatus readStatus(Object? value) {
    return switch (value) {
      'pending' => AdmissionInvoiceStatus.pending,
      'completed' => AdmissionInvoiceStatus.completed,
      'expired' => AdmissionInvoiceStatus.expired,
      _ => AdmissionInvoiceStatus.unknown,
    };
  }
}
