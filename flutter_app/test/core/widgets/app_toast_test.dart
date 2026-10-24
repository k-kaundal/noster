import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/widgets/app_sheet.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';

void main() {
  testWidgets('toast from inside a bottom sheet shows ABOVE the sheet, '
      'not behind it', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => TextButton(
              onPressed: () => AppSheet.show(
                context,
                child: Builder(
                  builder: (sheetContext) => TextButton(
                    onPressed: () =>
                        AppToast.error(sheetContext, 'Payment failed'),
                    child: const Text('toast'),
                  ),
                ),
              ),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    expect(find.text('toast'), findsOneWidget);

    await tester.tap(find.text('toast'));
    await tester.pump(); // overlay entry inserted
    await tester.pump(
      const Duration(milliseconds: 400),
    ); // entrance animation (AppMotion.fast)

    // The message is in the tree (overlay path, above the sheet).
    expect(find.text('Payment failed'), findsOneWidget);

    // And it's user-closable via the ✕ button.
    final close = find.byTooltip('Dismiss');
    expect(close, findsOneWidget);
    await tester.tap(close);
    await tester.pump();
    expect(find.text('Payment failed'), findsNothing);
  });

  testWidgets('toast on a normal page uses the snackbar path with a close '
      'icon', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => TextButton(
              onPressed: () => AppToast.success(context, 'Saved'),
              child: const Text('toast'),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.text('toast'));
    await tester.pump();

    expect(find.text('Saved'), findsOneWidget);
    // SnackBar close icon (user can dismiss any toast).
    expect(find.byIcon(Icons.close), findsOneWidget);
  });
}
