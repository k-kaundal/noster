import 'package:flutter/material.dart';

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
class AppToast {
  AppToast._();

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

  static String _cleanError(Object error) {
    var text = error.toString();
    text = text.replaceFirst(
      RegExp(r'^(Exception|StateError|ArgumentError|FormatException):? '),
      '',
    );
    if (text.length > 180) text = '${text.substring(0, 180)}…';
    return text;
  }

  static void _show(BuildContext context, String message, _ToastType type) {
    final messenger = ScaffoldMessenger.maybeOf(context);
    if (messenger == null) return;
    final scheme = Theme.of(context).colorScheme;

    final (icon, bg, fg) = switch (type) {
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

    // Clear any toast currently showing so rapid taps don't queue a stack.
    messenger
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          behavior: SnackBarBehavior.floating,
          dismissDirection: DismissDirection.horizontal,
          margin: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
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
                  style: TextStyle(
                    color: fg,
                    fontWeight: FontWeight.w500,
                    fontSize: 14,
                    height: 1.3,
                  ),
                ),
              ),
            ],
          ),
        ),
      );
  }
}

enum _ToastType { success, error, warning, info }
