import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:octo_image/octo_image.dart';

/// Avatar image that never crashes on HTTP errors (404/403/CDN outages) and
/// never flashes the fallback before the photo.
///
/// Two problems this solves:
///
/// 1. Raw `CachedNetworkImageProvider` inside a `CircleAvatar` propagates
///    HTTP failures as unhandled exceptions through the Image Resource
///    Service (noisy crash logs). On any load failure this silently shows
///    the [fallback] instead.
/// 2. The old version passed the fallback as the LOADING placeholder too,
///    so every avatar flashed its initial letter ("K") for a frame and then
///    hard-swapped to the photo — the "shows a small letter, then the
///    image" flicker. Now the image **fades in over** the fallback
///    (OctoImage crossfade): the initial stays until the pixels are ready,
///    then dissolves into the photo. Instagram/Telegram behavior.
///
/// Usage (drop-in for CircleAvatar + CachedNetworkImageProvider):
/// ```dart
/// SafeAvatar(
///   imageUrl: profile?.picture,
///   radius: 20,
///   fallback: Text(name[0]),
/// )
/// ```
class SafeAvatar extends StatelessWidget {
  final String? imageUrl;
  final double radius;
  final Widget? fallback;
  final Color? backgroundColor;

  const SafeAvatar({
    super.key,
    this.imageUrl,
    this.radius = 20,
    this.fallback,
    this.backgroundColor,
  });

  @override
  Widget build(BuildContext context) {
    final hasImage = imageUrl != null && imageUrl!.isNotEmpty;
    final fallbackWidget = fallback ??
        Icon(
          Icons.person_rounded,
          size: radius,
          color: Theme.of(context).colorScheme.onPrimaryContainer,
        );
    final bg =
        backgroundColor ?? Theme.of(context).colorScheme.primaryContainer;

    return CircleAvatar(
      radius: radius,
      backgroundColor: bg,
      child: hasImage
          ? ClipOval(
              child: OctoImage(
                // The provider carries the headers (OctoImage has no
                // httpHeaders param): a real browser UA — some hosts 403
                // the default Dart (empty) UA on Android but serve iOS
                // (the "avatars fail on Android" cause).
                image: CachedNetworkImageProvider(
                  imageUrl!,
                  headers: const {
                    'Accept': 'image/avif,image/webp,image/*,*/*;q=0.8',
                    'User-Agent':
                        'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
                  },
                ),
                width: radius * 2,
                height: radius * 2,
                fit: BoxFit.cover,
                // Display-size decode (ADR-0004): avatars are small; a
                // 4000 px source photo decoded per avatar is the feed
                // memory trap.
                memCacheWidth:
                    (radius * 2 * MediaQuery.devicePixelRatioOf(context))
                        .round(),
                memCacheHeight:
                    (radius * 2 * MediaQuery.devicePixelRatioOf(context))
                        .round(),
                // The fix for the flicker: keep the fallback visible while
                // loading and CROSSFADE the photo in on top of it — no
                // letter → image hard swap. OctoImage's placeholderBuilder +
                // fadeInDuration does exactly this.
                placeholderBuilder: (_) => _filled(bg, fallbackWidget),
                fadeInDuration: const Duration(milliseconds: 250),
                // On ANY load failure show the fallback — never propagate.
                errorBuilder: (_, _, _) => _filled(bg, fallbackWidget),
              ),
            )
          : fallbackWidget,
    );
  }

  /// Fill the avatar circle so the placeholder/error states are a solid
  /// disc, not the raw letter floating on the CircleAvatar background.
  Widget _filled(Color bg, Widget child) {
    return Container(
      width: radius * 2,
      height: radius * 2,
      color: bg,
      alignment: Alignment.center,
      child: child,
    );
  }
}
