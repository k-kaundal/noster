import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/features/premium/services/admission_service.dart';

void main() {
  group('AdmissionService.readAdmission', () {
    test('reads the relay verdict', () {
      expect(
        AdmissionService.readAdmission({'userAdmitted': true}),
        isTrue,
      );
      expect(
        AdmissionService.readAdmission({'userAdmitted': false}),
        isFalse,
      );
    });

    test('unrecognised bodies are null, never false', () {
      // An nginx error page or HTML login screen says NOTHING about whether
      // a key has paid — reading it as "no" would charge somebody twice.
      expect(AdmissionService.readAdmission(null), isNull);
      expect(AdmissionService.readAdmission('<html>502</html>'), isNull);
      expect(AdmissionService.readAdmission({'error': 'nope'}), isNull);
      expect(AdmissionService.readAdmission({'userAdmitted': 'yes'}), isNull);
    });
  });

  group('AdmissionService.readInvoice', () {
    test('reads a documented invoice', () {
      final invoice = AdmissionService.readInvoice({
        'bolt11': 'lnbc21000n1...',
        'id': 'abc123',
        'amount_sats': 2100,
        'status': 'pending',
        'status_url': 'https://paid.example/invoices/abc123',
      })!;
      expect(invoice.bolt11, 'lnbc21000n1...');
      expect(invoice.id, 'abc123');
      expect(invoice.amountSats, 2100);
      expect(invoice.status, AdmissionInvoiceStatus.pending);
      expect(invoice.statusUrl, 'https://paid.example/invoices/abc123');
      expect(invoice.userAdmitted, isFalse);
    });

    test('reads millisats under amount without confusing the units', () {
      // nostream historically quotes msats under `amount` — reading that as
      // sats is a factor-of-a-thousand overcharge next to a QR code.
      final invoice = AdmissionService.readInvoice({
        'bolt11': 'lnbc...',
        'amount': 2100000,
      })!;
      expect(invoice.amountSats, 2100);
    });

    test('prefers amount_sats over amount', () {
      final invoice = AdmissionService.readInvoice({
        'bolt11': 'lnbc...',
        'amount_sats': 2100,
        'amount': 999999999,
      })!;
      expect(invoice.amountSats, 2100);
    });

    test('reads nested invoice shapes', () {
      final invoice = AdmissionService.readInvoice({
        'invoice': {
          'payment_request': 'lnbc...',
          'amount_sats': 500,
          'status': 'completed',
        },
      })!;
      expect(invoice.bolt11, 'lnbc...');
      expect(invoice.amountSats, 500);
      expect(invoice.status, AdmissionInvoiceStatus.completed);
    });

    test('an admitted key comes back with no invoice — an answer, not a failure', () {
      final invoice = AdmissionService.readInvoice({'userAdmitted': true})!;
      expect(invoice.userAdmitted, isTrue);
      expect(invoice.bolt11, isNull);
    });

    test('no invoice and not admitted is a failure', () {
      expect(AdmissionService.readInvoice({'amount_sats': 2100}), isNull);
      expect(AdmissionService.readInvoice(null), isNull);
      expect(AdmissionService.readInvoice('junk'), isNull);
    });

    test('reads expires_at as epoch or ISO string', () {
      final epoch = AdmissionService.readInvoice({
        'bolt11': 'lnbc...',
        'expires_at': 1735689600,
      })!;
      expect(epoch.expiresAt, 1735689600);

      final iso = AdmissionService.readInvoice({
        'bolt11': 'lnbc...',
        'expires_at': '2025-01-01T00:00:00Z',
      })!;
      expect(iso.expiresAt, 1735689600);
    });
  });

  group('AdmissionService.readInvoiceStatus', () {
    test('reads known statuses', () {
      expect(
        AdmissionService.readInvoiceStatus({'status': 'pending'}),
        AdmissionInvoiceStatus.pending,
      );
      expect(
        AdmissionService.readInvoiceStatus({'status': 'completed'}),
        AdmissionInvoiceStatus.completed,
      );
      expect(
        AdmissionService.readInvoiceStatus({'status': 'expired'}),
        AdmissionInvoiceStatus.expired,
      );
    });

    test('unknown for anything else', () {
      expect(
        AdmissionService.readInvoiceStatus({'status': 'weird'}),
        AdmissionInvoiceStatus.unknown,
      );
      expect(
        AdmissionService.readInvoiceStatus(null),
        AdmissionInvoiceStatus.unknown,
      );
      expect(
        AdmissionService.readInvoiceStatus({'other': 1}),
        AdmissionInvoiceStatus.unknown,
      );
    });
  });

  group('AdmissionService endpoint urls', () {
    test('check + invoices urls hang off the admission base', () {
      final check = AdmissionService.checkUrl('deadbeef');
      expect(check.path, '/admissions/check/deadbeef');
      expect(AdmissionService.invoicesUrl().path, '/invoices');
    });
  });
}
