import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:hex/hex.dart';
import 'package:http/http.dart' as http;
import 'package:image_picker/image_picker.dart';
import 'package:nostrfeed_mobile/core/config/env.dart';
import 'package:nostrfeed_mobile/core/nostr/nostr_service.dart';
import 'package:nostrfeed_mobile/features/auth/data/auth_service.dart';

/// The result of a successful upload — everything a NIP-92 `imeta` tag
/// needs. The old flow returned ONLY the url and threw the sha256 away, so
/// posted media carried no `x`/`size`/`m` metadata (feed tiles couldn't
/// reserve space, and BUD-03 re-hosting couldn't verify the content).
class UploadResult {
  /// The public URL the file is served from.
  final String url;

  /// SHA-256 of the file bytes (hex) — the Blossom `x` tag.
  final String sha256;

  /// File size in bytes — the imeta `size` tag.
  final int sizeBytes;

  /// MIME type sent with the upload — the imeta `m` tag.
  final String mimeType;

  const UploadResult({
    required this.url,
    required this.sha256,
    required this.sizeBytes,
    required this.mimeType,
  });

  /// NIP-92 imeta tag entries for this upload (url/m/x/size). Callers add
  /// `dim`/`duration`/`blurhash` themselves when they know them.
  List<String> toImetaEntries() => [
        'url $url',
        'm $mimeType',
        'x $sha256',
        'size $sizeBytes',
      ];
}

/// Blossom media upload service.
///
/// Uploads files to Blossom servers (NIP-B7) with Nostr authentication.
/// Falls back through the configured server list until one succeeds.
class UploadService {
  final AuthService _authService;
  final NostrService _nostrService;

  UploadService(this._authService, this._nostrService);

  /// The header read at the start of pass 1: used both for the SHA-256 and
  /// for magic-byte MIME sniffing when the filename has no extension.
  static const _sniffBytes = 512;

  List<String> get _servers {
    const configured = Env.blossomServers;
    if (configured.isNotEmpty) {
      return configured.split(',').map((s) => s.trim()).toList();
    }
    return Env.defaultBlossomServers;
  }

  /// Upload an image picked from gallery/camera. Returns the public URL.
  Future<String> uploadImage(XFile file) async =>
      (await uploadImageDetailed(file)).url;

  /// Upload an image picked from gallery/camera, returning the full
  /// [UploadResult] (url + sha256 + size + mime) for imeta tags.
  Future<UploadResult> uploadImageDetailed(XFile file) {
    final mimeType = _mimeType(file.name);
    return uploadStream(
      openStream: () => file.openRead(),
      length: () => file.length(),
      mimeType: mimeType,
      fileName: file.name,
    );
  }

  /// Upload raw bytes. Returns the public URL.
  ///
  /// Blossom BUD-01 specifies PUT with the raw file bytes as the request body
  /// and the file's MIME type as Content-Type. The old code sent a POST
  /// multipart, which most Blossom servers reject or ignore.
  Future<String> uploadBytes(
      Uint8List bytes, String mimeType, String fileName) async =>
      (await uploadBytesDetailed(bytes, mimeType, fileName)).url;

  /// Upload raw bytes, returning the full [UploadResult].
  Future<UploadResult> uploadBytesDetailed(
      Uint8List bytes, String mimeType, String fileName) {
    return uploadStream(
      openStream: () => Stream.value(bytes),
      length: () async => bytes.length,
      mimeType: mimeType,
      fileName: fileName,
      headerHint: bytes.length >= _sniffBytes
          ? Uint8List.fromList(bytes.sublist(0, _sniffBytes))
          : bytes,
    );
  }

