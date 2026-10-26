import 'dart:convert';

import 'package:nostrfeed_mobile/core/db/store_host.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/store_invalidation.dart'
    show StoreTable;
import 'package:sqflite/sqflite.dart';

/// ADR-0008 (God-object split) — the profile store (`profiles` table +
/// `profile_fts` FTS5 people search). Profiles are kind-0 metadata (TTL'd);
/// FTS5 search is an indexed MATCH (was a `json LIKE '%q%'` full scan).
class ProfileStore {
  ProfileStore(this._host);
  final StoreHost _host;

  /// The stored profile for [pubkey], or null. [maxAge] → caller refetches
  /// when the row is older (stale-while-revalidate reads the age separately).
  Future<NostrProfile?> profileFor(String pubkey, {Duration? maxAge}) async {
    final row = await profileRowFor(pubkey);
    if (row == null) return null;
    if (maxAge != null) {
      final age = DateTime.now().millisecondsSinceEpoch - row.fetchedAtMs;
      if (age > maxAge.inMilliseconds) return null; // stale — caller refetches
    }
    return row.profile;
  }

  /// The stored profile + its fetch timestamp (ms), or null.
  Future<({NostrProfile profile, int fetchedAtMs})?> profileRowFor(
    String pubkey,
  ) async {
    final database = await _host.db;
    final rows = await database.query(
      'profiles',
      where: 'pubkey = ?',
      whereArgs: [pubkey],
      limit: 1,
    );
    if (rows.isEmpty) return null;
    try {
      return (
        profile: NostrProfile.fromJson(
          jsonDecode(rows.first['json'] as String) as Map<String, dynamic>,
        ),
        fetchedAtMs: rows.first['fetched_at'] as int,
      );
    } catch (_) {
      return null;
    }
  }

  Future<void> saveProfile(String pubkey, NostrProfile profile) =>
      _host.enqueueWrite(() => _saveProfileImpl(pubkey, profile),
          touches: {StoreTable.profiles});

  Future<void> _saveProfileImpl(String pubkey, NostrProfile profile) async {
    final database = await _host.db;
    await database.insert('profiles', {
      'pubkey': pubkey,
      'json': jsonEncode(profile.toJson()),
      'fetched_at': DateTime.now().millisecondsSinceEpoch,
    }, conflictAlgorithm: ConflictAlgorithm.replace);
    // Keep the FTS index in step (people search is then an indexed MATCH,
    // not a `json LIKE '%q%'` full scan). No-op without FTS5.
    if (_host.ftsAvailable) {
      await database.delete('profile_fts',
          where: 'pubkey = ?', whereArgs: [pubkey]);
      await database.insert('profile_fts', {
        'pubkey': pubkey,
        'name': profile.name ?? '',
        'display_name': profile.displayName ?? '',
        'nip05': profile.nip05 ?? '',
        'about': profile.about ?? '',
      });
    }
  }

  /// Local people search over the persistent profile cache — zero network.
  /// FTS5 MATCH when available (indexed, prefix-aware), LIKE fallback.
  Future<List<({String pubkey, NostrProfile profile})>> searchProfiles(
    String query, {
    int limit = 20,
  }) async {
    final database = await _host.db;
    final trimmed = query.trim();
    if (trimmed.isEmpty) return const [];

    // ── FTS5 path (indexed) ──────────────────────────────────────────
    if (_host.ftsAvailable) {
      final tokens = trimmed
          .replaceAll('"', ' ')
          .split(RegExp(r'\s+'))
          .where((t) => t.isNotEmpty)
          .toList();
      if (tokens.isNotEmpty) {
        final match = tokens.map((t) => '"$t"*').join(' ');
        try {
          final rows = await database.rawQuery(
            '''
            SELECT p.pubkey, p.json FROM profile_fts f
            JOIN profiles p ON p.pubkey = f.pubkey
            WHERE profile_fts MATCH ?
            ORDER BY p.fetched_at DESC
            LIMIT ?
            ''',
            [match, limit],
          );
          final out = <({String pubkey, NostrProfile profile})>[];
          for (final row in rows) {
            try {
              final p = NostrProfile.fromJson(
                jsonDecode(row['json'] as String) as Map<String, dynamic>,
              );
              out.add((pubkey: row['pubkey'] as String, profile: p));
            } catch (_) {}
          }
          return out;
        } catch (_) {
          // Malformed FTS query → fall through to the LIKE path.
        }
      }
    }

    // ── LIKE fallback (platforms without FTS5 / malformed FTS query) ──
    final like = '%${trimmed.replaceAll('%', r'\%').replaceAll('_', r'\_')}%';
    final rows = await database.rawQuery(
      '''
      SELECT pubkey, json FROM profiles
      WHERE json LIKE ? ESCAPE '\\'
      ORDER BY fetched_at DESC
      LIMIT ?
      ''',
      [like, limit * 4], // over-fetch; JSON parse + field-match refines below
    );
    final out = <({String pubkey, NostrProfile profile})>[];
    for (final row in rows) {
      try {
        final p = NostrProfile.fromJson(
          jsonDecode(row['json'] as String) as Map<String, dynamic>,
        );
        // Field-level match (LIKE on raw JSON would hit URLs/banner strings).
        final hay = [
          p.name ?? '',
          p.displayName ?? '',
          p.nip05 ?? '',
          p.about ?? '',
        ].join(' ').toLowerCase();
        if (hay.contains(trimmed.toLowerCase())) {
          out.add((pubkey: row['pubkey'] as String, profile: p));
        }
        if (out.length >= limit) break;
      } catch (_) {}
    }
    return out;
  }
}
