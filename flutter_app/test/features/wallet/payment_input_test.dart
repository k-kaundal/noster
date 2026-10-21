import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/features/wallet/utils/payment_input.dart';

void main() {
  group('parsePaymentTarget', () {
    test('detects a bolt11 invoice', () {
      expect(parsePaymentTarget('lnbc2100n1abc').kind,
          PaymentTargetKind.invoice);
      expect(parsePaymentTarget('LNBC2100N1ABC').kind,
          PaymentTargetKind.invoice);
      expect(parsePaymentTarget('lntb100n1xyz').kind,
          PaymentTargetKind.invoice);
      expect(parsePaymentTarget('lnbcrt50p1q').kind, PaymentTargetKind.invoice);
    });

    test('strips lightning: and bitcoin: URIs', () {
      expect(parsePaymentTarget('lightning:lnbc2100n1abc').kind,
          PaymentTargetKind.invoice);
      expect(
          parsePaymentTarget('bitcoin:bc1qxyz?lightning=lnbc2100n1abc').kind,
          PaymentTargetKind.invoice);
      expect(parsePaymentTarget('lightning:alice@example.com').kind,
          PaymentTargetKind.address);
    });

    test('detects a lightning address', () {
      expect(parsePaymentTarget('alice@example.com').kind,
          PaymentTargetKind.address);
      expect(parsePaymentTarget('Alice@LN.Nostrfeed.com').value,
          'alice@ln.nostrfeed.com');
    });

    test('detects an LNURL', () {
      expect(parsePaymentTarget('lnurl1dp68gurn8ghj7abc').kind,
          PaymentTargetKind.lnurl);
    });

    test('empty and unknown', () {
      expect(parsePaymentTarget('   ').kind, PaymentTargetKind.empty);
      expect(parsePaymentTarget('lightning:').kind, PaymentTargetKind.empty);
      expect(parsePaymentTarget('not a payment').kind,
          PaymentTargetKind.unknown);
      expect(parsePaymentTarget('almost@address').kind,
          PaymentTargetKind.unknown);
    });
  });

  group('readInvoiceSats', () {
    // The bolt11 human-readable part encodes the amount in BITCOIN scaled by
    // the unit suffix: m=1e-3, u=1e-6, n=1e-9, p=1e-12. 1 BTC = 1e8 sats.
    test('reads unit-suffixed amounts in BTC → sats', () {
      expect(readInvoiceSats('lnbc1m1abc'), 100000); // 1 mBTC = 1e-3 BTC
      expect(readInvoiceSats('lnbc1u1abc'), 100); // 1 μBTC = 1e-6 BTC
      expect(readInvoiceSats('lnbc21u1abc'), 2100); // 21 μBTC
      expect(readInvoiceSats('lnbc10n1abc'), 1); // 10 nBTC = 1 sat
      expect(readInvoiceSats('lnbc2100n1abc'), 210); // 2100 nBTC = 210 sats
    });

    test('bare digits are whole BTC', () {
      // `lnbc21…` with no suffix = 21 BTC = 2.1e9 sats.
      expect(readInvoiceSats('lnbc211abc'), 2100000000);
    });

    test('amountless invoice is null, not zero', () {
      // A bare `lnbc1…` names no amount — valid, means "any amount".
      expect(readInvoiceSats('lnbc1abc'), isNull);
    });

    test('non-invoices are null', () {
      expect(readInvoiceSats('alice@example.com'), isNull);
      expect(readInvoiceSats(''), isNull);
      expect(readInvoiceSats('hello'), isNull);
    });

    test('sub-satoshi rounds up, never shows free', () {
      // 1 nBTC = 0.1 sats → rounds up to 1 rather than showing 0.
      expect(readInvoiceSats('lnbc1p1abc'), 1); // 1 pBTC = 0.0001 sats
      expect(readInvoiceSats('lnbc10p1abc'), 1);
    });
  });
}
