import 'dart:async';

import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/nostr/kinds.dart';
import 'package:nostrfeed_mobile/core/nostr/nostr_service.dart';
import 'package:nostrfeed_mobile/core/utils/nip19.dart';

/// Gives the AI relay access: detects Nostr references in the user's
/// message (note/nevent/naddr links, npub/nprofile, 64-hex ids, and
/// "#hashtag" summarize requests), fetches the actual events from the
/// user's relays, and formats them as a context block for the model.
///
/// Without this the assistant is a bare chatbot — "summarize #bitcoin" or
/// "summarize this note1…" made the model hallucinate, which was the
/// "summary shortcut has no relay access" gap.
class AiContextService {
  final NostrService _nostr;

  AiContextService(this._nostr);

  /// Total budget for a relay fetch — the send must never hang on slow
  /// relays; partial context (or none) beats a stuck message.
  static const _fetchTimeout = Duration(seconds: 8);

  /// Hard cap on context size — every character is billed tokens.
  static const _maxContextChars = 6000;

  /// Matches `nostr:`-prefixed or bare bech32 ids inside free text.
  static final _nip19Pattern = RegExp(
    r'(?:nostr:)?\b(note1|nevent1|naddr1|npub1|nprofile1)[02-9ac-hj-np-z]{20,}',
    caseSensitive: false,
  );

  /// Bare 64-char hex event id.
  static final _hexIdPattern = RegExp(r'\b[0-9a-f]{64}\b');

  /// Intent words that turn a plain #hashtag mention into a fetch request.
  static final _summarizeIntent = RegExp(
    r'\b(summar|digest|recap|top|news|today|happening|trending|latest|what.s new|roundup|round-up)',
    caseSensitive: false,
  );

  static final _hashtagPattern = RegExp(r'#([a-zA-Z0-9_]{2,30})');

  /// Builds the context block for [userText], or null when the message
  /// contains nothing relay-fetchable. Never throws — context is a bonus,
  /// the message must always go through.
  Future<String?> buildContext(String userText) async {
    try {
      final sections = await _fetchAll(userText).timeout(
        _fetchTimeout,
        onTimeout: () => const [],
      );
      if (sections.isEmpty) return null;
      final body = sections.join('\n\n');
      final capped = body.length > _maxContextChars
          ? body.substring(0, _maxContextChars)
          : body;
      return '--- Live Nostr context fetched from the user\'s relays '
          '(use this to answer) ---\n$capped\n--- End of Nostr context ---';
    } catch (_) {
      return null;
    }
  }

  Future<List<String>> _fetchAll(String userText) async {
    final sections = <String>[];
    final seenEventIds = <String>{};
    final seenPubkeys = <String>{};

    // 1. bech32 references (note / nevent / naddr / npub / nprofile).
    for (final match in _nip19Pattern.allMatches(userText)) {
      final decoded = decodeNip19(match.group(0)!);
      switch (decoded) {
        case Nip19Note(:final eventId):
          if (seenEventIds.add(eventId)) {
            final s = await _fetchThread(eventId);
            if (s != null) sections.add(s);
          }
        case Nip19Event(:final eventId):
          if (seenEventIds.add(eventId)) {
            final s = await _fetchThread(eventId);
            if (s != null) sections.add(s);
          }
        case Nip19Address(
            kind: final kind,
            pubkey: final pubkey,
            identifier: final d
          ):
          final s = await _fetchAddress(kind, pubkey, d);
          if (s != null) sections.add(s);
        case Nip19Pubkey(:final pubkey):
          if (seenPubkeys.add(pubkey)) {
            final s = await _fetchAuthorRecent(pubkey);
            if (s != null) sections.add(s);
          }
        case Nip19Profile(:final pubkey):
          if (seenPubkeys.add(pubkey)) {
            final s = await _fetchAuthorRecent(pubkey);
            if (s != null) sections.add(s);
          }
        default:
          break;
      }
      if (sections.length >= 3) return sections; // budget: ≤3 blocks
    }

    // 2. Bare hex id → treat as a note id.
    final hex = _hexIdPattern.firstMatch(userText);
    if (hex != null && seenEventIds.add(hex.group(0)!)) {
      final s = await _fetchThread(hex.group(0)!);
      if (s != null) sections.add(s);
    }

    // 3. "#hashtag" + summarize intent → recent posts on that tag.
    if (sections.isEmpty && _summarizeIntent.hasMatch(userText)) {
      final tag = _hashtagPattern.firstMatch(userText)?.group(1);
      if (tag != null) {
        final s = await _fetchHashtag(tag.toLowerCase());
        if (s != null) sections.add(s);
      }
    }

    return sections;
  }

