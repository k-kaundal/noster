import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/nostr/report_types.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';

/// NIP-56 (kind 1984) report flow — required by Google Play's child-safety
/// review ("allows users to report child safety concerns in-app").
///
/// Usage:
/// ```dart
/// showReportDialog(context, eventId: e.id, pubkey: e.pubkey);  // report a post
/// showReportDialog(context, pubkey: pk);                        // report a profile
/// ```
///
/// The child-safety option is FIRST and visually distinct — Google checks
/// for it explicitly during review.
Future<void> showReportDialog(
  BuildContext context, {
  String? eventId,
  String? pubkey,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
    ),
    builder: (_) => _ReportSheet(eventId: eventId, pubkey: pubkey),
  );
}

class _ReportSheet extends ConsumerStatefulWidget {
  final String? eventId;
  final String? pubkey;

  const _ReportSheet({this.eventId, this.pubkey});

  @override
  ConsumerState<_ReportSheet> createState() => _ReportSheetState();
}

class _ReportSheetState extends ConsumerState<_ReportSheet> {
  Nip56ReportType _selected = Nip56ReportType.illegal;
  final _detailsController = TextEditingController();
  bool _submitting = false;

  @override
  void dispose() {
    _detailsController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final auth = ref.read(authStateProvider);
    if (!auth.isLoggedIn || auth.isReadOnly) {
      AppToast.warning(context, 'Log in to submit a report');
      return;
    }
    setState(() => _submitting = true);
    try {
      final nostr = ref.read(nostrServiceProvider);
      final details = _detailsController.text.trim();
      final reason = details.isEmpty
          ? 'Reported as ${_selected.type}'
          : '[${_selected.type}] $details';
      final report = nostr.createReport(
        eventId: widget.eventId,
        pubkey: widget.pubkey,
        reportType: _selected.type,
        reason: reason,
      );
      await nostr.publishEvent(report);
      if (!mounted) return;
      Navigator.pop(context);
      AppToast.success(
        context,
        'Report submitted. Thank you for helping keep Nostr safe.',
      );
    } catch (e) {
      if (mounted) AppToast.error(context, 'Could not submit report: $e');
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;

    return Padding(
      padding: EdgeInsets.only(bottom: bottomInset),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Handle + header
            Center(
              child: Container(
                margin: const EdgeInsets.symmetric(vertical: 12),
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: colorScheme.outlineVariant,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
              child: Row(
                children: [
                  Icon(Icons.flag_rounded, color: colorScheme.error),
                  const SizedBox(width: 10),
                  Text(
                    'Report ${widget.eventId != null ? 'post' : 'profile'}',
                    style: Theme.of(context).textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
              child: Text(
                'Reports are published publicly (NIP-56) and reviewed by '
                'relay operators and other clients.',
                style: TextStyle(
                  fontSize: 12,
                  color: colorScheme.onSurfaceVariant,
                  height: 1.35,
                ),
              ),
            ),

            // Reason list — child safety FIRST, visually distinct.
            Flexible(
              child: ListView(
                shrinkWrap: true,
                children: [
                  _ReasonTile(
                    type: Nip56ReportType.illegal,
                    selected: _selected == Nip56ReportType.illegal,
                    emphasized: true,
                    subtitle: 'Child exploitation, abuse, or other illegal content',
                    onTap: () => setState(
                      () => _selected = Nip56ReportType.illegal,
                    ),
                  ),
                  for (final type in Nip56ReportType.values.skip(1))
                    _ReasonTile(
                      type: type,
                      selected: _selected == type,
                      onTap: () => setState(() => _selected = type),
                    ),
                ],
              ),
            ),

            // Optional details
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
              child: TextField(
                controller: _detailsController,
                maxLines: 2,
                decoration: InputDecoration(
                  hintText: 'Add details (optional)',
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 10,
                  ),
                ),
              ),
            ),

            // Submit
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
              child: FilledButton.icon(
                onPressed: _submitting ? null : _submit,
                icon: _submitting
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Icon(Icons.flag_rounded),
                label: Text(_submitting ? 'Submitting…' : 'Submit report'),
                style: FilledButton.styleFrom(
                  backgroundColor: colorScheme.error,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ReasonTile extends StatelessWidget {
  final Nip56ReportType type;
  final bool selected;
  final bool emphasized;
  final String? subtitle;
  final VoidCallback onTap;

  const _ReasonTile({
    required this.type,
    required this.selected,
    this.emphasized = false,
    this.subtitle,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final color = emphasized ? colorScheme.error : colorScheme.onSurface;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
      child: Material(
        color: selected
            ? (emphasized
                ? colorScheme.errorContainer.withValues(alpha: 0.4)
                : colorScheme.primaryContainer.withValues(alpha: 0.4))
            : Colors.transparent,
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(12),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            child: Row(
              children: [
                Icon(
                  selected
                      ? Icons.radio_button_checked
                      : Icons.radio_button_off,
                  size: 20,
                  color: selected
                      ? (emphasized ? colorScheme.error : colorScheme.primary)
                      : colorScheme.onSurfaceVariant,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        type.label,
                        style: TextStyle(
                          fontWeight: emphasized || selected
                              ? FontWeight.w600
                              : FontWeight.normal,
                          color: color,
                          fontSize: 14.5,
                        ),
                      ),
                      if (subtitle != null)
                        Text(
                          subtitle!,
                          style: TextStyle(
                            fontSize: 12,
                            color: colorScheme.onSurfaceVariant,
                          ),
                        ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
