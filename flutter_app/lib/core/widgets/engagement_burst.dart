import 'package:flutter/material.dart';

import 'package:nostrfeed_mobile/core/theme/app_motion.dart';

/// A one-shot "activation burst" for engagement icons (like / repost / zap) —
/// the micro-delight that makes a tap feel alive in 2026 clients (X, Threads,
/// Primal all pulse on activate). Two effects, one mount:
///
///  1. **Icon pop** — the icon scales 0.6 → 1.0 with emphasis overshoot.
///  2. **Ring pulse** — a thin ring in the action's accent expands from the
///     icon and fades out (no gradient, no particle spray — stays inside the
///     Refined "quiet" language).
///
/// Plays **only when [burstKey] changes to a new non-null value** — the card
/// sets `burstKey++` on a USER TAP that ACTIVATES the action (never on
/// un-like, never on first render or a rebuild that merely shows an
/// already-liked post). This is what stops a feed full of pre-liked posts
/// from replaying 15 bursts on every scroll — the animation is an event,
/// not a state.
///
/// Feed-perf rule honoured: no AnimationController. Each burst is a
/// self-contained [TweenAnimationBuilder] that mounts, plays once (~450 ms),
/// and disposes — so a feed of cards costs zero tickers while idle.
class EngagementBurst extends StatefulWidget {
  /// The icon to render (already themed/colored by the caller).
  final Widget child;

  /// Accent for the ring pulse (like rose / repost green / zap amber).
  final Color color;

  /// Null or a monotonically increasing counter. The burst plays when this
  /// transitions from one distinct non-null value to another.
  final int? burstKey;

  const EngagementBurst({
    super.key,
    required this.child,
    required this.color,
    required this.burstKey,
  });

  @override
  State<EngagementBurst> createState() => _EngagementBurstState();
}

class _EngagementBurstState extends State<EngagementBurst> {
  /// The burstKey we last animated for — dedupes rebuilds with the same key.
  int? _playedFor;

  @override
  Widget build(BuildContext context) {
    final key = widget.burstKey;
    final shouldPlay = key != null && key != _playedFor;
    if (shouldPlay) _playedFor = key;

    return SizedBox(
      width: _kBurstField,
      height: _kBurstField,
      child: Stack(
        alignment: Alignment.center,
        children: [
          // Ring pulse — only mounted while a burst plays (self-disposing).
          if (shouldPlay)
            TweenAnimationBuilder<double>(
              key: ValueKey('ring-$key'),
              tween: Tween(begin: 0, end: 1),
              duration: _ringDuration,
              curve: AppMotion.curve,
              builder: (context, t, _) {
                // Expand 0.4 → 1.4 of the icon field, fade 0.55 → 0.
                final scale = 0.4 + t;
                final opacity = (1 - t) * 0.55;
                return Transform.scale(
                  scale: scale,
                  child: Container(
                    width: _kBurstField,
                    height: _kBurstField,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      border: Border.all(
                        color: widget.color.withValues(alpha: opacity),
                        width: 1.6,
                      ),
                    ),
                  ),
                );
              },
            ),
          // Icon pop — restarts its tween per burst (keyed), emphasis curve.
          if (shouldPlay)
            TweenAnimationBuilder<double>(
              key: ValueKey('pop-$key'),
              tween: Tween(begin: 0.6, end: 1.0),
              duration: AppMotion.normal,
              curve: AppMotion.curveEmphasis,
              builder: (context, value, child) =>
                  Transform.scale(scale: value, child: child),
              child: widget.child,
            )
          else
            widget.child,
        ],
      ),
    );
  }
}

/// The layout field the burst occupies — slightly larger than the icon so the
/// expanding ring never clips. Sized to the md action icon (18) + ring room.
const double _kBurstField = 30;
const Duration _ringDuration = Duration(milliseconds: 450);
