import 'package:flutter/material.dart';

import 'package:nostrfeed_mobile/core/theme/app_spacing.dart';

/// The app's button set — one place for button styling so feature screens
/// stop hand-rolling `ElevatedButton.styleFrom(...)` variants.
///
/// Variants:
/// - [AppButton.primary] — the main call-to-action (filled, brand color).
/// - [AppButton.secondary] — supporting action (tonal, quiet).
/// - [AppButton.outline] — low-emphasis action next to a primary.
/// - [AppButton.destructive] — dangerous action (error color, always
///   confirmed by the caller first).
/// - [AppButton.ghost] — text-only, inline toolbars.
///
/// Every variant supports `loading` (spinner replaces the label, button
/// disables itself) and an optional `icon`.
class AppButton extends StatelessWidget {
  /// Primary call-to-action — one per screen region.
  const AppButton.primary({
    super.key,
    required this.label,
    required this.onPressed,
    this.icon,
    this.loading = false,
    this.expand = false,
  }) : _variant = _AppButtonVariant.primary;

  /// Quiet supporting action (tonal container).
  const AppButton.secondary({
    super.key,
    required this.label,
    required this.onPressed,
    this.icon,
    this.loading = false,
    this.expand = false,
  }) : _variant = _AppButtonVariant.secondary;

  /// Low-emphasis action with an outline.
  const AppButton.outline({
    super.key,
    required this.label,
    required this.onPressed,
    this.icon,
    this.loading = false,
    this.expand = false,
  }) : _variant = _AppButtonVariant.outline;

  /// Dangerous action (delete, block, release) — error colors.
  const AppButton.destructive({
    super.key,
    required this.label,
    required this.onPressed,
    this.icon,
    this.loading = false,
    this.expand = false,
  }) : _variant = _AppButtonVariant.destructive;

  /// Text-only button for inline toolbars and dense rows.
  const AppButton.ghost({
    super.key,
    required this.label,
    required this.onPressed,
    this.icon,
    this.loading = false,
    this.expand = false,
  }) : _variant = _AppButtonVariant.ghost;

  /// Button label. Keep verbs short ("Post", "Save", "Retry").
  final String label;

  /// Tap handler. Null disables the button (also disabled while [loading]).
  final VoidCallback? onPressed;

  /// Optional leading icon.
  final IconData? icon;

  /// Shows a spinner in place of the label and disables taps.
  final bool loading;

  /// Stretches the button to full available width.
  final bool expand;

  final _AppButtonVariant _variant;

  @override
  Widget build(BuildContext context) {
    final effectiveOnPressed = loading ? null : onPressed;

    final Widget child = loading
        ? _ButtonSpinner(variant: _variant)
        : (icon != null
            ? _IconLabel(icon: icon!, label: label)
            : Text(label));

    final Widget button = switch (_variant) {
      _AppButtonVariant.primary => FilledButton(
          onPressed: effectiveOnPressed,
          child: child,
        ),
      _AppButtonVariant.secondary => FilledButton.tonal(
          onPressed: effectiveOnPressed,
          child: child,
        ),
      _AppButtonVariant.outline => OutlinedButton(
          onPressed: effectiveOnPressed,
          child: child,
        ),
      _AppButtonVariant.destructive => FilledButton(
          onPressed: effectiveOnPressed,
          style: FilledButton.styleFrom(
            backgroundColor: Theme.of(context).colorScheme.error,
            foregroundColor: Theme.of(context).colorScheme.onError,
          ),
          child: child,
        ),
      _AppButtonVariant.ghost => TextButton(
          onPressed: effectiveOnPressed,
          child: child,
        ),
    };

    if (expand) {
      return SizedBox(width: double.infinity, child: button);
    }
    return button;
  }
}

enum _AppButtonVariant { primary, secondary, outline, destructive, ghost }

class _IconLabel extends StatelessWidget {
  const _IconLabel({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 18),
        const SizedBox(width: AppSpacing.xs),
        Flexible(child: Text(label, overflow: TextOverflow.ellipsis)),
      ],
    );
  }
}

/// Spinner shown in place of the label while [AppButton.loading] — sized to
/// the label line-height so the button doesn't jump height.
class _ButtonSpinner extends StatelessWidget {
  const _ButtonSpinner({required this.variant});

  final _AppButtonVariant variant;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final color = switch (variant) {
      _AppButtonVariant.primary => scheme.onPrimary,
      _AppButtonVariant.destructive => scheme.onError,
      _ => scheme.primary,
    };
    return SizedBox(
      height: 20,
      width: 20,
      child: CircularProgressIndicator(strokeWidth: 2, color: color),
    );
  }
}
