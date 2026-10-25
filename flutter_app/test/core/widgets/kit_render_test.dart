import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/theme/app_theme.dart';
import 'package:nostrfeed_mobile/core/widgets/empty_state.dart';
import 'package:nostrfeed_mobile/core/widgets/error_view.dart';
import 'package:nostrfeed_mobile/core/widgets/skeleton.dart';

void main() {
  testWidgets('shared kit renders in both themes', (tester) async {
    tester.view.physicalSize = const Size(400, 800);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    for (final theme in [AppTheme.lightTheme, AppTheme.darkTheme, AppTheme.oledTheme]) {
      await tester.pumpWidget(MaterialApp(
        theme: theme,
        home: Scaffold(
          body: ListView(
            children: const [
              SizedBox(
                height: 260,
                child: EmptyState(
                  icon: Icons.inbox_rounded,
                  title: 'Nothing here yet',
                  subtitle: 'When something arrives, it shows up here.',
                ),
              ),
              SizedBox(
                height: 220,
                child: ErrorView(message: 'Could not load this content.'),
              ),
              SkeletonListTile(),
            ],
          ),
        ),
      ));
      // Just verify everything lays out without overflow exceptions.
      expect(tester.takeException(), isNull);
      expect(find.text('Nothing here yet'), findsOneWidget);
      expect(find.text('Could not load this content.'), findsOneWidget);
    }
  });
}
