import 'package:nostrfeed_mobile/core/models/nostr_models.dart';

/// NIP-88 poll (kind 1068) parsed from an event.
class NostrPoll {
  final String id;
  final String authorPubkey;
  final String question;
  final List<PollOption> options;
  final bool multipleChoice;
  final int? endsAt;
  final List<String> responseRelays;

  const NostrPoll({
    required this.id,
    required this.authorPubkey,
    required this.question,
    required this.options,
    required this.multipleChoice,
    this.endsAt,
    this.responseRelays = const [],
  });

  factory NostrPoll.fromEvent(NostrEvent event) {
    final options = <PollOption>[];
    final relays = <String>[];
    for (final tag in event.tags) {
      if (tag.isEmpty) continue;
      switch (tag[0]) {
        case 'option':
          if (tag.length >= 3) {
            options.add(PollOption(id: tag[1], label: tag[2]));
          }
        case 'relay':
          if (tag.length >= 2 && tag[1].startsWith('ws')) relays.add(tag[1]);
        case 'polltype':
          // handled below
        case 'endsAt':
          // handled below
      }
    }
    return NostrPoll(
      id: event.id,
      authorPubkey: event.pubkey,
      question: event.content,
      options: options,
      multipleChoice: event.getTag('polltype') == 'multiplechoice',
      endsAt: int.tryParse(event.getTag('endsAt') ?? ''),
      responseRelays: relays,
    );
  }

  bool get isOpen {
    if (endsAt == null) return true;
    final now = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    return endsAt! > now;
  }
}

class PollOption {
  final String id;
  final String label;
  const PollOption({required this.id, required this.label});
}

/// A user's vote (kind 1018), per NIP-88 counting rules.
class PollVote {
  final String voterPubkey;
  final List<String> optionIds;
  final int createdAt;
  const PollVote({
    required this.voterPubkey,
    required this.optionIds,
    required this.createdAt,
  });

  factory PollVote.fromEvent(NostrEvent event, {required bool multipleChoice}) {
    final responses = event.getTags('response');
    // NIP-88: single-choice → only FIRST response tag counts.
    // Multiple-choice → first response tag PER option id counts.
    final ids = multipleChoice
        ? responses.toSet().toList()
        : (responses.isEmpty ? <String>[] : [responses.first]);
    return PollVote(
      voterPubkey: event.pubkey,
      optionIds: ids,
      createdAt: event.createdAt,
    );
  }
}

/// Tallied poll results following NIP-88 counting rules:
/// one vote per pubkey — for multiple votes, the LATEST within the window wins.
class PollResults {
  final Map<String, int> counts; // optionId → votes
  final int totalVoters;
  final String? myVote; // optionId the current user picked (single choice)
  final List<String> myVotes; // optionIds (multiple choice)

  const PollResults({
    required this.counts,
    required this.totalVoters,
    this.myVote,
    this.myVotes = const [],
  });

  double fractionFor(String optionId) {
    if (totalVoters == 0) return 0;
    return (counts[optionId] ?? 0) / totalVoters;
  }

  /// Tally kind-1018 responses per NIP-88.
  static PollResults tally(
    List<NostrEvent> responses,
    NostrPoll poll, {
    String? currentUserPubkey,
  }) {
    // Latest valid vote per pubkey.
    final latestByPubkey = <String, NostrEvent>{};
    for (final e in responses) {
      // Ignore responses after the poll closed.
      if (poll.endsAt != null && e.createdAt > poll.endsAt!) continue;
      final existing = latestByPubkey[e.pubkey];
      if (existing == null || e.createdAt > existing.createdAt) {
        latestByPubkey[e.pubkey] = e;
      }
    }
    final counts = <String, int>{};
    final myVotes = <String>[];
    final validOptionIds = poll.options.map((o) => o.id).toSet();
    for (final e in latestByPubkey.values) {
      final vote = PollVote.fromEvent(e, multipleChoice: poll.multipleChoice);
      for (final optionId in vote.optionIds) {
        if (!validOptionIds.contains(optionId)) continue; // phantom option
        counts[optionId] = (counts[optionId] ?? 0) + 1;
      }
      if (e.pubkey == currentUserPubkey) myVotes.addAll(vote.optionIds);
    }
    return PollResults(
      counts: counts,
      totalVoters: latestByPubkey.length,
      myVote: myVotes.isNotEmpty ? myVotes.first : null,
      myVotes: myVotes,
    );
  }
}
