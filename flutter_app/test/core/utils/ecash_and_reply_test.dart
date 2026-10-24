import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/utils/encrypted_content.dart';

void main() {
  group('classifyEncrypted', () {
    test('cashuA / cashuB → ecash', () {
      expect(classifyEncrypted('cashuAeyJ0b2tlbiI6W3sibWludCI6Imh0dHBzOi8vbW'),
          EncryptedKind.ecash);
      expect(classifyEncrypted('cashuBo2F0gaJhUg8NbGljZnJhbWVudA=='),
          EncryptedKind.ecash);
    });

    test('the reported colon-base64 token → colonCipher', () {
      const userReport =
          'sbkimdm1:BEOdRvjSKofk6UHw:vYReF1SM1SaeQBDEKwQwVNRt+OaV4jw71ZJm5U74vgQzwHEFSgVPvRbrQpg+9uRlE0h6ZOavKHbQur8hPlp/Ar9ovKon2cPIlJfmDUkNnhXzgsK2WfIuOF7iWkI7XnGZVyBGg8VZuW/00R79oMVW6oXnmzHbJEfbjWxjoP5foyTtxvNXAmALPkLvM2DShsqCXqRn+B5rw/EevIBPPEkw22Ofu7UXDZb4YwApXJKhIPA7kginEeF+WY3j113ZWu27HWitOnIvbGXcp2xIm67+gDBU8Bam4QTlsgEtarG4X0pF4ExIrQ5pAlhDhgPxOsxaPZxyZ0gzX8Iq8xQU725LbceqNg==';
      expect(classifyEncrypted(userReport), EncryptedKind.colonCipher);
    });

    test('NIP-04 ?iv= → nip04', () {
      expect(classifyEncrypted('YWJjZA==?iv=MTIzNA=='), EncryptedKind.nip04);
    });

    test('real prose / multilingual / URLs → null', () {
      expect(classifyEncrypted('gm everyone!'), isNull);
      expect(classifyEncrypted('これはテスト مرحبا'), isNull);
      expect(classifyEncrypted('https://nostr.build/i/abc.jpg'), isNull);
    });
  });

  group('decodeEcash', () {
    test('cashuA decodes amount + mint', () {
      final payload = {
        'token': [
          {
            'mint': 'https://mint.minibits.cash/Bitcoin',
            'proofs': [
              {'amount': 2},
              {'amount': 8},
              {'amount': 64},
            ],
          },
        ],
        'unit': 'sat',
      };
      final token = 'cashuA${base64.encode(utf8.encode(jsonEncode(payload)))}';
      final info = decodeEcash(token);
      expect(info.amountSats, 74);
      expect(info.mintHost, 'mint.minibits.cash');
      expect(info.isV4, isFalse);
    });

    test('cashuB is reported as v4, not decoded', () {
      final info = decodeEcash('cashuBo2F0gaJhUg8NbGljZnJhbWVudA==');
      expect(info.isV4, isTrue);
      expect(info.amountSats, isNull);
    });

    test('garbage returns empty info', () {
      expect(decodeEcash('cashuAnot-valid-base64!!!').amountSats, isNull);
    });
  });

  group('reply filtering (feed post rule)', () {
    NostrEvent ev(int kind, List<List<String>> tags) => NostrEvent(
          id: 'e' * 2,
          pubkey: 'p' * 2,
          createdAt: 1,
          kind: kind,
          tags: tags,
          content: 'x',
          sig: 's' * 2,
        );

    test('a kind-1 reply is NOT a feed post', () {
      final e = ev(1, [
        ['e', 'parentid', '', 'reply'],
      ]);
      expect(e.isReply, isTrue); // → filtered from the feed
    });

    test('a kind-1 quote is STILL a feed post', () {
      final e = ev(1, [
        ['q', 'a' * 64],
      ]);
      expect(e.isReply, isFalse); // → stays in the feed
    });

    test('a standalone kind-1 note is a feed post', () {
      expect(ev(1, []).isReply, isFalse);
    });

    test('a kind-20 picture post with e-tags stays', () {
      expect(
        ev(20, [
          ['e', 'someid'],
        ]).isReply,
        isFalse,
      );
    });
  });
}
