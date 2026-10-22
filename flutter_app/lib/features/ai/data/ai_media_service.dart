import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:gal/gal.dart';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

/// Download / save / share for AI-generated media (images and videos).
///
/// Generated content arrives either as a `data:` URL (Gemini image models
/// return base64 inline) or an `https:` hosted URL (OpenRouter video jobs,
/// some image models) — both are resolved to raw bytes here so the UI
/// never has to care which shape came back.
class AiMediaService {
  /// Resolved bytes + suggested file extension for a generated media URL.
  static Future<({Uint8List bytes, String ext})> fetchBytes(
    String urlOrDataUrl,
  ) async {
    if (urlOrDataUrl.startsWith('data:')) {
      // data:image/png;base64,AAAA…
      final comma = urlOrDataUrl.indexOf(',');
      if (comma < 0) throw const FormatException('Malformed data URL');
      final meta = urlOrDataUrl.substring(0, comma);
      final ext = _extFromMime(meta) ?? 'png';
      final bytes = base64Decode(urlOrDataUrl.substring(comma + 1));
      return (bytes: bytes, ext: ext);
    }
    final res = await http
        .get(Uri.parse(urlOrDataUrl))
        .timeout(const Duration(seconds: 30));
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw HttpException('Download failed (${res.statusCode})');
    }
    final ext = _extFromPath(urlOrDataUrl) ??
        _extFromMime(res.headers['content-type'] ?? '') ??
        'bin';
    return (bytes: res.bodyBytes, ext: ext);
  }

  /// Saves generated media to the device gallery (Photos / Google Photos).
  static Future<void> saveToGallery(
    String urlOrDataUrl, {
    required bool isVideo,
  }) async {
    final hasAccess = await Gal.hasAccess();
    if (!hasAccess) {
      final granted = await Gal.requestAccess();
      if (!granted) {
        throw const AiMediaException(
          'Photo access was denied — enable it in system settings to save.',
        );
      }
    }
    if (isVideo) {
      final (:bytes, :ext) = await fetchBytes(urlOrDataUrl);
      final file = await _writeTemp(bytes, ext, prefix: 'ai_video');
      try {
        await Gal.putVideo(file.path);
      } finally {
        _deleteQuietly(file);
      }
    } else {
      final (:bytes, ext: _) = await fetchBytes(urlOrDataUrl);
      await Gal.putImageBytes(bytes);
    }
  }

  /// Shares generated media through the OS share sheet.
  static Future<void> share(String urlOrDataUrl, {required bool isVideo}) async {
    final (:bytes, :ext) = await fetchBytes(urlOrDataUrl);
    final file = await _writeTemp(
      bytes,
      ext,
      prefix: isVideo ? 'ai_video' : 'ai_image',
    );
    try {
      await SharePlus.instance.share(
        ShareParams(files: [XFile(file.path)]),
      );
    } finally {
      _deleteQuietly(file);
    }
  }

  static Future<File> _writeTemp(
    Uint8List bytes,
    String ext, {
    required String prefix,
  }) async {
    final dir = await getTemporaryDirectory();
    final name = '${prefix}_${DateTime.now().millisecondsSinceEpoch}.$ext';
    final file = File('${dir.path}/$name');
    return file.writeAsBytes(bytes);
  }

  static void _deleteQuietly(File file) {
    try {
      if (file.existsSync()) file.deleteSync();
    } catch (_) {}
  }

  static String? _extFromMime(String meta) {
    final m = RegExp(r'(image|video)/([a-z0-9.+-]+)').firstMatch(meta);
    if (m == null) return null;
    return switch (m.group(2)) {
      'jpeg' || 'jpg' => 'jpg',
      'png' => 'png',
      'gif' => 'gif',
      'webp' => 'webp',
      'mp4' => 'mp4',
      'quicktime' => 'mov',
      'webm' => 'webm',
      final other => other,
    };
  }

  static String? _extFromPath(String url) {
    final path = Uri.tryParse(url)?.path ?? '';
    final m = RegExp(r'\.(png|jpe?g|gif|webp|mp4|mov|webm)$', caseSensitive: false)
        .firstMatch(path);
    return m?.group(1)?.toLowerCase().replaceAll('jpeg', 'jpg');
  }
}

class AiMediaException implements Exception {
  final String message;
  const AiMediaException(this.message);

  @override
  String toString() => message;
}
