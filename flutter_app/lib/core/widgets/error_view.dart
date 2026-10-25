import 'package:flutter/material.dart';
import 'package:nostrfeed_mobile/core/theme/app_spacing.dart';

/// Shared error view for full-screen / feed error states.
///
/// Replaces the `_ErrorView` widget that was previously copy-pasted into
/// 13 different screens.
class ErrorView extends StatelessWidget {
  final String message;
  final VoidCallback? onRetry;
  final IconData icon;

  const ErrorView({
    super.key,
    required this.message,
    this.onRetry,
    this.icon = Icons.cloud_off,
  });

  /// Builds an [ErrorView] from an arbitrary error object, keeping the
  /// message short and user-friendly.
  factory ErrorView.fromError(
    Object error, {
    Key? key,
    VoidCallback? onRetry,
  }) {
    var text = error.toString();
    // Strip noisy prefixes like "Exception: " for cleaner display.
    text = text.replaceFirst(RegExp(r'^(Exception|StateError): '), '');
    if (text.length > 200) text = '${text.substring(0, 200)}…';
    return ErrorView(key: key, message: text, onRetry: onRetry);
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Center(
      child: Padding(
        padding: AppSpacing.paddingXl,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 56, color: scheme.error),
            const SizedBox(height: 16),
            Text(
              message,
              style: Theme.of(context).textTheme.titleMedium,
              textAlign: TextAlign.center,
            ),
            if (onRetry != null) ...[
              const SizedBox(height: 16),
              FilledButton.tonalIcon(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh),
                label: const Text('Retry'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