  /// A note plus its visible thread (replies that e-tag it).
  Future<String?> _fetchThread(String eventId) async {
    final roots = await _query(NostrFilter(ids: [eventId], limit: 1));
    if (roots.isEmpty) return null;
    final root = roots.first;
    final replies = await _query(NostrFilter(
      kinds: [NostrKinds.textNote],
      eTags: [eventId],
      limit: 25,
    ));
    replies.sort((a, b) => a.createdAt.compareTo(b.createdAt));
    final buf = StringBuffer()
      ..writeln('Thread starting note:')
      ..writeln(_formatEvent(root))
      ..write(_formatContent(root.content));
    if (replies.isNotEmpty) {
      buf.writeln('\n\nReplies (${replies.length}):');
      for (final r in replies.take(20)) {
        buf
          ..writeln()
          ..writeln(_formatEvent(r))
          ..write(_formatContent(r.content));
      }
    }
    return buf.toString();
  }

  /// An addressable event (article, list…) by kind+author+d-tag.
  Future<String?> _fetchAddress(int kind, String pubkey, String d) async {
    final events = await _query(NostrFilter(
      kinds: [kind],
      authors: [pubkey],
      tagFilters: {
        'd': [d],
      },
      limit: 1,
    ));
    if (events.isEmpty) return null;
    events.sort((a, b) => b.createdAt.compareTo(a.createdAt));
    final e = events.first;
    final title = e.getTag('title');
    return 'Nostr event (kind $kind'
        '${title != null ? ', "$title"' : ''}):\n'
        '${_formatEvent(e)}\n${_formatContent(e.content)}';
  }

  /// An author's recent posts — for "summarize @npub…" / "what has X been
  /// posting".
  Future<String?> _fetchAuthorRecent(String pubkey) async {
    final events = await _query(NostrFilter(
      kinds: [NostrKinds.textNote],
      authors: [pubkey],
      limit: 12,
    ));
    if (events.isEmpty) return null;
    events.sort((a, b) => b.createdAt.compareTo(a.createdAt));
    String label = 'npub ${pubkey.substring(0, 12)}…';
    try {
      final profile = await _nostr.fetchProfile(pubkey);
      final name = profile?.displayName ?? profile?.name;
      if (name != null && name.isNotEmpty) label = name;
    } catch (_) {}
    final buf = StringBuffer('Recent posts by $label:');
    for (final e in events.take(10)) {
      buf
        ..writeln()
        ..writeln(_formatEvent(e))
        ..write(_formatContent(e.content));
    }
    return buf.toString();
  }

  /// Recent posts on a hashtag — for "summarize #bitcoin today".
  Future<String?> _fetchHashtag(String tag) async {
    final events = await _query(NostrFilter(
      kinds: [NostrKinds.textNote],
      tTags: [tag],
      limit: 20,
    ));
    if (events.isEmpty) return null;
    events.sort((a, b) => b.createdAt.compareTo(a.createdAt));
    final buf = StringBuffer('Recent posts on #$tag:');
    for (final e in events.take(15)) {
      buf
        ..writeln()
        ..writeln(_formatEvent(e))
        ..write(_formatContent(e.content));
    }
    return buf.toString();
  }

  Future<List<NostrEvent>> _query(NostrFilter filter) {
    return _nostr.relayPool
        .query([filter])
        .timeout(const Duration(seconds: 6), onTimeout: () => const []);
  }

  String _formatEvent(NostrEvent e) {
    final dt = DateTime.fromMillisecondsSinceEpoch(e.createdAt * 1000);
    final when =
        '${dt.year}-${_two(dt.month)}-${_two(dt.day)} ${_two(dt.hour)}:${_two(dt.minute)} UTC';
    return '[${_authorLabel(e.pubkey)} · $when]';
  }

  String _authorLabel(String pubkey) =>
      'npub ${pubkey.length > 12 ? pubkey.substring(0, 12) : pubkey}…';

  /// Content is already sanitized by NostrEvent.fromJson at the relay
  /// boundary; this only caps length so one giant post can't eat the
  /// whole token budget.
  String _formatContent(String content) {
    const max = 1200;
    final trimmed = content.trim();
    return trimmed.length > max ? '${trimmed.substring(0, max)}…' : trimmed;
  }

  String _two(int v) => v.toString().padLeft(2, '0');
}
