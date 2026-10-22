import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/widgets/app_toast.dart';
import 'package:nostrfeed_mobile/features/feed/domain/poll.dart';
import 'package:timeago/timeago.dart' as timeago;

/// Fetches kind-1018 responses for a poll, honoring the poll's declared
/// relays (NIP-88) with connected relays as a fallback.
final pollResponsesProvider =
    FutureProvider.autoDispose.family<List<NostrEvent>, NostrPoll>(
        (ref, poll) async {
  final nostr = ref.read(nostrServiceProvider);
  if (!nostr.isInitialized) await nostr.init();
  final filter = NostrFilter(
    kinds: [1018],
    tagFilters: {
      'e': [poll.id],
    },
    limit: 500,
  );
  if (poll.responseRelays.isNotEmpty) {
    final results = await Future.wait(
      poll.responseRelays
          .take(3)
          .map((url) => nostr.relayPool.queryOnRelay(url, [filter])),
    );
    final merged = results.expand((e) => e).toList();
    if (merged.isNotEmpty) return merged;
  }
  return nostr.relayPool.query([filter], timeout: const Duration(seconds: 5));
});

/// NIP-88 poll card: question, options, voting, and live tallied results.
class PollCard extends ConsumerStatefulWidget {
  final NostrEvent event;
  const PollCard({super.key, required this.event});

  @override
  ConsumerState<PollCard> createState() => _PollCardState();
}

class _PollCardState extends ConsumerState<PollCard> {
  NostrPoll? _poll;
  final Set<String> _selected = {};
  bool _votePending = false;

  @override
  void initState() {
    super.initState();
    try {
      _poll = NostrPoll.fromEvent(widget.event);
    } catch (_) {
      _poll = null;
    }
  }

