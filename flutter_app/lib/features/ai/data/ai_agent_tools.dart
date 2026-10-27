import 'dart:convert';

import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/nostr/nostr_service.dart';
import 'package:nostrfeed_mobile/core/utils/nip19.dart';

/// Read-only tools the AI agent can call in a loop (Grok-on-X style:
/// "search → read → summarize", grounded in real relay data). These are
/// READ-ONLY — no signing, no writes. Every tool runs against the app's
/// existing relay pool / store, bounded.
///
/// The model NEVER sees a private key; it only sees these tool definitions
/// and their results.
class AiAgentTools {
  final NostrService _nostr;
  AiAgentTools(this._nostr);

  static const _queryTimeout = Duration(seconds: 6);

  /// The tool definitions sent to the model (OpenAI function-calling shape).
  static List<Map<String, dynamic>> definitions() => [
        {
          'type': 'function',
          'function': {
            'name': 'search_relay',
            'description':
                'Search Nostr for posts. Use this to find notes by keyword, '
                    'hashtag, or author. Returns matching posts (newest first).',
            'parameters': {
              'type': 'object',
              'properties': {
                'query': {
                  'type': 'string',
                  'description':
                      'A search term (hashtag without #, keyword) OR a #hashtag.',
                },
                'limit': {
                  'type': 'integer',
                  'description': 'Max posts to return (1-15, default 8).',
                },
              },
              'required': ['query'],
            },
          },
        },
        {
          'type': 'function',
          'function': {
            'name': 'fetch_thread',
            'description':
                'Fetch a post and its replies (a whole conversation thread) by '
                    'note id or bech32 (note1/nevent1/hex).',
            'parameters': {
              'type': 'object',
              'properties': {
                'id': {
                  'type': 'string',
                  'description': 'The event id (64-hex) or note1…/nevent1….',
                },
              },
              'required': ['id'],
            },
          },
        },
        {
          'type': 'function',
          'function': {
            'name': 'fetch_profile',
            'description':
                "Fetch a Nostr user's profile (name, bio, picture) by npub or hex pubkey.",
            'parameters': {
              'type': 'object',
              'properties': {
                'pubkey': {
                  'type': 'string',
                  'description': 'The pubkey (64-hex) or npub1….',
                },
              },
              'required': ['pubkey'],
            },
          },
        },
        {
          'type': 'function',
          'function': {
            'name': 'fetch_hashtag_feed',
            'description': 'Fetch recent posts for a hashtag (e.g. #bitcoin).',
            'parameters': {
              'type': 'object',
              'properties': {
                'tag': {
                  'type': 'string',
                  'description': 'The hashtag WITHOUT the # (e.g. "bitcoin").',
                },
                'limit': {
                  'type': 'integer',
                  'description': 'Max posts to return (1-15, default 8).',
                },
              },
              'required': ['tag'],
            },
          },
        },
      ];

  /// Execute one tool call by name with its JSON arguments. Returns the
  /// result as a compact JSON string for the model. Never throws.
  Future<String> execute(String name, String argumentsJson) async {
    try {
      final args = _parseArgs(argumentsJson);
      return await switch (name) {
        'search_relay' => _searchRelay(args),
        'fetch_thread' => _fetchThread(args),
        'fetch_profile' => _fetchProfile(args),
        'fetch_hashtag_feed' => _fetchHashtagFeed(args),
        _ => _err('Unknown tool: $name'),
      };
    } catch (e) {
      return _err('Tool failed: $e');
    }
  }

  Map<String, dynamic> _parseArgs(String json) {
    try {
      final d = jsonDecode(json);
      return d is Map<String, dynamic> ? d : <String, dynamic>{};
    } catch (_) {
      return <String, dynamic>{};
    }
  }

  String _err(String msg) => jsonEncode({'error': msg});

  Future<List<NostrEvent>> _query(List<NostrFilter> filters) async {
    try {
      return await _nostr.relayPool.query(filters, timeout: _queryTimeout);
    } catch (_) {
      return const [];
    }
  }

