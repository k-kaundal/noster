import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

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

    return CachedNetworkImage(
      imageUrl: url,
      width: width,
      height: height,
      fit: fit,
      placeholder: placeholder,
      errorWidget: errorWidget,
    );
  }
}
