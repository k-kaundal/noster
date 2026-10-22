import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/features/wallet/data/lnbits_live_service.dart';

void main() {
  // The realtime wallet channel: frames pushed over
  // wss://host/api/v1/ws/{inkey}. LNbits has TWO documented shapes —
  // the typed event (docs 2026) and the {balance, payment} envelope
  // (v1 UI) — and the parser must handle both, or payments silently
  // never refresh the wallet.
  group('LnbitsLivePayment.tryParse', () {
    test('typed payment event (sats, incoming)', () {
      final p = LnbitsLivePayment.tryParse(
        '{"type":"payment","payment_hash":"abc123","amount":1000,'
        '"status":"success","memo":"Coffee"}',
      );
      expect(p, isNotNull);
      expect(p!.amountMsat, 1000 * 1000);
      expect(p.paymentHash, 'abc123');
      expect(p.memo, 'Coffee');
      expect(p.status, 'success');
      expect(p.isIncoming, isTrue);
    });

    test('balance envelope (msat, incoming)', () {
      final p = LnbitsLivePayment.tryParse(
        '{"balance":123000,"payment":{"payment_hash":"def456",'
        '"amount":5000,"memo":"zap","status":"success"}}',
      );
      expect(p, isNotNull);
      expect(p!.amountMsat, 5000);
      expect(p.balanceMsat, 123000);
      expect(p.paymentHash, 'def456');
      expect(p.isIncoming, isTrue);
    });

    test('outgoing payment (negative amount) is not incoming', () {
      final p = LnbitsLivePayment.tryParse(
        '{"balance":100000,"payment":{"amount":-21000,"status":"success"}}',
      );
      expect(p, isNotNull);
      expect(p!.isIncoming, isFalse);
    });

    test('pending status is preserved (banner filters it out)', () {
      final p = LnbitsLivePayment.tryParse(
        '{"type":"payment","amount":100,"status":"pending"}',
      );
      expect(p!.status, 'pending');
    });

    test('garbage frames return null (never crash the socket)', () {
      expect(LnbitsLivePayment.tryParse('not json'), isNull);
      expect(LnbitsLivePayment.tryParse('{}'), isNull);
      expect(LnbitsLivePayment.tryParse('[1,2,3]'), isNull);
      expect(LnbitsLivePayment.tryParse('{"type":"keepalive"}'), isNull);
    });
  });
}
