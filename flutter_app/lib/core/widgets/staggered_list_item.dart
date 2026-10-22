import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';

import 'package:nostrfeed_mobile/core/theme/app_motion.dart';

/// One item in a staggered list entrance: fades in and rises slightly,
/// delayed by [index] × [AppMotion.stagger]. The "items arriving" feel of
/// Instagram's feed, for ~0 cost.
///
/// Use for any list row that appears on first load — search results,
/// settings rows, profile tabs. Do NOT use on every PostCard in an infinite
/// feed (an item built on every scroll frame would re-animate; PostCard has
/// its own one-shot fade instead).
class StaggeredListItem extends StatelessWidget {
  final int index;
  final Widget child;

  /// Cap on the stagger so item 500 doesn't wait 15 s.
  static const _maxDelayItems = 10;

  const StaggeredListItem({super.key, required this.index, required this.child});

  @override
  Widget build(BuildContext context) {
    final delayItems = index > _maxDelayItems ? _maxDelayItems : index;
    return child
        .animate(delay: AppMotion.stagger * delayItems)
        .fadeIn(duration: AppMotion.normal, curve: AppMotion.curve)
        .slideY(
          begin: 0.06,
          end: 0,
          duration: AppMotion.normal,
          curve: AppMotion.curve,
        );
  }
}
