import 'dart:convert';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:hex/hex.dart';
import 'package:http/http.dart' as http;
import 'package:image_picker/image_picker.dart';
import 'package:nostrfeed_mobile/core/config/env.dart';
import 'package:nostrfeed_mobile/core/nostr/nostr_service.dart';
import 'package:nostrfeed_mobile/features/auth/data/auth_service.dart';

/// Blossom media upload service.
///
/// Uploads files to Blossom servers (NIP-B7) with Nostr authentication.
/// Falls back through the configured server list until one succeeds.
class UploadService {
  final AuthService _authService;
  final NostrService _nostrService;

  UploadService(this._authService, this._nostrService);

  List<String> get _servers {
    const configured = Env.blossomServers;
    if (configured.isNotEmpty) {
      return configured.split(',').map((s) => s.trim()).toList();
    }
    return Env.defaultBlossomServers;
  }

  /// Upload an image picked from gallery/camera. Returns the public URL.
  Future<String> uploadImage(XFile file) async {
    final bytes = await file.readAsBytes();
    final mimeType = _mimeType(file.name);
    return uploadBytes(bytes, mimeType, file.name);
  }

  /// Upload raw bytes. Returns the public URL.
  ///
  /// Blossom BUD-01 specifies PUT with the raw file bytes as the request body
  /// and the file's MIME type as Content-Type. The old code sent a POST
  /// multipart, which most Blossom servers reject or ignore.
  Future<String> uploadBytes(
      Uint8List bytes, String mimeType, String fileName) async {
    final auth = await _authService.getStoredAuth();
    if (!auth.isLoggedIn || auth.privateKey == null) {
      throw StateError('Log in to upload files');
    }

    // SHA-256 hash of the file — required by Blossom
    final hash = sha256.convert(bytes);
    final hashHex = HEX.encode(hash.bytes);

    // Build the Blossom auth event (kind 24242, per BUD-02)
    final expiration =
        (DateTime.now().millisecondsSinceEpoch ~/ 1000) + 300; // 5 min
    final authEvent = _nostrService.authService.signEvent(
      privateKey: auth.privateKey!,
      kind: 24242,
      content: 'Upload $fileName',
      tags: [
        ['t', 'upload'],
        ['x', hashHex],
        ['expiration', expiration.toString()],
      ],
    );
    final authHeader =
        'Nostr ${base64Encode(utf8.encode(jsonEncode(authEvent.toJson())))}';

    Exception? lastError;
    for (final server in _servers) {
      try {
        // BUD-01: PUT /upload with raw bytes, not multipart
        final uri = Uri.parse('$server/upload');
        final request = http.Request('PUT', uri)
          ..headers['Authorization'] = authHeader
          ..headers['Content-Type'] = mimeType
          ..headers['Content-Length'] = '${bytes.length}'
          ..bodyBytes = bytes;

        final streamed = await request.send().timeout(
          const Duration(seconds: 60),
          onTimeout: () => throw const TimeoutException('Upload timed out'),
        );
        final response = await http.Response.fromStream(streamed);

        if (response.statusCode >= 200 && response.statusCode < 300) {
          final json = jsonDecode(response.body) as Map<String, dynamic>;

          // BUD-01 returns `{url, sha256, size, type, uploaded, tags: [...]}`
          // The `url` field is the primary way to get the file's address.
          final url = json['url'] as String?;
          if (url != null && url.isNotEmpty) return url;

          // Fallback: some servers put the URL in a tags array
          final tags = (json['tags'] as List?)
                  ?.map((t) => List<String>.from(t as List))
                  .toList() ??
              [];
          for (final tag in tags) {
            if (tag.length >= 2 && tag[0] == 'url') return tag[1];
          }

          // Last resort: construct from sha256
          final returnedHash = json['sha256'] as String?;
          if (returnedHash != null) {
            return '$server/$returnedHash';
          }
          throw const FormatException('No URL in upload response');
        }
        lastError = Exception(
            'Upload failed (${response.statusCode}): ${response.body}');
      } catch (e) {
        lastError = e is Exception ? e : Exception(e.toString());
      }
    }
    throw lastError ?? Exception('All upload servers failed');
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
      'mp3' => 'audio/mpeg',
      'wav' => 'audio/wav',
      'pdf' => 'application/pdf',
      _ => 'application/octet-stream',
    };
  }
}

class TimeoutException implements Exception {
  final String message;
  const TimeoutException(this.message);
  @override
  String toString() => message;
}


