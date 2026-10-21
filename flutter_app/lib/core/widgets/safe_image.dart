import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

/// Avatar image that never crashes on HTTP errors (404/403/CDN outages).
///
/// Raw `CachedNetworkImageProvider` inside a `CircleAvatar` propagates HTTP
/// failures as unhandled exceptions through the Image Resource Service
/// (noisy crash logs). This widget wraps the avatar with an error boundary:
/// on any load failure it silently shows the [fallback] child instead.
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
    return CircleAvatar(
      radius: radius,
      backgroundColor:
          backgroundColor ?? Theme.of(context).colorScheme.primaryContainer,
      child: hasImage
          ? ClipOval(
              child: CachedNetworkImage(
                imageUrl: imageUrl!,
                width: radius * 2,
                height: radius * 2,
                fit: BoxFit.cover,
                // On ANY load failure show the fallback — never propagate.
                errorWidget: (_, _, _) => fallbackWidget,
                placeholder: (_, _) => fallbackWidget,
              ),
            )
          : fallbackWidget,
    );
  }
}
