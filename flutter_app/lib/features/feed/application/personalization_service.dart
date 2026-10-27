import 'dart:async';
import 'dart:ui' as ui;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:nostrfeed_mobile/core/db/event_store.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/services/http_helper.dart';
import 'package:nostrfeed_mobile/core/utils/language_detect.dart';

/// Personalization signals for the For You feed: the user's country,
/// languages, and interest profile — all derived WITHOUT any location
/// permission.
///
/// Country chain (country-level only, NEVER GPS/city):
///   1. Our geo endpoint (`relay.nostrfeed.com/api/geo`) — the relay sees
///      the client IP anyway; country-only answer, cached 7d server-side.
///   2. Device locale region (`en_IN` → IN) — zero network, zero permission.
///   3. (locale covers ~everyone; timezone is a weak hint — skipped unless
///      both above fail, which is rare enough to just return null = "don't
///      geo-boost", never a wrong guess).
///
/// Interests are mined ON-DEVICE from the SQLite store — the user's own
/// engagement events (their reactions/replies/reposts) carry the hashtags
/// and authors they actually interact with. Nothing leaves the device.
class PersonalizationProfile {
  /// ISO 3166-1 alpha-2, uppercase (e.g. `IN`). Null = don't geo-boost.
  final String? country;

  /// Device language codes (BCP-47 primary, e.g. `en`, `hi`).
  final List<String> languages;

  /// Hashtags the user engages with (from THEIR OWN reactions/replies),
  /// most-engaged first, lowercased.
  final List<String> interestTags;

  /// Authors the user engages with most (their likes/replies/reposts),
  /// most-engaged first.
  final List<String> engagedAuthors;

  /// The user's follow list (empty when logged out / unresolved).
  final List<String> follows;

  const PersonalizationProfile({
    this.country,
    this.languages = const [],
    this.interestTags = const [],
    this.engagedAuthors = const [],
    this.follows = const [],
  });

  bool get isEmpty =>
      country == null && interestTags.isEmpty && engagedAuthors.isEmpty;
}

/// The personalization profile provider. keepAlive: computed once per
/// session (+24h disk cache for the country leg); re-mines interests on
/// invalidate (e.g. after the user's engagement syncs).
final personalizationProvider = FutureProvider<PersonalizationProfile>((
  ref,
) async {
  ref.keepAlive();
  final country = await _detectCountry(ref);
  final languages = _deviceLanguages();

  // Interests: mine the user's own engagement from the store (on-device).
  final auth = ref.watch(authStateProvider);
  var interestTags = <String>[];
  var engagedAuthors = <String>[];
  var follows = <String>[];
  if (auth.isLoggedIn && auth.pubkey != null) {
    follows = ref.watch(followsProvider).valueOrNull ?? const [];
    final mined = await _mineInterests(auth.pubkey!);
    interestTags = mined.tags;
    engagedAuthors = mined.authors;
  }

  return PersonalizationProfile(
    country: country,
    languages: languages,
    interestTags: interestTags,
    engagedAuthors: engagedAuthors,
    follows: follows,
  );
});

// ── Country detection ────────────────────────────────────────────────

const _geoCacheKey = 'personalization:country_v1';
const _geoCacheTimeKey = 'personalization:country_time_v1';
const _geoCacheTtl = Duration(hours: 24);

/// Country for this device, or null (never a wrong guess).
Future<String?> _detectCountry(Ref ref) async {
  // 24h disk cache: the country of a mobile connection changes rarely, and
  // the For You tab must never wait on a network leg to rank.
  final prefs = await SharedPreferences.getInstance();
  final cached = prefs.getString(_geoCacheKey);
  final cachedAt = prefs.getInt(_geoCacheTimeKey) ?? 0;
  final fresh =
      DateTime.now().millisecondsSinceEpoch - cachedAt <
      _geoCacheTtl.inMilliseconds;
  if (fresh && cached != null && cached.isNotEmpty) return cached;

  // Primary: our relay's geo endpoint (country-only, server-side cache).
  try {
    final res = await const ApiHttpClient(timeout: Duration(seconds: 4))
        .tryGetJson(Uri.parse('https://relay.nostrfeed.com/api/geo'));
    final country = res?['country'];
    if (country is String && country.length == 2) {
      final cc = country.toUpperCase();
      unawaited(prefs.setString(_geoCacheKey, cc));
      unawaited(
        prefs.setInt(_geoCacheTimeKey, DateTime.now().millisecondsSinceEpoch),
      );
      return cc;
    }
  } catch (_) {
    // Offline / endpoint down — fall through to the device legs.
  }

  // Fallback: device locale region (`en_IN` → `IN`). Zero network, zero
  // permission — a user who never grants anything still gets local ranking.
  final region = ui.PlatformDispatcher.instance.locale.countryCode;
  if (region != null && region.length == 2) {
    final cc = region.toUpperCase();
    unawaited(prefs.setString(_geoCacheKey, cc));
    unawaited(
      prefs.setInt(_geoCacheTimeKey, DateTime.now().millisecondsSinceEpoch),
    );
    return cc;
  }
  return null; // unknown — don't geo-boost (never guess wrong).
}

/// Device languages (primary subtags), most-preferred first, deduped.
List<String> _deviceLanguages() {
  final out = <String>[];
  for (final l in ui.PlatformDispatcher.instance.locales) {
    final code = l.languageCode.toLowerCase();
    if (code.isNotEmpty && !out.contains(code)) out.add(code);
  }
  return out;
}

