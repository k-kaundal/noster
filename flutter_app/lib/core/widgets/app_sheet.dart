import 'package:flutter/material.dart';
import 'package:nostrfeed_mobile/core/theme/app_shapes.dart';

/// Shared bottom-sheet helpers.
///
/// Every `showModalBottomSheet` call in the app used the same boilerplate
/// (`isScrollControlled: true` + rounded top corners). Centralized here so
/// sheets look and behave consistently.
class AppSheet {
  AppSheet._();

  /// Shows a scroll-controlled modal sheet with rounded top corners and
  /// view-inset (keyboard) padding handled.
  static Future<T?> show<T>(
    BuildContext context, {
    required Widget child,
    bool isDismissible = true,
    bool enableDrag = true,
  }) {
    return showModalBottomSheet<T>(
      context: context,
      isScrollControlled: true,
      isDismissible: isDismissible,
      enableDrag: enableDrag,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(
          top: Radius.circular(AppShapes.xl),
        ),
      ),
      builder: (_) => Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.of(context).viewInsets.bottom,
        ),
        child: child,
      ),
    );
  }

  /// The app's ROOT overlay context — the context that never dies, used to
  /// open a sheet/dialog from inside another sheet (whose own context dies
  /// the moment it closes). Returns the root navigator's overlay context,
  /// or null when there is no overlay yet (app not fully built).
  ///
  /// Why this exists: a bottom sheet's own context is destroyed when the
  /// sheet closes. Opening a second sheet on it crashes MediaQuery with
  /// "Null check operator used on a null value" (the dead-context crash
  /// seen on the AI top-up flow). Open the second sheet on THIS context
  /// instead.
  static BuildContext? rootOverlayContext(BuildContext context) {
    final overlay = Navigator.of(context, rootNavigator: true).overlay;
    return overlay?.context;
  }
}

/// Shared alert-dialog helpers.
class AppDialog {
  AppDialog._();

  /// Simple confirmation dialog with Cancel / Confirm actions.
  /// Returns `true` when the user confirms.
  static Future<bool> confirm(
    BuildContext context, {
    required String title,
    required String message,
    String confirmLabel = 'Confirm',
    String cancelLabel = 'Cancel',
    bool isDestructive = false,
  }) async {
    final result = await showDialog<bool>(
      context: context,
      builder: (context) {
        final scheme = Theme.of(context).colorScheme;
        return AlertDialog(
          title: Text(title),
          content: Text(message),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: Text(cancelLabel),
            ),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(true),
              style: isDestructive
                  ? FilledButton.styleFrom(backgroundColor: scheme.error)
                  : null,
              child: Text(confirmLabel),
            ),
          ],
        );
      },
    );
    return result ?? false;
  }

  /// Simple informational dialog with a single OK button.
  static Future<void> info(
    BuildContext context, {
    required String title,
    required String message,
    String okLabel = 'OK',
  }) {
    return showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: Text(message),
        actions: [
          FilledButton(
            onPressed: () => Navigator.of(context).pop(),
            child: Text(okLabel),
          ),
        ],
      ),
    );
  }
}