  /// STREAMED upload — the file never lives fully in memory.
  ///
  /// Two passes over the byte stream (Primal's `PrimalUploadService`
  /// pattern), because the Blossom auth event's `x` tag commits to the
  /// file's SHA-256 BEFORE the PUT can start:
  ///   1. **Hash pass** — streams the bytes through SHA-256 (and captures
  ///      the first 512 B for magic-byte MIME sniffing). No byte retention.
  ///   2. **Upload pass** — re-opens the stream and pipes it into a chunked
  ///      `StreamedRequest` PUT.
  ///
  /// The old flow did `readAsBytes()` then `request.bodyBytes = bytes` — a
  /// 500 MB reel meant ~1 GB resident (the list + the request buffer) and
  /// an iOS/Android jetsam kill. Videos MUST go through this path.
  Future<UploadResult> uploadStream({
    required Stream<List<int>> Function() openStream,
    required Future<int> Function() length,
    required String mimeType,
    required String fileName,
    Uint8List? headerHint,
  }) async {
    final auth = await _authService.getStoredAuth();
    if (!auth.isLoggedIn || auth.privateKey == null) {
      throw StateError('Log in to upload files');
    }

    final sizeBytes = await length();

    // ── Pass 1: hash + sniff (nothing retained beyond the header). ─────
    final sink = _HashSink();
    var header = headerHint;
    if (header == null) {
      final captured = BytesBuilder(copy: false);
      await for (final chunk in openStream()) {
        sink.add(chunk);
        if (captured.length < _sniffBytes) {
          captured.add(chunk);
        }
      }
      header = Uint8List.fromList(captured.takeBytes());
    } else {
      await for (final chunk in openStream()) {
        sink.add(chunk);
      }
    }
    final hashHex = HEX.encode(sink.digest.bytes);

    // Extension-less files: sniff the real type from magic bytes so the
    // server (and other clients) renders it inline instead of downloading.
    final effectiveMime = mimeType == 'application/octet-stream'
        ? _sniffMime(header) ?? mimeType
        : mimeType;

    // ── Auth event (kind 24242, BUD-02). Generic content — a camera-roll
    // filename leaks in a SIGNED event sent to third-party servers.
    final expiration =
        (DateTime.now().millisecondsSinceEpoch ~/ 1000) + 300; // 5 min
    final authEvent = _nostrService.authService.signEvent(
      privateKey: auth.privateKey!,
      kind: 24242,
      content: 'Upload file',
      tags: [
        ['t', 'upload'],
        ['x', hashHex],
        ['expiration', expiration.toString()],
      ],
    );
    final authHeader =
        'Nostr ${base64Encode(utf8.encode(jsonEncode(authEvent.toJson())))}';

    // Scale the timeout with size (a fixed 60 s killed big videos on slow
    // uplinks): 45 s base + 1 s per 64 KB, capped at 10 min per attempt.
    final timeout = Duration(
      seconds: (45 + (sizeBytes >> 16)).clamp(45, 600),
    );

    // ── Pass 2: streamed PUT per server, one retry each, 429 backoff. ──
    Exception? lastError;
    for (final server in _servers) {
      for (var attempt = 0; attempt < 2; attempt++) {
        try {
          final uri = Uri.parse('$server/upload');
          final request = http.StreamedRequest('PUT', uri)
            ..headers['Authorization'] = authHeader
            ..headers['Content-Type'] = effectiveMime
            ..contentLength = sizeBytes;

          // Pipe the re-opened stream into the request as it sends. An
          // error mid-send fails the send future and lands in the catch.
          unawaited(request.sink.addStream(openStream()).then(
            (_) => request.sink.close(),
            onError: (Object e) => request.sink.close(),
          ));

          final streamed = await request.send().timeout(
            timeout,
            onTimeout: () => throw const TimeoutException('Upload timed out'),
          );
          final response = await http.Response.fromStream(streamed);

          if (response.statusCode >= 200 && response.statusCode < 300) {
            final json = jsonDecode(response.body) as Map<String, dynamic>;

            // A server that reports a DIFFERENT sha256 didn't store the
            // bytes we sent — never trust its url (content swap).
            final returnedHash = json['sha256'] as String?;
            if (returnedHash != null &&
                returnedHash.toLowerCase() != hashHex) {
              throw const FormatException(
                  'Server sha256 does not match the uploaded file');
            }

            // BUD-01 returns `{url, sha256, size, type, uploaded, tags}`.
            final url = json['url'] as String?;
            final resolved = (url != null && url.isNotEmpty)
                ? url
                : _urlFromTags(json) ??
                    (returnedHash != null ? '$server/$returnedHash' : null);
            if (resolved == null) {
              throw const FormatException('No URL in upload response');
            }
            return UploadResult(
              url: resolved,
              sha256: hashHex,
              sizeBytes: sizeBytes,
              mimeType: effectiveMime,
            );
          }

          lastError = Exception(
              'Upload failed (${response.statusCode}): ${response.body}');
          // Rate-limited: back off before hammering the next attempt/server.
          if (response.statusCode == 429) {
            await Future<void>.delayed(Duration(seconds: 2 * (attempt + 1)));
          } else if (response.statusCode == 408 ||
              response.statusCode >= 500) {
            await Future<void>.delayed(const Duration(seconds: 1));
          } else {
            break; // 4xx other than 408/429 won't heal on retry.
          }
        } catch (e) {
          lastError = e is Exception ? e : Exception(e.toString());
          if (attempt == 0) {
            await Future<void>.delayed(const Duration(milliseconds: 800));
          }
        }
      }
    }
    throw lastError ?? Exception('All upload servers failed');
  }

