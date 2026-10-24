import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/utils/encrypted_content.dart';

void main() {
  group('isEncryptedContent', () {
    // The exact content from the user report — a NIP-44/ecash-style base64
    // token that leaked into the feed as a "post".
    const userReport =
        'sbkimdm1:BEOdRvjSKofk6UHw:vYReF1SM1SaeQBDEKwQwVNRt+OaV4jw71ZJm5U74vgQzwHEFSgVPvRbrQpg+9uRlE0h6ZOavKHbQur8hPlp/Ar9ovKon2cPIlJfmDUkNnhXzgsK2WfIuOF7iWkI7XnGZVyBGg8VZuW/00R79oMVW6oXnmzHbJEfbjWxjoP5foyTtxvNXAmALPkLvM2DShsqCXqRn+B5rw/EevIBPPEkw22Ofu7UXDZb4YwApXJKhIPA7kginEeF+WY3j113ZWu27HWitOnIvbGXcp2xIm67+gDBU8Bam4QTlsgEtarG4X0pF4ExIrQ5pAlhDhgPxOsxaPZxyZ0gzX8Iq8xQU725LbceqNg==';

    test('the reported base64 token is detected', () {
      expect(isEncryptedContent(userReport), isTrue);
    });

    test('NIP-04 DM format (<base64>?iv=<base64>)', () {
      expect(isEncryptedContent('YWJjZGVmZ2hpams=?iv=MTIzNDU2Nzg5MA=='), isTrue);
    });

    test('ecash token (cashuA/cashuB)', () {
      expect(isEncryptedContent('cashuBo2F0gaJhUg8NbGljZnJhbWVudA=='), isTrue);
      expect(isEncryptedContent('cashuAeyJ0b2tlbiI6W3sibWludCI6Imh0dHA'), isTrue);
    });

    test('colon-separated ciphertext segments', () {
      expect(isEncryptedContent('abc123def:ghi456jkl:mno789pqr=='), isTrue);
    });

    test('a long unbroken base64 run is ciphertext', () {
      expect(isEncryptedContent('A' * 200), isTrue);
    });

    // ── Safe cases: real writing is NEVER flagged ────────────────────
    test('normal prose is not flagged', () {
      expect(isEncryptedContent('gm everyone! happy friday'), isFalse);
    });

    test('multilingual content is not flagged', () {
      expect(isEncryptedContent('これはテストです مرحبا नमस्ते'), isFalse);
    });

    test('a URL post is not flagged', () {
      expect(
        isEncryptedContent('check this https://nostr.build/i/abc123.jpg'),
        isFalse,
      );
    });

    test('prose containing a base64-ish word is not flagged', () {
      // Spaces make it prose, not a payload.
      expect(
        isEncryptedContent('my code is abc123def456 and it works great'),
        isFalse,
      );
    });

    test('empty is not flagged', () {
      expect(isEncryptedContent(''), isFalse);
      expect(isEncryptedContent('   '), isFalse);
    });

    test('a short token is not flagged', () {
      expect(isEncryptedContent('abc123'), isFalse);
    });
  });
}
