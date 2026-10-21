import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/services/http_helper.dart';

void main() {
  group('ApiHttpException.userMessage', () {
    ApiHttpException make(String body, {int status = 400}) => ApiHttpException(
          statusCode: status,
          body: body,
          method: 'GET',
          url: Uri.parse('https://example.com/api'),
        );

    test('extracts FastAPI-style detail string', () {
      final e = make('{"detail": "wallet not found"}');
      expect(e.userMessage, 'wallet not found');
    });

    test('extracts message field', () {
      final e = make('{"message": "insufficient funds"}');
      expect(e.userMessage, 'insufficient funds');
    });

    test('extracts FastAPI validation list msg', () {
      final e = make('{"detail": [{"msg": "field required", "loc": ["body"]}]}',
          status: 422);
      expect(e.userMessage, 'field required');
    });

    test('falls back to raw body snippet for non-JSON', () {
      final e = make('Internal Server Error', status: 500);
      expect(e.userMessage, 'HTTP 500: Internal Server Error');
    });

    test('truncates very long bodies', () {
      final e = make('x' * 500);
      // "HTTP 400: " (10 chars) + 120-char snippet + ellipsis
      expect(e.userMessage.length, lessThanOrEqualTo(131));
      expect(e.userMessage.endsWith('…'), isTrue);
    });
  });
}
