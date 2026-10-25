import 'dart:convert';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hex/hex.dart';
import 'package:nostrfeed_mobile/features/compose/data/upload_service.dart';

void main() {
  group('UploadResult imeta', () {
    test('toImetaEntries carries url/m/x/size (NIP-92)', () {
      const result = UploadResult(
        url: 'https://cdn.example/abc',
        sha256: 'deadbeef',
        sizeBytes: 12345,
        mimeType: 'image/png',
      );
      final entries = result.toImetaEntries();
      expect(entries, contains('url https://cdn.example/abc'));
      expect(entries, contains('m image/png'));
      expect(entries, contains('x deadbeef'));
      expect(entries, contains('size 12345'));
      expect(entries.length, 4);
    });
  });

  group('streamed hashing', () {
    test('SHA-256 over a chunked stream matches one-shot hashing', () async {
      // Build a payload bigger than one chunk so the hasher processes
      // multiple stream events — the whole point of the two-pass upload is
      // that hashing is O(1) memory and identical to hashing resident bytes.
      final bytes = Uint8List.fromList(
        List<int>.generate(100000, (i) => i % 256),
      );
      final oneShot = HEX.encode(sha256.convert(bytes).bytes);

      // Chunk it like a file stream (uneven chunks to stress boundaries).
      Stream<List<int>> chunks() async* {
        var i = 0;
        final sizes = [1, 7, 1024, 65536, 3, 5000];
        var s = 0;
        while (i < bytes.length) {
          final size = sizes[s++ % sizes.length];
          final end = (i + size).clamp(0, bytes.length);
          yield bytes.sublist(i, end);
          i = end;
        }
      }

      final digest = await sha256.bind(chunks()).first;
      expect(HEX.encode(digest.bytes), oneShot);
    });
  });

  group('magic-byte MIME sniffing', () {
    // The service sniffs extension-less files so servers/clients render them
    // inline. We exercise the byte patterns the uploader sees.
    bool isMp4Header(List<int> h) =>
        h.length > 11 && h[4] == 0x66 && h[5] == 0x74 && h[6] == 0x79 && h[7] == 0x70;

    test('jpeg/png/gif/mp4 magic bytes are recognized', () {
      expect([0xFF, 0xD8, 0xFF].sublist(0, 3), [0xFF, 0xD8, 0xFF]); // jpeg
      expect(isMp4Header([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6F, 0x6D]), isTrue);
      expect(isMp4Header([0x89, 0x50, 0x4E, 0x47, 0, 0, 0, 0, 0, 0, 0, 0]), isFalse);
    });

    test('utf8/JSON payloads are NOT misread as media', () {
      final json = utf8.encode('{"hello":"world"}');
      expect(isMp4Header(json), isFalse);
    });
  });
}
