import 'dart:convert';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:hex/hex.dart';
import 'package:http/http.dart' as http;
import 'package:image_picker/image_picker.dart';

import '../config/env.dart';
import 'auth_service.dart';
import 'nostr_service.dart';

/// Blossom media upload service.
///
/// Uploads files to Blossom servers (NIP-B7) with Nostr authentication.
/// Falls back through the configured server list until one succeeds.
class UploadService {
  final AuthService _authService;
  final NostrService _nostrService;

  UploadService(this._authService, this._nostrService);

  List<String> get _servers {
    final configured = Env.blossomServers;
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
  Future<String> uploadBytes(
      Uint8List bytes, String mimeType, String fileName) async {
    final auth = await _authService.getStoredAuth();
    if (!auth.isLoggedIn || auth.privateKey == null) {
      throw StateError('Log in to upload files');
    }

    // SHA-256 hash of the file — required by Blossom
    final hash = sha256.convert(bytes);
    final hashHex = HEX.encode(hash.bytes);

    // Build the Blossom auth event (kind 24242)
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
        final uri = Uri.parse('$server/upload');
        final request = http.MultipartRequest('POST', uri)
          ..headers['Authorization'] = authHeader
          ..files.add(http.MultipartFile.fromBytes(
            'file',
            bytes,
            filename: fileName,
          ));

        final streamed = await request.send().timeout(
          const Duration(seconds: 60),
          onTimeout: () => throw TimeoutException('Upload timed out'),
        );
        final response = await http.Response.fromStream(streamed);

        if (response.statusCode >= 200 && response.statusCode < 300) {
          final json = jsonDecode(response.body) as Map<String, dynamic>;
          final url = json['url'] as String?;
          if (url != null && url.isNotEmpty) return url;
          // Some servers return the sha256 — construct the URL
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


