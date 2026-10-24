import 'package:flutter_test/flutter_test.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/features/feed/domain/poll.dart';

NostrEvent _pollEvent({
  String id = 'poll1',
  String polltype = 'singlechoice',
  int? endsAt,
  List<List<String>>? extraTags,
}) =>
    NostrEvent(
      id: id,
      pubkey: 'author',
      createdAt: 1000,
      kind: 1068,
      content: 'Pineapple on pizza?',
      tags: [
        ['option', 'aaa', 'Yes'],
        ['option', 'bbb', 'No'],
        ['polltype', polltype],
        if (endsAt != null) ['endsAt', '$endsAt'],
        ...?extraTags,
      ],
      sig: 'sig',
    );

NostrEvent _vote({
  required String id,
  required String voter,
  required List<String> optionIds,
  int createdAt = 2000,
}) =>
    NostrEvent(
      id: id,
      pubkey: voter,
      createdAt: createdAt,
      kind: 1018,
      content: '',
      tags: [
        ['e', 'poll1'],
        for (final o in optionIds) ['response', o],
      ],
      sig: 'sig',
    );

void main() {
  group('NostrPoll.fromEvent', () {
    test('parses question, options, type, endsAt, relays', () {
      final poll = NostrPoll.fromEvent(_pollEvent(
        endsAt: 9999999999,
        extraTags: [
          ['relay', 'wss://relay.example.com'],
        ],
      ));
      expect(poll.question, 'Pineapple on pizza?');
      expect(poll.options, hasLength(2));
      expect(poll.options.first.id, 'aaa');
      expect(poll.options.first.label, 'Yes');
      expect(poll.multipleChoice, isFalse);
      expect(poll.endsAt, 9999999999);
      expect(poll.responseRelays, ['wss://relay.example.com']);
      expect(poll.isOpen, isTrue);
    });

    test('missing polltype defaults to single choice', () {
      final e = _pollEvent(polltype: 'singlechoice');
      expect(NostrPoll.fromEvent(e).multipleChoice, isFalse);
    });

    test('expired poll is closed', () {
      final poll = NostrPoll.fromEvent(_pollEvent(endsAt: 100));
      expect(poll.isOpen, isFalse);
    });
  });

  group('PollResults.tally', () {
    test('single choice: only FIRST response tag counts', () {
      final poll = NostrPoll.fromEvent(_pollEvent());
      final results = PollResults.tally(
        [_vote(id: 'v1', voter: 'u1', optionIds: ['aaa', 'bbb'])],
        poll,
      );
      expect(results.counts['aaa'], 1);
      expect(results.counts['bbb'], isNull);
    });

    test('multiple choice: all selected options count', () {
      final poll = NostrPoll.fromEvent(_pollEvent(polltype: 'multiplechoice'));
      final results = PollResults.tally(
        [_vote(id: 'v1', voter: 'u1', optionIds: ['aaa', 'bbb'])],
        poll,
      );
      expect(results.counts['aaa'], 1);
      expect(results.counts['bbb'], 1);
      expect(results.totalVoters, 1);
    });

    test('one vote per pubkey — LATEST vote wins', () {
      final poll = NostrPoll.fromEvent(_pollEvent());
      final results = PollResults.tally(
        [
          _vote(id: 'v1', voter: 'u1', optionIds: ['aaa'], createdAt: 100),
          _vote(id: 'v2', voter: 'u1', optionIds: ['bbb'], createdAt: 200),
        ],
        poll,
      );
      expect(results.totalVoters, 1);
      expect(results.counts['aaa'], isNull);
      expect(results.counts['bbb'], 1);
    });

    test('votes after endsAt are excluded', () {
      final poll = NostrPoll.fromEvent(_pollEvent(endsAt: 1500));
      final results = PollResults.tally(
        [_vote(id: 'v1', voter: 'u1', optionIds: ['aaa'], createdAt: 2000)],
        poll,
      );
      expect(results.totalVoters, 0);
      expect(results.counts, isEmpty);
    });

    test('phantom option ids are ignored', () {
      final poll = NostrPoll.fromEvent(_pollEvent());
      final results = PollResults.tally(
        [_vote(id: 'v1', voter: 'u1', optionIds: ['zzz'])],
        poll,
      );
      expect(results.counts, isEmpty);
    });

    test('fraction + myVote tracking', () {
      final poll = NostrPoll.fromEvent(_pollEvent());
      final results = PollResults.tally(
        [
          _vote(id: 'v1', voter: 'me', optionIds: ['aaa']),
          _vote(id: 'v2', voter: 'u2', optionIds: ['bbb']),
          _vote(id: 'v3', voter: 'u3', optionIds: ['bbb']),
        ],
        poll,
        currentUserPubkey: 'me',
      );
      expect(results.totalVoters, 3);
      expect(results.fractionFor('bbb'), closeTo(2 / 3, 0.001));
      expect(results.myVote, 'aaa');
      expect(results.myVotes, ['aaa']);
    });
  });
}
