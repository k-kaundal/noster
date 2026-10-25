import 'package:nostrfeed_mobile/core/models/nostr_models.dart';

/// ADR-0007 Phase 0 — the ONE compiled-filter engine.
///
/// Replaces the three divergent filter notions that drifted apart:
/// relay-side SQL in `EventStore.feedPage`, `EventBus` `matchesAny`, and
/// per-feature Dart predicates. Now every layer compiles a [NostrFilter]
/// once into hash sets and matches in O(1), with semantics pinned by an
/// oracle fuzz test (`test/core/nostr/filter_test.dart`).
///
/// Semantics are NIP-01-exact (verified against nips/01.md):
///
/// - **AND inside a filter**: every specified attribute must match.
/// - **OR across a REQ's filters** ([CompiledFilterGroup]).
/// - **List attributes are any-of** — but an **empty list matches NOTHING**
///   (NIP-01: "An empty list MUST NOT be treated as if the attribute were
///   absent"). The old `matchesEvent` skipped empty tag lists — that let
///   everything through; this engine treats them as never-matching.
/// - **`ids`/`authors`/`#e`/`#p` values must be 64-char lowercase hex** —
///   non-conforming values are dropped at compile time (they can never
///   match a real event, and keeping them would only waste lookups).
/// - **`since`/`until` are inclusive** (`since <= created_at <= until`).
/// - **`limit` is not a predicate** — it bounds the initial query only,
///   never affects [matches]. Retained for query planners.
/// - **`search` (NIP-50) is relay-side only** — evaluates TRUE locally
///   (conservative: never drops a possible match), same rule as the old
///   EventBus matcher.
/// - **Tag matching uses single-letter first values** (NIP-01's indexing
///   contract): a `#e` filter compares against `tag[1]` of tags whose
///   `tag[0] == 'e'`. Only single-letter tag names are filterable.
class CompiledFilter {
  CompiledFilter._({
    this.ids,
    this.authors,
    this.kinds,
    this.tags,
    this.since,
    this.until,
    this.limit,
  });

  /// Compile a [NostrFilter] once. Null sets mean "attribute absent" (the
  /// attribute is not constrained); an EMPTY set means the attribute was
  /// constrained to nothing and can never match.
  factory CompiledFilter.from(NostrFilter f) {
    Set<String>? hexSet(List<String>? values) {
      if (values == null) return null;
      return values
          .where((v) => _hex64.hasMatch(v))
          .map((v) => v.toLowerCase())
          .toSet();
    }

    Map<String, Set<String>>? tags;
    if (f.tagFilters != null) {
      tags = {};
      for (final entry in f.tagFilters!.entries) {
        // Hex tags (`e`/`p`) and hashtags (`t`) are matched
        // case-INSENSITIVELY (hex is always lowercase on the wire; real
        // relays answer `#Nostr` for a `#nostr` filter). Normalize once at
        // compile time so event-side case never matters.
        if (entry.key == 'e' || entry.key == 'p' || entry.key == 't') {
          tags[entry.key] = entry.value.map((v) => v.toLowerCase()).toSet();
        } else {
          tags[entry.key] = entry.value.toSet();
        }
      }
    }

    return CompiledFilter._(
      ids: hexSet(f.ids),
      // `#e`/`#p` are hex-constrained per NIP-01; other tags are not.
      authors: hexSet(f.authors),
      kinds: f.kinds?.toSet(),
      tags: tags,
      since: f.since,
      until: f.until,
      limit: f.limit,
    );
  }

  static final _hex64 = RegExp(r'^[0-9a-fA-F]{64}$');

  final Set<String>? ids;
  final Set<String>? authors;
  final Set<int>? kinds;
  final Map<String, Set<String>>? tags;
  final int? since;
  final int? until;

  /// Initial-query bound (not a predicate — see class doc).
  final int? limit;

  /// Does [event] satisfy this filter? O(1) hash lookups, AND semantics.
  bool matches(NostrEvent event) {
    final ids = this.ids;
    if (ids != null && !ids.contains(event.id.toLowerCase())) return false;
    final authors = this.authors;
    if (authors != null && !authors.contains(event.pubkey.toLowerCase())) {
      return false;
    }
    final kinds = this.kinds;
    if (kinds != null && !kinds.contains(event.kind)) return false;
    final since = this.since;
    if (since != null && event.createdAt < since) return false;
    final until = this.until;
    if (until != null && event.createdAt > until) return false;
    final tags = this.tags;
    if (tags != null) {
      for (final entry in tags.entries) {
        final wanted = entry.value;
        // NIP-01: an empty list can never match — this filter is dead.
        if (wanted.isEmpty) return false;
        if (!_eventHasTagValue(event, entry.key, wanted)) return false;
      }
    }
    return true;
  }

  /// True when this filter can never match any event (an empty list
  /// attribute was present). Query planners can short-circuit it.
  bool get isDead {
    if (ids != null && ids!.isEmpty) return true;
    if (authors != null && authors!.isEmpty) return true;
    if (kinds != null && kinds!.isEmpty) return true;
    if (tags != null) {
      for (final wanted in tags!.values) {
        if (wanted.isEmpty) return true;
      }
    }
    return false;
  }

  /// First-value tag lookup per NIP-01's indexing contract.
  static bool _eventHasTagValue(
    NostrEvent event,
    String name,
    Set<String> wanted,
  ) {
    final caseInsensitive = name == 'e' || name == 'p' || name == 't';
    for (final tag in event.tags) {
      if (tag.length > 1 && tag[0] == name) {
        final value = caseInsensitive ? tag[1].toLowerCase() : tag[1];
        if (wanted.contains(value)) return true;
      }
    }
    return false;
  }
}

/// A REQ's filter set: OR semantics — an event matching ANY filter passes.
class CompiledFilterGroup {
  CompiledFilterGroup(List<NostrFilter> filters)
    : filters = filters.map(CompiledFilter.from).toList();

  final List<CompiledFilter> filters;

  /// OR across filters. An EMPTY group matches nothing (a REQ with no
  /// filters is meaningless; relays reject or ignore it).
  bool matches(NostrEvent event) {
    for (final f in filters) {
      if (f.matches(event)) return true;
    }
    return false;
  }

  /// All filters dead ⇒ the whole group can never match.
  bool get isDead => filters.every((f) => f.isDead);
}
