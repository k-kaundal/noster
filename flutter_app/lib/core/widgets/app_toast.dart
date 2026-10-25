import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:nostrfeed_mobile/core/theme/app_motion.dart';
import 'package:nostrfeed_mobile/core/theme/app_shapes.dart';

/// Centralized, professional toast notifications.
///
/// Replaces the ad-hoc `ScaffoldMessenger.of(context).showSnackBar(SnackBar(
/// content: Text(...)))` calls scattered across the app. One consistent look:
/// floating, rounded, with a leading icon and type-appropriate colors.
///
/// Usage:
/// ```dart
/// AppToast.success(context, 'Profile updated');
/// AppToast.error(context, 'Could not send message');
/// AppToast.info(context, 'Copied to clipboard');
/// ```
///
/// Every toast is user-closable: an ✕ button (plus horizontal swipe).
///
/// Sheets & dialogs: a toast triggered from inside a bottom sheet used to
/// render on the page's Scaffold — visually BEHIND the modal (the "toast
/// hidden below the sheet" bug). When the calling context has no Scaffold
/// of its own (sheets, dialogs), the toast is inserted into the root
/// overlay instead, floating at the TOP of the screen, above everything.
class AppToast {
  AppToast._();

  // ── Public API ─────────────────────────────────────────────────────────

  /// Positive confirmation (saved, sent, copied, published…).
  static void success(BuildContext context, String message) =>
      _show(context, message, _ToastType.success);

  /// Something went wrong. [error] can be an exception/message — noisy
  /// prefixes like "Exception: " are stripped for display.
  static void error(BuildContext context, Object error) =>
      _show(context, _cleanError(error), _ToastType.error);

  /// Neutral information.
  static void info(BuildContext context, String message) =>
      _show(context, message, _ToastType.info);

  /// Non-blocking heads-up that deserves attention but isn't an error.
  static void warning(BuildContext context, String message) =>
      _show(context, message, _ToastType.warning);

  /// Hides whatever toast is currently showing, on either channel.
  static void dismiss(BuildContext context) {
    _dismissOverlay();
    ScaffoldMessenger.maybeOf(context)?.hideCurrentSnackBar();
  }

  // ── Internals ──────────────────────────────────────────────────────────

  static OverlayEntry? _overlayEntry;
  static Timer? _overlayTimer;

  static String _cleanError(Object error) {
    var text = error.toString();
    text = text.replaceFirst(
      RegExp(r'^(Exception|StateError|ArgumentError|FormatException):? '),
      '',
    );
    if (text.length > 180) text = '${text.substring(0, 180)}…';
    return text;
  }

  static (IconData, Color, Color) _style(ColorScheme scheme, _ToastType type) {
    return switch (type) {
      _ToastType.success => (
          Icons.check_circle_rounded,
          scheme.inverseSurface,
          scheme.onInverseSurface,
        ),
      _ToastType.error => (
          Icons.error_rounded,
          scheme.errorContainer,
          scheme.onErrorContainer,
        ),
      _ToastType.warning => (
          Icons.warning_amber_rounded,
          scheme.tertiaryContainer,
          scheme.onTertiaryContainer,
        ),
      _ToastType.info => (
          Icons.info_rounded,
          scheme.inverseSurface,
          scheme.onInverseSurface,
        ),
    };
  }

  static void _show(BuildContext context, String message, _ToastType type) {
    // The toast can only hide behind a sheet when the calling context has
    // no Scaffold of its own — then the root messenger renders it on the
    // page UNDER the modal. Sheet/dialog contexts take the overlay path.
    final messenger = ScaffoldMessenger.maybeOf(context);
    final hasLocalScaffold = Scaffold.maybeOf(context) != null;
    if (messenger == null || !hasLocalScaffold) {
      _showViaOverlay(context, message, type);
      return;
    }

    final scheme = Theme.of(context).colorScheme;
    final (icon, bg, fg) = _style(scheme, type);

    // Clear any toast currently showing so rapid taps don't queue a stack.
    messenger
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          behavior: SnackBarBehavior.floating,
          dismissDirection: DismissDirection.horizontal,
          // Every toast is user-closable.
          showCloseIcon: true,
          closeIconColor: fg.withValues(alpha: 0.8),
          margin: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          shape: RoundedRectangleBorder(
            borderRadius: AppShapes.radiusLg,
          ),
          backgroundColor: bg,
          duration: Duration(
            milliseconds: type == _ToastType.error ? 4000 : 2600,
          ),
          content: Row(
            children: [
              Icon(icon, color: fg, size: 20),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  message,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: fg,
                    fontWeight: FontWeight.w500,
                    height: 1.3,
                  ),
                ),
              ),
            ],
          ),
        ),
      );
  }

  // ── Overlay path (sheets / dialogs — always above, top of screen) ──────

  static void _showViaOverlay(
    BuildContext context,
    String message,
    _ToastType type,
  ) {
    _dismissOverlay(); // one toast at a time, same rule as the snackbars
    final overlay = Navigator.of(context, rootNavigator: true).overlay;
    if (overlay == null) return;

    final scheme = Theme.of(context).colorScheme;
    final (icon, bg, fg) = _style(scheme, type);
    final topPad = MediaQuery.of(context).padding.top;

    final entry = OverlayEntry(
      builder: (_) => Positioned(
        // TOP of the screen — sheets own the bottom; the top is always
        // free, always visible, and never covers the sheet's buttons.
        top: topPad + 12,
        left: 16,
        right: 16,
        child: _OverlayToastCard(
          icon: icon,
          background: bg,
          foreground: fg,
          message: message,
          onClose: _dismissOverlay,
        ),
      ),
    );
    _overlayEntry = entry;
    overlay.insert(entry);

    _overlayTimer = Timer(
      Duration(milliseconds: type == _ToastType.error ? 4000 : 2600),
      _dismissOverlay,
    );
  }

  static void _dismissOverlay() {
    _overlayTimer?.cancel();
    _overlayTimer = null;
    _overlayEntry?.remove();
    _overlayEntry = null;
  }
}

/// The floating card used by the overlay path — same look as the SnackBar,
/// with an explicit close button and swipe-to-dismiss.
class _OverlayToastCard extends StatelessWidget {
  final IconData icon;
  final Color background;
  final Color foreground;
  final String message;
  final VoidCallback onClose;

  const _OverlayToastCard({
    required this.icon,
    required this.background,
    required this.foreground,
    required this.message,
    required this.onClose,
  });

  @override
  Widget build(BuildContext context) {
    final card = Material(
      elevation: 8,
      borderRadius: AppShapes.radiusLg,
      color: background,
      child: Dismissible(
        key: const Key('app_toast_overlay'),
        direction: DismissDirection.horizontal,
        onDismissed: (_) => onClose(),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 6, 12),
          child: Row(
            children: [
              Icon(icon, color: foreground, size: 20),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  message,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: foreground,
                    fontWeight: FontWeight.w500,
                    height: 1.3,
                  ),
                ),
              ),
              IconButton(
                icon: Icon(Icons.close_rounded,
                    color: foreground.withValues(alpha: 0.8), size: 20),
                tooltip: 'Dismiss',
                visualDensity: VisualDensity.compact,
                onPressed: onClose,
              ),
            ],
          ),
        ),
      ),
    );

    // Slide down from the top, per the motion tokens (ADR-0003).
    return card
        .animate()
        .fadeIn(duration: AppMotion.fast)
        .slideY(begin: -0.4, end: 0, duration: AppMotion.fast);
  }
}

enum _ToastType { success, error, warning, info }