  Future<void> _vote(NostrPoll poll) async {
    final auth = ref.read(authStateProvider);
    if (!auth.isLoggedIn || auth.isReadOnly) {
      AppToast.warning(context, 'Log in to vote');
      return;
    }
    if (_selected.isEmpty) return;
    HapticFeedback.selectionClick();
    setState(() => _votePending = true);
    try {
      final nostr = ref.read(nostrServiceProvider);
      final tags = <List<String>>[
        ['e', poll.id],
        for (final id in _selected) ['response', id],
        ['client', 'nostrfeed'],
      ];
      final event = nostr.authService.signEvent(
        privateKey: auth.privateKey!,
        kind: 1018,
        content: '',
        tags: tags,
      );
      // NIP-88: responses go to the poll's declared relays (fallback: ours).
      if (poll.responseRelays.isNotEmpty) {
        await nostr.relayPool.publishWithAckTo(event, poll.responseRelays);
      } else {
        nostr.publish(event);
      }
      ref.invalidate(pollResponsesProvider(poll));
      if (mounted) AppToast.success(context, 'Vote recorded');
    } catch (e) {
      if (mounted) AppToast.error(context, 'Vote failed: $e');
    } finally {
      if (mounted) setState(() => _votePending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final poll = _poll;
    if (poll == null || poll.options.length < 2) {
      return const SizedBox.shrink();
    }
    final colorScheme = Theme.of(context).colorScheme;
    final auth = ref.watch(authStateProvider);
    final responsesAsync = ref.watch(pollResponsesProvider(poll));
    final responses = responsesAsync.valueOrNull ?? [];
    final results = PollResults.tally(
      responses,
      poll,
      currentUserPubkey: auth.pubkey,
    );
    final hasVoted = results.myVotes.isNotEmpty;
    final ended = !poll.isOpen;

    return Container(
      margin: const EdgeInsets.only(top: 8),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: colorScheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: colorScheme.outlineVariant.withValues(alpha: 0.5)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.poll_rounded, size: 16, color: colorScheme.primary),
              const SizedBox(width: 6),
              Text(
                ended
                    ? 'Poll · ended'
                    : poll.multipleChoice
                        ? 'Poll · choose multiple'
                        : 'Poll · choose one',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: colorScheme.primary,
                ),
              ),
              const Spacer(),
              if (poll.endsAt != null && poll.isOpen)
                Text(
                  'ends ${timeago.format(DateTime.fromMillisecondsSinceEpoch(poll.endsAt! * 1000))}',
                  style: TextStyle(
                    fontSize: 11,
                    color: colorScheme.onSurfaceVariant,
                  ),
                ),
            ],
          ),
          const SizedBox(height: 10),
          for (final option in poll.options)
            _OptionRow(
              option: option,
              poll: poll,
              results: results,
              selected: _selected.contains(option.id),
              voted: hasVoted || ended,
              myChoice: results.myVotes.contains(option.id),
              onTap: () {
                if (hasVoted || ended || _votePending) return;
                HapticFeedback.lightImpact();
                setState(() {
                  if (poll.multipleChoice) {
                    if (_selected.contains(option.id)) {
                      _selected.remove(option.id);
                    } else {
                      _selected.add(option.id);
                    }
                  } else {
                    _selected
                      ..clear()
                      ..add(option.id);
                  }
                });
              },
            ),
          const SizedBox(height: 8),
          Row(
            children: [
              Text(
                '${results.totalVoters} vote${results.totalVoters == 1 ? '' : 's'}',
                style: TextStyle(
                  fontSize: 12,
                  color: colorScheme.onSurfaceVariant,
                ),
              ),
              const Spacer(),
              if (!hasVoted && !ended && auth.isLoggedIn && !auth.isReadOnly)
                FilledButton.tonal(
                  onPressed:
                      _selected.isEmpty || _votePending ? null : () => _vote(poll),
                  style: FilledButton.styleFrom(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 8,
                    ),
                  ),
                  child: _votePending
                      ? const SizedBox(
                          width: 14,
                          height: 14,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('Vote'),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _OptionRow extends StatelessWidget {
  final PollOption option;
  final NostrPoll poll;
  final PollResults results;
  final bool selected;
  final bool voted;
  final bool myChoice;
  final VoidCallback onTap;

  const _OptionRow({
    required this.option,
    required this.poll,
    required this.results,
    required this.selected,
    required this.voted,
    required this.myChoice,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final fraction = results.fractionFor(option.id);
    final votes = results.counts[option.id] ?? 0;

    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: BoxDecoration(
            color: voted
                ? colorScheme.surfaceContainerHighest.withValues(alpha: 0.6)
                : selected
                    ? colorScheme.primaryContainer.withValues(alpha: 0.5)
                    : colorScheme.surfaceContainerHighest.withValues(alpha: 0.3),
            borderRadius: BorderRadius.circular(10),
            border: Border.all(
              color: myChoice
                  ? colorScheme.primary
                  : selected
                      ? colorScheme.primary.withValues(alpha: 0.6)
                      : Colors.transparent,
              width: myChoice ? 1.5 : 1,
            ),
          ),
          child: Stack(
            children: [
              if (voted)
                Positioned.fill(
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: FractionallySizedBox(
                      widthFactor: fraction.clamp(0.0, 1.0),
                      child: Container(
                        decoration: BoxDecoration(
                          color: (myChoice
                                  ? colorScheme.primary
                                  : colorScheme.secondary)
                              .withValues(alpha: 0.15),
                          borderRadius: BorderRadius.circular(8),
                        ),
                      ),
                    ),
                  ),
                ),
              Row(
                children: [
                  if (myChoice)
                    Padding(
                      padding: const EdgeInsets.only(right: 6),
                      child: Icon(
                        Icons.check_circle_rounded,
                        size: 16,
                        color: colorScheme.primary,
                      ),
                    ),
                  Expanded(
                    child: Text(
                      option.label,
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight:
                            myChoice ? FontWeight.w600 : FontWeight.normal,
                      ),
                    ),
                  ),
                  if (voted)
                    Text(
                      '${(fraction * 100).round()}% · $votes',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: colorScheme.onSurfaceVariant,
                      ),
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