// ── Interest mining (on-device, from the store) ──────────────────────

/// Mine the user's engagement events from the SQLite store: hashtags and
/// authors from the posts THEY reacted to / replied to / reposted. This is
/// the honest interest graph — what they actually touch, not what they say.
Future<({List<String> tags, List<String> authors})> _mineInterests(
  String pubkey,
) async {
  try {
    final own = await EventStore.instance.queryByFilters([
      NostrFilter(kinds: const [1, 6, 7, 16], authors: [pubkey], limit: 300),
    ]);
    if (own.isEmpty) {
      return (tags: const <String>[], authors: const <String>[]);
    }

    final tagCounts = <String, int>{};
    final authorCounts = <String, int>{};
    final targetIds = <String>{};
    for (final e in own) {
      // Hashtags on the user's own posts/replies count as interests too.
      for (final t in e.hashtags) {
        final tag = t.toLowerCase();
        tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
      }
      final target = e.getTag('e');
      if (target != null) targetIds.add(target);
    }

    // Resolve engagement targets → their authors + hashtags (the topics the
    // user actually reacts to — the strongest interest signal).
    if (targetIds.isNotEmpty) {
      final targets = await EventStore.instance.eventsById(
        targetIds.take(200).toList(),
      );
      for (final t in targets) {
        authorCounts[t.pubkey] = (authorCounts[t.pubkey] ?? 0) + 1;
        for (final tag in t.hashtags) {
          final tg = tag.toLowerCase();
          tagCounts[tg] = (tagCounts[tg] ?? 0) + 2; // targets weigh 2×
        }
      }
    }

    final tags = tagCounts.entries.toList()
      ..sort((a, b) => b.value.compareTo(a.value));
    final authors = authorCounts.entries.toList()
      ..sort((a, b) => b.value.compareTo(a.value));
    final List<String> tagList = tags.take(20).map((e) => e.key).toList();
    final List<String> authorList = authors.take(30).map((e) => e.key).toList();
    return (tags: tagList, authors: authorList);
  } catch (_) {
    return (tags: const <String>[], authors: const <String>[]);
  }
}

// ── Scoring (used by the For You feed) ───────────────────────────────

/// The personalization boost for one post, ≥ 1.0. Multiplied onto the
/// anti-manipulation trending score (genuine engagement still dominates —
/// personalization re-orders, it never inflates junk to the top).
double personalizationBoost({
  required NostrEvent event,
  required PersonalizationProfile profile,
  ScriptFamily? script,
}) {
  var boost = 1.0;

  // Followed author: the "followers mix" — the user chose these people.
  if (profile.follows.contains(event.pubkey)) boost *= 2.6;

  // Authors the user repeatedly engages with (even unfollowed — the
  // "you keep liking this person's posts" signal).
  if (profile.engagedAuthors.contains(event.pubkey)) boost *= 1.8;

  // Interest hashtags (topics the user provably reacts to).
  if (profile.interestTags.isNotEmpty) {
    final tags = event.hashtags;
    for (final t in tags) {
      if (profile.interestTags.contains(t.toLowerCase())) {
        boost *= 1.7;
        break;
      }
    }
  }

  // Country topics: a post tagging the user's country (e.g. #india) or a
  // country-shaped hashtag match. Weak-ish boost — topic, not location.
  final country = profile.country;
  if (country != null) {
    final cc = country.toLowerCase();
    for (final t in event.hashtags) {
      final tag = t.toLowerCase();
      if (tag == cc || tag == _countryNameTag(cc)) {
        boost *= 1.35;
        break;
      }
    }
  }

  // Language/script match: a post in a script the user reads outranks one
  // they can't. Only applies when the user's languages are KNOWN — an
  // unknown-language user gets no boost either way (never a wrong guess).
  final s = script ?? detectScript(event.content);
  if (profile.languages.isNotEmpty && s != ScriptFamily.other) {
    if (scriptMatchesUser(s, profile.languages)) {
      boost *= 1.5;
    } else if (s != ScriptFamily.latin) {
      // A non-Latin script the user provably does NOT read (a pure Thai
      // post for a Latin-only user): rank DOWN, never hide. Global has it.
      boost *= 0.45;
    }
  }

  return boost;
}

/// Country-name hashtag for a few large communities (ISO code alone misses
/// "#india"-style tags). Falls back to the ISO code itself.
String _countryNameTag(String isoLower) {
  return switch (isoLower) {
    'in' => 'india',
    'us' => 'usa',
    'gb' => 'uk',
    'jp' => 'japan',
    'br' => 'brazil',
    'de' => 'germany',
    'fr' => 'france',
    'ng' => 'nigeria',
    'id' => 'indonesia',
    'pk' => 'pakistan',
    'bd' => 'bangladesh',
    'ru' => 'russia',
    'tr' => 'turkey',
    'ir' => 'iran',
    'sa' => 'saudi',
    'ae' => 'uae',
    'kr' => 'korea',
    'cn' => 'china',
    'es' => 'spain',
    'mx' => 'mexico',
    'ar' => 'argentina',
    'za' => 'southafrica',
    'ke' => 'kenya',
    'ph' => 'philippines',
    'vn' => 'vietnam',
    'th' => 'thailand',
    _ => isoLower,
  };
}
