import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/features/ai/domain/ai_models.dart';

AiMessage _msg(String id, int chars, {AiRole role = AiRole.user}) => AiMessage(
      id: id,
      role: role,
      content: 'x' * chars,
      createdAt: DateTime.fromMillisecondsSinceEpoch(0),
    );

void main() {
  // The "AI forgot everything" bug class: a history bigger than the model's
  // context window must be trimmed BEFORE the request — oldest dropped
  // first, the new message always kept, and the drop COUNTED so the UI can
  // say so instead of the model looking forgetful.
  group('trimToContextBudget', () {
    test('a small history passes through untouched', () {
      final history = [_msg('a', 100), _msg('b', 100)];
      final window = trimToContextBudget(history);
      expect(window.messages.length, 2);
      expect(window.dropped, 0);
    });

    test('oldest messages drop first when the budget is exceeded', () {
      final history = [
        _msg('old1', 5000),
        _msg('old2', 5000),
        _msg('recent1', 5000),
        _msg('recent2', 5000),
      ];
      final window = trimToContextBudget(
        history,
        maxTotalChars: 12000,
        maxPerMessageChars: 6000,
      );
      expect(window.messages.map((m) => m.id), ['recent1', 'recent2']);
      expect(window.dropped, 2);
    });

    test('the newest message is always kept, even alone', () {
      final history = [_msg('old', 9000), _msg('new', 3000)];
      final window = trimToContextBudget(
        history,
        maxTotalChars: 4000,
        maxPerMessageChars: 4000,
      );
      expect(window.messages.single.id, 'new');
      expect(window.dropped, 1);
    });

    test('a long message keeps head AND tail (the question is at the end)',
        () {
      final content = 'HEAD${'x' * 10000}TAIL';
      final history = [
        AiMessage(
          id: 'a',
          role: AiRole.user,
          content: content,
          createdAt: DateTime.fromMillisecondsSinceEpoch(0),
        ),
      ];
      final window = trimToContextBudget(
        history,
        maxTotalChars: 20000,
        maxPerMessageChars: 2000,
      );
      final capped = window.messages.single.content;
      expect(capped.length, lessThan(2100));
      expect(capped.startsWith('HEAD'), isTrue);
      expect(capped.endsWith('TAIL'), isTrue);
    });

    test('reservedChars (system prompt + Nostr context) shrinks the window',
        () {
      final history = [_msg('a', 5000), _msg('b', 5000)];
      final window = trimToContextBudget(
        history,
        maxTotalChars: 9000,
        maxPerMessageChars: 6000,
        reservedChars: 4000,
      );
      // Budget = 9000 - 4000 = 5000 → only the newest fits.
      expect(window.messages.single.id, 'b');
      expect(window.dropped, 1);
    });

    test('an absurd reservation keeps half the budget for history', () {
      final history = [_msg('a', 4000), _msg('b', 4000)];
      final window = trimToContextBudget(
        history,
        maxTotalChars: 10000,
        reservedChars: 99999,
      );
      // Reserved clamped to maxTotalChars/2 → budget 5000 → one fits.
      expect(window.messages.single.id, 'b');
    });

    test('empty history is a no-op', () {
      final window = trimToContextBudget(const []);
      expect(window.messages, isEmpty);
      expect(window.dropped, 0);
    });
  });
}
