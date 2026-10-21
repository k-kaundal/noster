import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/theme/app_spacing.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/features/studio/providers/studio_providers.dart';

/// Create a zap goal (NIP-75 kind 9041): a fundraising target funded by
/// zapping the goal itself. Amount is entered in sats and stored in millisats.
class ZapGoalEditorSheet extends ConsumerStatefulWidget {
  const ZapGoalEditorSheet({super.key});

  static Future<void> show(BuildContext context) {
    return showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => const ZapGoalEditorSheet(),
    );
  }

  @override
  ConsumerState<ZapGoalEditorSheet> createState() => _ZapGoalEditorSheetState();
}

class _ZapGoalEditorSheetState extends ConsumerState<ZapGoalEditorSheet> {
  final _summary = TextEditingController();
  final _description = TextEditingController();
  final _amount = TextEditingController();
  final _image = TextEditingController();
  final _url = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _summary.dispose();
    _description.dispose();
    _amount.dispose();
    _image.dispose();
    _url.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final summary = _summary.text.trim();
    final amount = int.tryParse(_amount.text.trim());

    if (summary.isEmpty) {
      AppToast.warning(context, 'Give the goal a title');
      return;
    }
    if (amount == null || amount <= 0) {
      AppToast.warning(context, 'Set a target in whole sats');
      return;
    }

    setState(() => _busy = true);
    try {
      final ok = await ref.read(publishGoalProvider)(
            amountSats: amount,
            summary: summary,
            description: _description.text.trim(),
            image: _image.text.trim().isEmpty ? null : _image.text.trim(),
            url: _url.text.trim().isEmpty ? null : _url.text.trim(),
          );

      if (!mounted) return;
      if (ok) {
        Navigator.of(context).pop();
        AppToast.success(context, 'Goal published — announce it in a post');
      } else {
        AppToast.error(context, 'No relay accepted the goal — try again');
      }
    } catch (e) {
      if (mounted) AppToast.error(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Padding(
      padding: EdgeInsets.only(
        left: AppSpacing.md,
        right: AppSpacing.md,
        top: AppSpacing.md,
        bottom: MediaQuery.viewInsetsOf(context).bottom + AppSpacing.md,
      ),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'New zap goal',
              style: Theme.of(context)
                  .textTheme
                  .titleMedium
                  ?.copyWith(fontWeight: FontWeight.bold),
            ),
            AppSpacing.gapMd,
            TextField(
              controller: _summary,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(
                labelText: 'Title',
                hintText: 'New microphone',
              ),
            ),
            AppSpacing.gapSm,
            TextField(
              controller: _amount,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              decoration: InputDecoration(
                labelText: 'Target (sats)',
                prefixIcon: Icon(Icons.track_changes_rounded,
                    color: scheme.primary),
              ),
            ),
            AppSpacing.gapSm,
            TextField(
              controller: _description,
              maxLines: 3,
              decoration: const InputDecoration(
                labelText: 'What is it for?',
                hintText: 'A sentence or two — this is the goal’s content.',
              ),
            ),
            AppSpacing.gapSm,
            TextField(
              controller: _image,
              keyboardType: TextInputType.url,
              decoration: const InputDecoration(
                labelText: 'Image URL (optional)',
              ),
            ),
            AppSpacing.gapSm,
            TextField(
              controller: _url,
              keyboardType: TextInputType.url,
              decoration: const InputDecoration(
                labelText: 'Link (optional)',
                hintText: 'Where the detail lives',
              ),
            ),
            AppSpacing.gapMd,
            FilledButton.icon(
              onPressed: _busy ? null : _save,
              icon: _busy
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.publish_rounded),
              label: const Text('Publish goal'),
            ),
            AppSpacing.gapSm,
            Text(
              'A goal is funded by zaps naming it. Announce it in a post — '
              'zaps on that post count toward the goal too.',
              style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
            ),
          ],
        ),
      ),
    );
  }
}
