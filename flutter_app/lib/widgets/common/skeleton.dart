import 'package:flutter/material.dart';
import 'package:shimmer/shimmer.dart';

/// Theme-aware shimmer skeleton primitives.
///
/// Loading placeholders used to be `Container(color: Colors.white)` — which
/// is invisible against a light background and a hard white block against a
/// dark one. These read the base and highlight from the current color scheme
/// so the same code works in both themes.
class SkeletonTheme extends StatelessWidget {
  final Widget child;

  const SkeletonTheme({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Shimmer.fromColors(
      baseColor: scheme.surfaceContainerHighest,
      highlightColor: scheme.surface,
      child: child,
    );
  }
}

/// A solid block that stands in for content that hasn't loaded yet.
/// The shimmer gradient paints over it, so the block's own color just needs
/// to be opaque enough to catch the gradient in both themes.
class SkeletonBox extends StatelessWidget {
  final double? width;
  final double? height;
  final BorderRadius? borderRadius;

  const SkeletonBox({
    super.key,
    this.width,
    this.height,
    this.borderRadius,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainerHighest,
        borderRadius: borderRadius ?? BorderRadius.circular(4),
      ),
    );
  }
}

/// A circular placeholder, for avatars.
class SkeletonCircle extends StatelessWidget {
  final double radius;

  const SkeletonCircle({super.key, this.radius = 20});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: radius * 2,
      height: radius * 2,
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainerHighest,
        shape: BoxShape.circle,
      ),
    );
  }
}

/// A line of "text" — the most common placeholder.
class SkeletonLine extends StatelessWidget {
  final double? width;
  final double height;

  const SkeletonLine({super.key, this.width, this.height = 12});

  @override
  Widget build(BuildContext context) {
    return SkeletonBox(width: width, height: height);
  }
}
