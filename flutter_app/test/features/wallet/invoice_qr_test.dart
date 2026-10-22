import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/features/wallet/presentation/widgets/invoice_qr.dart';

void main() {
  const bolt11 =
      'lnbc210n1pjdq2xxpp5exampleinvoiceforwidgettest00000000000000000000000000000000000';

  testWidgets('InvoiceQrView renders QR + invoice text without crashing', (
    tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(body: Center(child: InvoiceQrView(bolt11: bolt11))),
      ),
    );
    await tester.pumpAndSettle();

    // QR + invoice + copy/share buttons all render.
    expect(find.text(bolt11), findsOneWidget);
    expect(find.text('Copy'), findsOneWidget);
    expect(find.text('Share'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('showInvoiceQrDialog opens and renders the QR', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => TextButton(
              onPressed: () => showInvoiceQrDialog(context, bolt11),
              child: const Text('OPEN'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('OPEN'));
    await tester.pumpAndSettle();

    // The dialog shows the QR view (no LayoutBuilder intrinsic crash).
    expect(find.text('Invoice'), findsOneWidget);
    expect(find.text(bolt11), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
