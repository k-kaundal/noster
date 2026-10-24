import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

/// The HTTP headers every network image request sends. A real browser
/// User-Agent is REQUIRED — many CDNs/hosts 403 the default Dart (empty) UA
/// on Android but serve iOS fine (the "images load on iOS, fail on Android"
/// cause). Accept narrows to images. Use this for every CachedNetworkImage
/// that isn't going through SmartNetworkImage/SafeAvatar.
const Map<String, String> kImageHttpHeaders = {
  'Accept': 'image/avif,image/webp,image/*,*/*;q=0.8',
  'User-Agent':
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
};

/// Network image that picks the right decoder for the URL.
///
/// `CachedNetworkImage` throws `Invalid image data` on SVGs — they aren't
/// raster data and the platform codec can't read them. Profile pictures and
/// media URLs in the wild turn out to be SVGs often enough (project logos,
/// favicons used as avatars) that every load site shouldn't have to remember
/// this.
class SmartNetworkImage extends StatelessWidget {
  final String url;
  final double? width;
  final double? height;
  final BoxFit fit;
  final Widget Function(BuildContext, String)? placeholder;
  final Widget Function(BuildContext, String, Object)? errorWidget;

  const SmartNetworkImage({
    super.key,
    required this.url,
    this.width,
    this.height,
    this.fit = BoxFit.cover,
    this.placeholder,
    this.errorWidget,
  });

  bool get _isSvg {
    final lower = url.toLowerCase();
    return lower.endsWith('.svg') || lower.contains('.svg?');
  }

  @override
  Widget build(BuildContext context) {
    if (_isSvg) {
      return SvgPicture.network(
        url,
        width: width,
        height: height,
        fit: fit,
        placeholderBuilder: placeholder != null
            ? (context) => placeholder!(context, url)
            : null,
        errorBuilder: errorWidget != null
            ? (context, error, _) => errorWidget!(context, url, error)
            : null,
      );
    }

    // Decode at display size (ADR-0004): a 4000×3000 photo rendered as a
    // 44 px avatar costs ~48 MB decoded RAM vs ~0.6 MB — across a fast
    // scroll of avatars this is the feed memory trap. memCache* downscales
    // the decoded bitmap; the device pixel ratio keeps it crisp on 3x
    // screens. Full-res decode is only for detail/fullscreen views (those
    // use CachedNetworkImage directly).
    final dpr = MediaQuery.devicePixelRatioOf(context);
    final memW = width != null ? (width! * dpr).round() : null;
    final memH = height != null ? (height! * dpr).round() : null;

    return CachedNetworkImage(
      imageUrl: url,
      width: width,
      height: height,
      fit: fit,
      memCacheWidth: memW,
      memCacheHeight: memH,
      // A real browser UA — some hosts 403 the default Dart (empty) UA on
      // Android but serve iOS (the "images fail on Android" cause).
      httpHeaders: kImageHttpHeaders,
      placeholder: placeholder,
      errorWidget: errorWidget,
    );
  }
}
