import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/theme/app_spacing.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/features/studio/models/zap_goal.dart';
import 'package:nostrfeed_mobile/features/studio/providers/studio_providers.dart';

/// A fundraising goal and how far along it is (NIP-75). Amounts are stored
/// in millisats and shown in sats.
class ZapGoalCard extends ConsumerWidget {
  final ZapGoal goal;
  final GoalProgress progress;
  final bool isOwn;

  const ZapGoalCard({
    super.key,
    required this.goal,
    required this.progress,
    this.isOwn = false,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;

    final raisedSats = (progress.raisedMsat / 1000).round();
    final targetSats = (progress.targetMsat / 1000).round();

    return Card(
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: AppSpacing.paddingMd,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.track_changes_rounded,
                    size: 18, color: scheme.primary),
                AppSpacing.gapXs,
                Expanded(
                  child: Text(
                    goal.summary ??
                        (goal.description.isNotEmpty
                            ? goal.description
                            : 'Fundraising goal'),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                ),
                if (progress.isReached)
                  _Chip(label: 'Reached', color: Colors.green)
                else if (progress.isClosed)
                  _Chip(label: 'Closed', color: scheme.onSurfaceVariant),
                if (isOwn) ...[
                  IconButton(
                    icon: const Icon(Icons.campaign_rounded, size: 20),
                    tooltip: 'Announce in a post',
                    onPressed: () => _announce(context, ref),
                  ),
                  IconButton(
                    icon: const Icon(Icons.delete_outline_rounded, size: 20),
                    tooltip: 'Retire goal',
                    onPressed: () => _confirmRetire(context, ref),
                  ),
                ],
              ],
            ),
            if (goal.summary != null && goal.description.isNotEmpty) ...[
              AppSpacing.gapXs,
              Text(
                goal.description,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style:
                    TextStyle(fontSize: 13, color: scheme.onSurfaceVariant),
              ),
            ],
            AppSpacing.gapMd,
            ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                value: progress.fraction,
                minHeight: 8,
              ),
            ),
            AppSpacing.gapXs,
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  '${_format(raisedSats)} of ${_format(targetSats)} sats',
                  style: const TextStyle(
                      fontWeight: FontWeight.w600, fontSize: 13),
                ),
                Text(
                  '${progress.percent}%',
                  style:
                      TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
                ),
              ],
            ),
            if (progress.contributorCount > 0) ...[
              AppSpacing.gapXs,
              Text(
                progress.contributorCount == 1
                    ? '1 contributor'
                    : '${progress.contributorCount} contributors',
                style:
                    TextStyle(fontSize: 11, color: scheme.onSurfaceVariant),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Future<void> _announce(BuildContext context, WidgetRef ref) async {
    final controller = TextEditingController(
      text: [
        goal.summary ?? 'I have a fundraising goal open.',
        if (goal.description.isNotEmpty) goal.description,
        "Zap this post to chip in — I'm raising "
            '${_format((progress.targetMsat / 1000).round())} sats.',
      ].join('\n\n'),
    );

    final content = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Announce this goal'),
        content: TextField(
          controller: controller,
          maxLines: 6,
          decoration: const InputDecoration(
            hintText: 'Posts as an ordinary note; zaps on it count.',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, controller.text.trim()),
            child: const Text('Post it'),
          ),
        ],
      ),
    );

    if (content == null || content.isEmpty) return;
    final ok = await ref.read(announceGoalProvider)(goal, content);
    if (context.mounted) {
      if (ok) {
        AppToast.success(context, 'Announced — zaps on that post count');
      } else {
        AppToast.error(context, 'No relay accepted the post — try again');
      }
    }
  }

  Future<void> _confirmRetire(BuildContext context, WidgetRef ref) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Retire this goal?'),
        content: const Text(
          'Relays are asked to delete it — a request, not a guarantee. '
          'Sats already sent are yours and are not affected.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Keep it'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Retire'),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      final ok = await ref.read(retireGoalProvider)(goal.event.id);
      if (context.mounted && !ok) {
        AppToast.error(context, 'No relay accepted the deletion — try again');
      }
    }
  }
}

class _Chip extends StatelessWidget {
  final String label;
  final Color color;
  const _Chip({required this.label, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        label.toUpperCase(),
        style:
            TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: color),
      ),
    );
  }
}

String _format(int sats) {
  final s = sats.toString();
  final buf = StringBuffer();
  for (var i = 0; i < s.length; i++) {
    final idx = s.length - i;
    buf.write(s[i]);
    if (idx > 1 && idx % 3 == 1) buf.write(',');
  }
  return buf.toString();
}