  /// Extract a url from the response's `tags` array, if present.
  static String? _urlFromTags(Map<String, dynamic> json) {
    final tags = (json['tags'] as List?)
        ?.map((t) => List<String>.from(t as List))
        .toList();
    if (tags == null) return null;
    for (final tag in tags) {
      if (tag.length >= 2 && tag[0] == 'url') return tag[1];
    }
    return null;
  }

  String _mimeType(String fileName) {
    final ext = fileName.split('.').last.toLowerCase();
    return switch (ext) {
      'jpg' || 'jpeg' => 'image/jpeg',
      'png' => 'image/png',
      'gif' => 'image/gif',
      'webp' => 'image/webp',
      'svg' => 'image/svg+xml',
      'mp4' => 'video/mp4',
      'mov' => 'video/quicktime',
      'webm' => 'video/webm',
      'mp3' => 'audio/mpeg',
      'wav' => 'audio/wav',
      'pdf' => 'application/pdf',
      _ => 'application/octet-stream',
    };
  }

  /// Magic-byte MIME sniffing for extension-less files.
  static String? _sniffMime(Uint8List header) {
    bool startsWith(List<int> magic) {
      if (header.length < magic.length) return false;
      for (var i = 0; i < magic.length; i++) {
        if (header[i] != magic[i]) return false;
      }
      return true;
    }

    if (startsWith(const [0xFF, 0xD8, 0xFF])) return 'image/jpeg';
    if (startsWith(const [0x89, 0x50, 0x4E, 0x47])) return 'image/png';
    if (startsWith(const [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
    if (startsWith(const [0x52, 0x49, 0x46, 0x46])) return 'image/webp';
    // ISO BMFF (mp4/mov): bytes 4..8 are 'ftyp'.
    if (header.length > 11 &&
        header[4] == 0x66 &&
        header[5] == 0x74 &&
        header[6] == 0x79 &&
        header[7] == 0x70) {
      return 'video/mp4';
    }
    return null;
  }
}

/// Incremental SHA-256 hasher — processes each chunk and DROPS it, so the
/// stream is hashed with O(1) memory (the whole point of the two-pass
/// streaming upload: a 500 MB video hashes without ever being resident).
/// Delegates to crypto's own chunked conversion.
class _HashSink {
  final _out = _SingleValueSink<Digest>();
  late final ChunkedConversionSink<List<int>> _input =
      sha256.startChunkedConversion(_out);

  void add(List<int> chunk) => _input.add(chunk);

  Digest get digest {
    _input.close();
    return _out.value!;
  }
}

/// Captures exactly one converted value (the final digest).
class _SingleValueSink<T> implements Sink<T> {
  T? value;
  @override
  void add(T data) => value = data;
  @override
  void close() {}
}

class TimeoutException implements Exception {
  final String message;
  const TimeoutException(this.message);
  @override
  String toString() => message;
}
