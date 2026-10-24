import 'package:nostrfeed_mobile/core/models/nostr_models.dart';

/// Media classification for URLs found in note content (NIP-92 aware).
enum MediaType { image, video, audio, other }

/// Parsed `imeta` tag (NIP-92): per-URL inline metadata.
class ImetaInfo {
  final String url;
  final String? mimeType;
  final String? blurhash;
  final String? alt;
  final (int, int)? dimensions; // (width, height)
  final List<String> fallbackUrls;

  const ImetaInfo({
    required this.url,
    this.mimeType,
    this.blurhash,
    this.alt,
    this.dimensions,
    this.fallbackUrls = const [],
  });

  double? get aspectRatio =>
      dimensions != null ? dimensions!.$1 / dimensions!.$2 : null;
}

/// URL + media helpers for note rendering.
class MediaUtils {
  MediaUtils._();

  static final _urlRegex = RegExp(r'https?://[^\s<>"\)\]]+');

  static const _imageExtensions = {
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif', 'heic', 'heif', 'bmp',
  };
  static const _videoExtensions = {
    'mp4', 'webm', 'mov', 'm4v', 'avi', 'mkv', 'm3u8', 'ts',
  };
  static const _audioExtensions = {'mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'};

  /// Known media hosts whose URLs don't carry file extensions.
  static final _mediaHosts = RegExp(
    r'(nostr\.build|blossom\.|void\.cat|image\.nostr\.build|cdn\.satellite\.earth|media\.nostr\.build|nostpic\.com|imgproxy\.|i\.nostr\.build)',
    caseSensitive: false,
  );
  static final _videoHosts = RegExp(
    r'(youtube\.com|youtu\.be|vimeo\.com|rumble\.com|odysee\.com|bitchute\.com|tiktok\.com|twitch\.tv|dailymotion\.com)',
    caseSensitive: false,
  );

  static String? _extension(String url) {
    final path = Uri.tryParse(url)?.path.toLowerCase() ?? '';
    final dot = path.lastIndexOf('.');
    if (dot < 0 || dot == path.length - 1) return null;
    final ext = path.substring(dot + 1);
    // Guard against dots in the host part (e.g. "void.cat").
    if (ext.contains('/')) return null;
    return ext;
  }

  /// Classify a URL as image / video / audio / other (link).
  static MediaType classify(String url) {
    final ext = _extension(url);
    if (ext != null) {
      if (_imageExtensions.contains(ext)) return MediaType.image;
      if (_videoExtensions.contains(ext)) return MediaType.video;
      if (_audioExtensions.contains(ext)) return MediaType.audio;
    }
    if (_videoHosts.hasMatch(url)) return MediaType.video;
    // Extensionless media hosts (Blossom, nostr.build, void.cat…) serve
    // mostly images — treat as image so they render inline.
    if (_mediaHosts.hasMatch(url)) return MediaType.image;
    return MediaType.other;
  }

  /// All http(s) URLs in a text.
  static List<String> extractUrls(String text) =>
      _urlRegex.allMatches(text).map((m) => m.group(0)!).toList();

  // ── Media CDN optimization (bandwidth + speed) ──────────────────────

  /// Hosts that serve on-the-fly resized variants via a query param:
  /// - nostr.build / blossom.nostr.build: `?w=720` (or `?w=720p`)
  /// - image.nostr.build, i.nostr.build, video.nostr.build thumbs
  /// These are FREE CDNs run for Nostr (nostr.build since 2022) — using
  /// them cuts image bandwidth ~80-90% vs the full-size original.
  static final _resizableCdnHosts = RegExp(
    r'(^|\.)(nostr\.build|blossom\.band)$',
    caseSensitive: false,
  );

  /// Rewrite a media URL to a CDN-resized variant at [width] px when the
  /// host supports it — a feed tile never needs the original 4000 px
  /// upload. Returns the original URL unchanged for non-CDN hosts (we
  /// can't assume arbitrary hosts resize).
  ///
  /// Feed tiles use width ≈1080 (memCache caps decode anyway); profile
  /// avatars use 192; banners 1200. See ADR-0004 (size budget) — this is
  /// the network-side half of it (memCache is the decode-side half).
  static String optimizedImageUrl(String url, {int width = 1080}) {
    final uri = Uri.tryParse(url);
    if (uri == null) return url;
    if (!_resizableCdnHosts.hasMatch(uri.host)) return url;
    // Already resized — don't stack params.
    if (uri.queryParameters.containsKey('w')) return url;
    return uri.replace(queryParameters: {...uri.queryParameters, 'w': '$width'}).toString();
  }

  /// Parse all `imeta` tags from an event into URL → info map (NIP-92).
  static Map<String, ImetaInfo> parseImeta(NostrEvent event) {
    final result = <String, ImetaInfo>{};
    for (final tag in event.tags) {
      if (tag.isEmpty || tag[0] != 'imeta') continue;
      String? url;
      String? mime;
      String? blurhash;
      String? alt;
      (int, int)? dim;
      final fallbacks = <String>[];
      for (var i = 1; i < tag.length; i++) {
        final entry = tag[i];
        final space = entry.indexOf(' ');
        if (space < 0) continue;
        final key = entry.substring(0, space);
        final value = entry.substring(space + 1);
        switch (key) {
          case 'url':
            url = value;
          case 'm':
            mime = value;
          case 'blurhash':
            blurhash = value;
          case 'alt':
            alt = value;
          case 'fallback':
            fallbacks.add(value);
          case 'dim':
            final parts = value.split('x');
            if (parts.length == 2) {
              final w = int.tryParse(parts[0]);
              final h = int.tryParse(parts[1]);
              if (w != null && h != null && h > 0) dim = (w, h);
            }
        }
      }
      if (url != null) {
        result[url] = ImetaInfo(
          url: url,
          mimeType: mime,
          blurhash: blurhash,
          alt: alt,
          dimensions: dim,
          fallbackUrls: fallbacks,
        );
      }
    }
    return result;
  }

  /// A URL plus its (optional) imeta — resolved against the event's tags.
  static (String, ImetaInfo?) withImeta(String url, NostrEvent event) {
    final map = parseImeta(event);
    return (url, map[url]);
  }
}
