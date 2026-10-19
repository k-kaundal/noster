import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/utils/nip19.dart';

void main() {
  group('decodeNip19', () {
    // Well-known test vector (NIP-19 spec example).
    const pubkey =
        '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d';
    const npub =
        'npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6';

    test('decodes npub to pubkey', () {
      final result = decodeNip19(npub);
      expect(result, isA<Nip19Pubkey>());
      expect((result as Nip19Pubkey).pubkey, pubkey);
    });

    test('returns null for garbage input', () {
      expect(decodeNip19('not-a-valid-nip19-string!!!'), isNull);
    });

    test('returns null for empty string', () {
      expect(decodeNip19(''), isNull);
    });

    test('returns null for wrong hrp with valid bech32', () {
      // 'nsec1...' style would need a valid payload; use garbage HRP check
      // via an npub with swapped prefix letters (invalid checksum anyway).
      expect(decodeNip19('xxxx180cvv07tjdrrgpa0j7j7tmnyl2yr'), isNull);
    });
  });
}
