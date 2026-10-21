import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/features/auth/services/auth_service.dart';
import 'package:nostrfeed_mobile/core/utils/nip19.dart';

void main() {
  test('encodeNaddr produces a valid naddr1… identifier', () {
    final auth = AuthService();
    final naddr = auth.encodeNaddr(
      identifier: 'my-article',
      pubkey: 'f1ee81bb843731c983fad98784dfe984efdd0b057bcbb5e8f16ff449787e59f6',
      kind: 30023,
      relays: const ['wss://relay.nostrfeed.com'],
    );

    print('Encoded: $naddr');
    expect(naddr.startsWith('naddr1'), true);

    // Round-trip: decode it back
    final decoded = decodeNip19(naddr);
    print('Decoded: $decoded');
    expect(decoded, isA<Nip19Address>());

    if (decoded is Nip19Address) {
      expect(decoded.identifier, 'my-article');
      expect(
        decoded.pubkey,
        'f1ee81bb843731c983fad98784dfe984efdd0b057bcbb5e8f16ff449787e59f6',
      );
      expect(decoded.kind, 30023);
      print('Round-trip OK');
    }
  });
}