  Future<String> _searchRelay(Map<String, dynamic> args) async {
    final query = (args['query'] as String? ?? '').trim();
    if (query.isEmpty) return _err('Missing query');
    final limit = (args['limit'] as num? ?? 8).clamp(1, 15).toInt();

    List<NostrEvent> events;
    if (query.startsWith('#')) {
      events = await _query([
        NostrFilter(
          kinds: [1],
          tagFilters: {
            't': [query.substring(1).toLowerCase()],
          },
          limit: limit,
        ),
      ]);
    } else {
      events = await _nostr.search(query);
      events = events.take(limit).toList();
    }

    if (events.isEmpty) {
      return jsonEncode({'results': [], 'note': 'No posts found.'});
    }
    events.sort((a, b) => b.createdAt.compareTo(a.createdAt));
    return jsonEncode({
      'results': [
        for (final e in events.take(limit))
          {
            'author': e.pubkey.substring(0, 8),
            'created': _ts(e.createdAt),
            'content': _clip(e.content, 280),
            'id': e.id,
          },
      ],
    });
  }

  Future<String> _fetchThread(Map<String, dynamic> args) async {
    final raw = (args['id'] as String? ?? '').trim();
    final id = _resolveEventId(raw);
    if (id == null) return _err('Could not parse the event id');

    final roots = await _query([NostrFilter(ids: [id], limit: 1)]);
    if (roots.isEmpty) return _err('Note not found on the user\'s relays');
    final root = roots.first;
    final replies = await _query([
      NostrFilter(
        kinds: [1],
        tagFilters: {
          'e': [id],
        },
        limit: 20,
      ),
    ]);
    replies.sort((a, b) => a.createdAt.compareTo(b.createdAt));

    return jsonEncode({
      'root': {
        'author': root.pubkey.substring(0, 8),
        'created': _ts(root.createdAt),
        'content': _clip(root.content, 500),
      },
      'replies': [
        for (final r in replies.take(20))
          {
            'author': r.pubkey.substring(0, 8),
            'created': _ts(r.createdAt),
            'content': _clip(r.content, 240),
          },
      ],
    });
  }

  Future<String> _fetchProfile(Map<String, dynamic> args) async {
    final raw = (args['pubkey'] as String? ?? '').trim();
    final pubkey = _resolvePubkey(raw);
    if (pubkey == null) return _err('Could not parse the pubkey');
    final profile = await _nostr.fetchProfile(pubkey);
    if (profile == null) return _err('Profile not found');
    return jsonEncode({
      'name': profile.displayNameOrName,
      'nip05': profile.nip05,
      'about': _clip(profile.about ?? '', 400),
      'picture': profile.picture,
      'lud16': profile.lud16,
    });
  }

  Future<String> _fetchHashtagFeed(Map<String, dynamic> args) async {
    final tag = (args['tag'] as String? ?? '')
        .trim()
        .replaceAll(RegExp(r'^#'), '')
        .toLowerCase();
    if (tag.isEmpty) return _err('Missing tag');
    final limit = (args['limit'] as num? ?? 8).clamp(1, 15).toInt();
    final events = await _nostr.fetchHashtagFeed(tag, limit: limit);
    if (events.isEmpty) {
      return jsonEncode({'results': [], 'note': 'No posts for #$tag.'});
    }
    return jsonEncode({
      'results': [
        for (final e in events.take(limit))
          {
            'author': e.pubkey.substring(0, 8),
            'created': _ts(e.createdAt),
            'content': _clip(e.content, 280),
            'id': e.id,
          },
      ],
    });
  }

  String? _resolveEventId(String raw) {
    if (RegExp(r'^[0-9a-f]{64}$').hasMatch(raw)) return raw;
    try {
      final decoded = decodeNip19(raw.replaceAll('nostr:', ''));
      return switch (decoded) {
        Nip19Note(eventId: final id) => id,
        Nip19Event(eventId: final id) => id,
        _ => null,
      };
    } catch (_) {
      return null;
    }
  }

  String? _resolvePubkey(String raw) {
    if (RegExp(r'^[0-9a-f]{64}$').hasMatch(raw)) return raw;
    try {
      final decoded = decodeNip19(raw.replaceAll('nostr:', ''));
      return switch (decoded) {
        Nip19Pubkey(pubkey: final pk) => pk,
        Nip19Profile(pubkey: final pk) => pk,
        _ => null,
      };
    } catch (_) {
      return null;
    }
  }

  String _clip(String text, int max) {
    final t = text.trim();
    return t.length <= max ? t : '${t.substring(0, max)}…';
  }

  String _ts(int unixSeconds) {
    final d = DateTime.fromMillisecondsSinceEpoch(unixSeconds * 1000);
    return '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
  }
}
