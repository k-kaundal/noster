import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';

void main() {
  Widget appWithButton(void Function(BuildContext) onTap) {
    return MaterialApp(
      home: Scaffold(
        body: Builder(
          builder: (context) => TextButton(
            onPressed: () => onTap(context),
            child: const Text('GO'),
          ),
        ),
      ),
    );
  }

  testWidgets('success toast shows message with icon', (tester) async {
    await tester.pumpWidget(
      appWithButton((c) => AppToast.success(c, 'Saved!')),
    );
    await tester.tap(find.text('GO'));
    await tester.pump();
    expect(find.text('Saved!'), findsOneWidget);
    expect(find.byIcon(Icons.check_circle_rounded), findsOneWidget);
  });

  testWidgets('error toast strips Exception prefix', (tester) async {
    await tester.pumpWidget(
      appWithButton((c) => AppToast.error(c, Exception('boom'))),
    );
    await tester.tap(find.text('GO'));
    await tester.pump();
    expect(find.text('boom'), findsOneWidget);
    expect(find.textContaining('Exception'), findsNothing);
  });

  testWidgets('a second toast replaces the first (no stacking)', (
    tester,
  ) async {
    await tester.pumpWidget(
      appWithButton((c) {
        AppToast.info(c, 'first');
        AppToast.success(c, 'second');
      }),
    );
    await tester.tap(find.text('GO'));
    await tester.pump();
    expect(find.text('second'), findsOneWidget);
  });
}
