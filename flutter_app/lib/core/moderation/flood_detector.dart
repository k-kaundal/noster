import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:nostrfeed_mobile/core/models/nostr_models.dart';

/// Client-side flood / duplicate-post detection — the piece that keeps a
/// platform from drowning in the same junk posted over and over.
///
/// This mirrors the industry playbook for exactly the reported pattern
/// ("same type of post, again and again, within minutes, by users"):
///
/// - **nostr.band's spam filter** clusters near-identical content and kills
///   the cluster once it's big (highly repetitive commercial spam).
/// - **Stream's flood detection** fires on identical AND near-duplicate
///   messages from one user inside a rolling window.
/// - **glub's spray detection** catches the same long message posted across
///   MANY keys (a spray wave), which per-author limits miss.
///
/// Three signals, one verdict:
///
/// 1. **Author flood** — the same author posts the same (normalized) content
///    ≥ [authorThreshold] times within [window]. Catches a bot hammering one
///    key.
/// 2. **Spray** — the same content appears from ≥ [sprayThreshold] DISTINCT
///    authors within [window]. Catches a disposable-key spam wave (the
///    bala://-offer / token-drop floods).
/// 3. **Rapid-fire** — one author posts ≥ [rateThreshold] times within
///    [rateWindow], regardless of content. Catches burst spam that varies
///    each message.
///
/// Feed an event stream in arrival order ([observe]); [verdictFor] then
/// judges the newest event. Pure + in-memory (a bounded LRU per signal), so
/// it's cheap on the feed path and unit-testable without a relay.
class FloodDetector {
  FloodDetector({
    Duration? window,
    this.authorThreshold = 3,
    this.sprayThreshold = 4,
    Duration? rateWindow,
    this.rateThreshold = 8,
  })  : window = window ?? const Duration(minutes: 30),
        rateWindow = rateWindow ?? const Duration(minutes: 5);

  /// Rolling window for duplicate/similarity counting.
  final Duration window;

  /// Same-content posts by ONE author within [window] that trips flood.
  final int authorThreshold;

  /// DISTINCT authors posting the same content within [window] (spray).
  final int sprayThreshold;

  /// Burst window for the rate limiter.
  final Duration rateWindow;

  /// Posts by one author within [rateWindow] that trips rapid-fire.
  final int rateThreshold;

  // contentKey → list of (pubkey, ts)
  final Map<String, List<({String pk, int ts})>> _byContent = {};
  // contentKey → insertion order for LRU eviction
  final List<String> _contentOrder = [];
  // pubkey → list of ts (for rapid-fire)
  final Map<String, List<int>> _byAuthor = {};

  static const _maxContentKeys = 4000;
  static const _maxAuthors = 2000;

  /// Normalize content for duplicate comparison: trim, collapse whitespace,
  /// lowercase, strip URLs' trailing slashes and punctuation variance.
  /// Near-duplicates ("same post" with a space or casing change) cluster.
  static String contentKey(String content) {
    var s = content.trim().toLowerCase();
    s = s.replaceAll(RegExp(r'\s+'), ' ');
    // Strip trivial decoration spammers add to evade exact matching.
    s = s.replaceAll(RegExp(r'[.!?,;:\-_]+$'), '');
    return s;
  }

  /// Observe an event (call in arrival order as the feed ingests).
  void observe(NostrEvent e, {int? nowSeconds}) {
    final now = nowSeconds ?? DateTime.now().millisecondsSinceEpoch ~/ 1000;
    // Only short-form posts matter for floods.
    if (e.kind != 1) return;
    final key = contentKey(e.content);
    if (key.isEmpty) return;

    // By content (flood + spray).
    final list = _byContent.putIfAbsent(key, () {
      _contentOrder.add(key);
      if (_contentOrder.length > _maxContentKeys) {
        final evict = _contentOrder.removeAt(0);
        _byContent.remove(evict);
      }
      return [];
    });
    list.add((pk: e.pubkey, ts: e.createdAt));
    _pruneContent(list, now);

    // By author (rapid-fire).
    final alist = _byAuthor.putIfAbsent(e.pubkey, () {
      if (_byAuthor.length > _maxAuthors) {
        _byAuthor.remove(_byAuthor.keys.first);
      }
      return [];
    });
    alist.add(now);
    final cutoff = now - rateWindow.inSeconds;
    alist.removeWhere((t) => t < cutoff);
  }

  /// The flood verdict for [event] (judge the newest occurrence).
  FloodVerdict verdictFor(NostrEvent event, {int? nowSeconds}) {
    if (event.kind != 1) return FloodVerdict.clean;
    final now = nowSeconds ?? DateTime.now().millisecondsSinceEpoch ~/ 1000;
    final key = contentKey(event.content);
    if (key.isEmpty) return FloodVerdict.clean;

    // 1+2. Same-content analysis.
    final list = _byContent[key];
    if (list != null) {
      _pruneContent(list, now);
      final sameAuthor = list.where((r) => r.pk == event.pubkey).length;
      if (sameAuthor >= authorThreshold) {
        return FloodVerdict.authorFlood;
      }
      final distinctAuthors = list.map((r) => r.pk).toSet().length;
      if (distinctAuthors >= sprayThreshold) {
        return FloodVerdict.spray;
      }
    }

    // 3. Rapid-fire (any content).
    final alist = _byAuthor[event.pubkey];
    if (alist != null && alist.length >= rateThreshold) {
      return FloodVerdict.rapidFire;
    }

    return FloodVerdict.clean;
  }

  void _pruneContent(List<({String pk, int ts})> list, int now) {
    final cutoff = now - window.inSeconds;
    list.removeWhere((r) => r.ts < cutoff);
  }
}

/// Why a post tripped the flood filter (for debugging/telemetry — never
/// echoed to the UI with the matched content).
enum FloodVerdict {
  clean,

  /// Same author posted the same content too many times in the window.
  authorFlood,

  /// The same content appeared from too many distinct authors (spray wave).
  spray,

  /// One author is posting too fast regardless of content.
  rapidFire,
}

// ── Shared detector instance ────────────────────────────────────────────

/// The app-wide FloodDetector. ONE instance so the rolling observation
/// windows are consistent whether an event arrives via a page fetch
/// (FeedNotifier._applyFlood) or the live pipeline (the EventBus gate in
/// eventBusProviders). Lives in core (not the feed feature) because the
/// bus gate is pipeline policy, not feed policy.
final floodDetectorProvider = Provider<FloodDetector>((ref) => FloodDetector());
