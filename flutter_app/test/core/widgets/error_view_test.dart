import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/widgets/empty_state.dart';
import 'package:nostrfeed_mobile/core/widgets/error_view.dart';

Widget _wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

void main() {
  group('ErrorView', () {
    testWidgets('shows message and retry button', (tester) async {
      var retried = false;
      await tester.pumpWidget(_wrap(ErrorView(
        message: 'Something broke',
        onRetry: () => retried = true,
      )));
      expect(find.text('Something broke'), findsOneWidget);
      await tester.tap(find.text('Retry'));
      expect(retried, isTrue);
    });

    testWidgets('hides retry when onRetry is null', (tester) async {
      await tester.pumpWidget(_wrap(const ErrorView(message: 'oops')));
      expect(find.text('Retry'), findsNothing);
    });

    testWidgets('fromError strips Exception prefix', (tester) async {
      await tester.pumpWidget(_wrap(ErrorView.fromError(
        Exception('boom happened'),
      )));
      expect(find.text('boom happened'), findsOneWidget);
    });
  });

  group('EmptyState', () {
    testWidgets('renders icon, title, subtitle and action', (tester) async {
      await tester.pumpWidget(_wrap(const EmptyState(
        icon: Icons.inbox,
        title: 'Nothing here',
        subtitle: 'Come back later',
        action: Text('ACTION'),
      )));
      expect(find.byIcon(Icons.inbox), findsOneWidget);
      expect(find.text('Nothing here'), findsOneWidget);
      expect(find.text('Come back later'), findsOneWidget);
      expect(find.text('ACTION'), findsOneWidget);
    });

    testWidgets('omits subtitle when null', (tester) async {
      await tester.pumpWidget(_wrap(const EmptyState(
        icon: Icons.inbox,
        title: 'Empty',
      )));
      expect(find.text('Empty'), findsOneWidget);
    });
  });
}
