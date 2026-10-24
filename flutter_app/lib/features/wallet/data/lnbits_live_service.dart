import 'dart:async';
import 'dart:convert';

import 'package:web_socket_channel/web_socket_channel.dart';

/// One payment event pushed over the LNbits wallet websocket.
class LnbitsLivePayment {
  /// Millisatoshis. Positive = incoming, negative = outgoing.
  final int? amountMsat;
  final String? paymentHash;
  final String? memo;
  final String? status;

  /// New wallet balance (msat) when the server included it in the frame.
  final int? balanceMsat;

  const LnbitsLivePayment({
    this.amountMsat,
    this.paymentHash,
    this.memo,
    this.status,
    this.balanceMsat,
  });

  bool get isIncoming => (amountMsat ?? 0) > 0;

  /// Parses BOTH documented frame shapes:
  ///  * `{"type":"payment","payment_hash":…,"amount":1000,"status":"success","memo":…}`
  ///    (docs.lnbits.com/api/core/websockets — amount in sats)
  ///  * `{"balance":123000,"payment":{…payment object…}}`
  ///    (v1 UI `WS /api/v1/ws/<invoice_key>` — balance in msat, payment
  ///    amount in msat, negative for outgoing)
  static LnbitsLivePayment? tryParse(String raw) {
    Object? json;
    try {
      json = jsonDecode(raw);
    } catch (_) {
      return null;
    }
    if (json is! Map) return null;
    final map = Map<String, dynamic>.from(json);

    // Shape 1: typed payment event.
    if (map['type'] == 'payment') {
      final sats = (map['amount'] as num?)?.toInt();
      return LnbitsLivePayment(
        amountMsat: sats != null ? sats * 1000 : null,
        paymentHash: map['payment_hash'] as String?,
        memo: map['memo'] as String?,
        status: map['status'] as String?,
      );
    }

    // Shape 2: {balance, payment} envelope.
    final payment = map['payment'];
    if (payment is Map) {
      final p = Map<String, dynamic>.from(payment);
      return LnbitsLivePayment(
        amountMsat: (p['amount'] as num?)?.toInt(),
        paymentHash: p['payment_hash'] as String?,
        memo: p['memo'] as String?,
        status: p['status'] as String?,
        balanceMsat: (map['balance'] as num?)?.toInt(),
      );
    }
    return null;
  }
}

/// Realtime payment channel for ONE LNbits wallet:
/// `wss://{baseUrl}/api/v1/ws/{invoiceKey}`.
///
/// The wallet's invoice key is the subscription id — wallet *ids* were
/// dropped in LNbits 0.12.8 because they are public (lnbits/lnbits#2545);
/// the v1 UI connects with the invoice key. Auth is implicit in the key —
/// never log it.
///
/// Lifecycle mirrors the relay pool's rules (AGENTS.md "Reconnection
/// resilience"): sockets die when the OS idles the app, so callers get
/// [onDone] to schedule a reconnect — never assume the socket stays up.
class LnbitsLiveService {
  WebSocketChannel? _channel;
  StreamSubscription? _sub;

  bool get isConnected => _channel != null;

  /// Connects and forwards every parsed payment to [onPayment].
  ///
  /// [onDone] fires exactly once when the socket closes or errors — the
  /// caller owns the reconnect backoff policy.
  Future<void> connect({
    required String baseUrl,
    required String invoiceKey,
    required void Function(LnbitsLivePayment payment) onPayment,
    required void Function() onDone,
  }) async {
    await close();
    final wsScheme = baseUrl.startsWith('https') ? 'wss' : 'ws';
    final host = baseUrl.replaceFirst(RegExp(r'^https?://'), '');
    final uri = Uri.parse('$wsScheme://$host/api/v1/ws/$invoiceKey');
    try {
      final channel = WebSocketChannel.connect(uri);
      _channel = channel;
      _sub = channel.stream.listen(
        (data) {
          if (data is! String) return;
          final payment = LnbitsLivePayment.tryParse(data);
          if (payment != null) onPayment(payment);
        },
        onError: (_) {
          _teardown();
          onDone();
        },
        onDone: () {
          _teardown();
          onDone();
        },
        cancelOnError: true,
      );
      // Surface an immediate connect failure (bad host/TLS) instead of
      // reporting connected — the stream errors async, but `ready`
      // completes on establishment on web_socket_channel ≥2.4.
      await channel.ready.timeout(const Duration(seconds: 10));
    } catch (_) {
      _teardown();
      onDone();
    }
  }

  void _teardown() {
    _sub?.cancel();
    _sub = null;
    _channel = null;
  }

  Future<void> close() async {
    _teardown();
    try {
      await _channel?.sink.close();
    } catch (_) {}
  }
}
