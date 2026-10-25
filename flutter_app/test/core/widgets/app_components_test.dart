import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/theme/app_theme.dart';
import 'package:nostrfeed_mobile/core/widgets/app_badge.dart';
import 'package:nostrfeed_mobile/core/widgets/app_button.dart';
import 'package:nostrfeed_mobile/core/widgets/app_card.dart';

void main() {
  Widget wrap(Widget child, ThemeData theme) => MaterialApp(
        theme: theme,
        home: Scaffold(body: Center(child: child)),
      );

  group('AppButton', () {
    testWidgets('all variants render in both themes', (tester) async {
      for (final theme in [AppTheme.lightTheme, AppTheme.darkTheme]) {
        await tester.pumpWidget(MaterialApp(
          theme: theme,
          home: Scaffold(
            body: Column(
              children: [
                AppButton.primary(label: 'Post', onPressed: () {}),
                AppButton.secondary(
                    label: 'Save', icon: Icons.save, onPressed: () {}),
                AppButton.outline(label: 'Cancel', onPressed: () {}),
                AppButton.destructive(label: 'Delete', onPressed: () {}),
                AppButton.ghost(label: 'More', onPressed: () {}),
                AppButton.primary(
                    label: 'Wide', onPressed: () {}, expand: true),
                AppButton.primary(
                    label: 'Busy', onPressed: () {}, loading: true),
              ],
            ),
          ),
        ));
        expect(tester.takeException(), isNull);
        expect(find.text('Post'), findsOneWidget);
        expect(find.byType(CircularProgressIndicator), findsOneWidget);
      }
    });

    testWidgets('loading disables the button', (tester) async {
      var tapped = false;
      await tester.pumpWidget(wrap(
        AppButton.primary(
            label: 'Go', onPressed: () => tapped = true, loading: true),
        AppTheme.lightTheme,
      ));
      await tester.tap(find.byType(FilledButton));
      expect(tapped, isFalse);
    });

    testWidgets('tap fires callback', (tester) async {
      var tapped = false;
      await tester.pumpWidget(wrap(
        AppButton.primary(label: 'Go', onPressed: () => tapped = true),
        AppTheme.lightTheme,
      ));
      await tester.tap(find.text('Go'));
      expect(tapped, isTrue);
    });
  });

  group('AppCard', () {
    testWidgets('renders child and handles tap', (tester) async {
      var tapped = false;
      await tester.pumpWidget(wrap(
        AppCard(onTap: () => tapped = true, child: const Text('inside')),
        AppTheme.darkTheme,
      ));
      expect(find.text('inside'), findsOneWidget);
      await tester.tap(find.text('inside'));
      expect(tapped, isTrue);
    });
  });

  group('AppBadge', () {
    testWidgets('hidden at zero, capped at max', (tester) async {
      await tester.pumpWidget(wrap(
        const Column(
          children: [
            AppBadge.count(count: 0, child: Icon(Icons.chat)),
            AppBadge.count(count: 150, child: Icon(Icons.notifications)),
          ],
        ),
        AppTheme.lightTheme,
      ));
      expect(find.text('0'), findsNothing);
      expect(find.text('99+'), findsOneWidget);
    });
  });

  group('StatusBadge', () {
    testWidgets('named constructors render', (tester) async {
      await tester.pumpWidget(wrap(
        const Column(
          children: [
            StatusBadge.error('LIVE'),
            StatusBadge.info('UPCOMING'),
            StatusBadge.success('ACTIVE'),
            StatusBadge.warning('EXPIRING'),
            StatusBadge(label: 'ENDED', color: Colors.grey),
          ],
        ),
        AppTheme.darkTheme,
      ));
      expect(tester.takeException(), isNull);
      expect(find.text('LIVE'), findsOneWidget);
      expect(find.text('ENDED'), findsOneWidget);
    });
  });
}
