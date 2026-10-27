import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/moderation/filter_terms.dart';

/// What the filter decided about an event or profile, and why.
///
/// The reason is part of the result, not a log line, because every hidden
/// post is a question somebody asks — "where did it go" needs an answer
/// better than "the algorithm".
enum FilterAction {
  /// Render normally.
  show,

  /// Hide entirely (spam, blocked word, blocked author).
  hide,

  /// Behind a tap-to-reveal warning (NIP-36 content-warning, #nsfw tag).
  warn,
}

class FilterVerdict {
  final FilterAction action;

  /// Short machine reason: 'spam-link', 'blocked-word', 'content-warning',
  /// 'nsfw-tag', 'nsfw-profile', 'blocked-author'.
  final String reason;

  /// What matched, for the tooltip/log (a matched term is NOT echoed to the
  /// UI — it would print the very thing being hidden).
  final String? detail;

  const FilterVerdict(this.action, this.reason, [this.detail]);

  static const show = FilterVerdict(FilterAction.show, 'clean');
}

/// Content filtering for the whole app, in one pure, testable library.
///
/// Three kinds of content are caught, matching the store policies (Google
/// Play UGC / Apple 1.2) the app must satisfy:
///
/// 1. **Spam** — link-dump posts: search-engine spam links (`search.html`
///    and friends), shorteners, known spam TLDs, and posts that are more
///    links than words. These hide, they do not warn — there is no reader
///    whose day is improved by a link dump.
/// 2. **Explicit content** — NIP-36 `content-warning` tags and `#nsfw`
///    hashtags are honored with a warning cover (the poster's own label,
///    respected, not second-guessed); profile names/bios and post text
///    matching the NSFW term lists hide.
/// 3. **Evasion-resistant word matching** — text is normalized before
///    matching (case fold, diacritic strip, leetspeak decode, homoglyph
///    fold, repeat collapse) so `n.s.f.w`-style dotted names and
///    `s3x`-style substitutions do not walk past the list.
///
/// Everything here is a pure function — no providers, no I/O — so the whole
/// filter is unit-testable without a relay.
class ContentFilter {
  final Set<String> blockedWords;
  final Set<String> blockedAuthors;

  /// Whether the built-in explicit-term lists apply. Off = only the user's
  /// own blocked words/authors hide anything (their explicit choice).
  final bool nsfwTermsEnabled;

  /// Whether the spam-link heuristics apply.
  final bool spamLinksEnabled;

  const ContentFilter({
    this.blockedWords = const {},
    this.blockedAuthors = const {},
    this.nsfwTermsEnabled = true,
    this.spamLinksEnabled = true,
  });

  // ── Normalization ────────────────────────────────────────────────

  /// Leetspeak / substitution fold for LETTER-ONLY output. Digits are NOT
  /// folded here — a term list contains no digits, so folding them only
  /// mangles innocent tokens ("k9"→"kg", "4u"→"au"). Instead, evasion
  /// through digits is caught by ALSO matching a digit-stripped form.
  static const _leetFold = {
    '@': 'a',
    '\$': 's',
    '€': 'e',
    '£': 'l',
    '+': 't',
    '!': 'i',
    '|': 'i',
    '(': 'c',
    '{': 'c',
    '<': 'c',
    '©': 'c',
    '®': 'r',
    'ß': 'b',
    'þ': 'p',
    'æ': 'a',
    'œ': 'o',
    'ø': 'o',
    'å': 'a',
    'ð': 'd',
    'ƒ': 'f',
    'µ': 'u',
    'ν': 'v',
    '×': 'x',
    '*': 'x',
  };

  /// Cyrillic/Greek homoglyphs that look Latin. Covers the common
  /// "write an English slur with foreign letters" trick.
  static const _homoglyphFold = {
    'а': 'a', 'А': 'a', 'à': 'a', 'á': 'a', 'â': 'a', 'ã': 'a', 'ä': 'a',
    'ā': 'a', 'ă': 'a', 'ą': 'a', 'α': 'a',
    'е': 'e', 'Е': 'e', 'è': 'e', 'é': 'e', 'ê': 'e', 'ë': 'e', 'ē': 'e',
    'ĕ': 'e', 'ė': 'e', 'ę': 'e', 'ě': 'e', 'ε': 'e',
    'і': 'i', 'І': 'i', 'ì': 'i', 'í': 'i', 'î': 'i', 'ï': 'i', 'ī': 'i',
    'ĭ': 'i', 'į': 'i', 'ı': 'i',
    'о': 'o', 'О': 'o', 'ò': 'o', 'ó': 'o', 'ô': 'o', 'õ': 'o', 'ö': 'o',
    'ō': 'o', 'ŏ': 'o', 'ő': 'o', 'ο': 'o',
    'ս': 'u', 'ù': 'u', 'ú': 'u', 'û': 'u', 'ü': 'u', 'ū': 'u', 'ŭ': 'u',
    'ů': 'u', 'ű': 'u', 'ų': 'u',
    'с': 'c', 'С': 'c', 'ç': 'c', 'ć': 'c', 'ĉ': 'c', 'ċ': 'c', 'č': 'c',
    'р': 'p', 'Р': 'p', 'ρ': 'p',
    'х': 'x', 'Х': 'x', 'χ': 'x',
    'у': 'y', 'У': 'y', 'ý': 'y', 'ÿ': 'y',
    'к': 'k', 'К': 'k', 'κ': 'k',
    'м': 'm', 'М': 'm',
    'н': 'h', 'Н': 'h',
    'т': 't', 'Т': 't', 'τ': 't',
    'в': 'b', 'В': 'b',
    'ѕ': 's', 'Ѕ': 's', 'ś': 's', 'ŝ': 's', 'ş': 's', 'š': 's', 'σ': 's',
    'г': 'r', 'ŕ': 'r', 'ŗ': 'r', 'ř': 'r',
    'ԁ': 'd', 'ď': 'd', 'đ': 'd',
    'ġ': 'g', 'ğ': 'g', 'ĝ': 'g', 'ģ': 'g',
    'ĵ': 'j',
    'ĺ': 'l', 'ļ': 'l', 'ľ': 'l', 'ŀ': 'l', 'ł': 'l',
    'ń': 'n', 'ņ': 'n', 'ň': 'n', 'ŋ': 'n', 'ñ': 'n',
    'ź': 'z', 'ż': 'z', 'ž': 'z',
    'ŵ': 'w',
  };

  /// Normalize text for matching: lowercase → homoglyph/diacritic fold →
  /// leet fold → separator/dots collapse → repeat collapse.
  ///
  /// "S.ë.x  Y4h00" becomes "sex yahoo". The result is only ever matched
  /// against the term lists — never displayed.
  static String normalize(String input) {
    final buf = StringBuffer();
    for (final rune in input.toLowerCase().runes) {
      var ch = String.fromCharCode(rune);
      ch = _homoglyphFold[ch] ?? ch;
      ch = _leetFold[ch] ?? ch;
      buf.write(ch);
    }
    var out = buf.toString();

    // Dots/underscores/dashes between letters are an evasion staple
    // ("n.s.f.w", "s_e_x") — remove separators entirely so the squashed
    // form can match, but keep spaces (they separate words).
    out = out.replaceAll(RegExp(r'[._\-*·•]'), '');

    // Collapse 3+ repeated letters to two ("seeeex" → "seex", caught by the
    // two-form match below; "goooood" → "good", a word again). Two are kept
    // so real words with double letters survive intact.
    out = out.replaceAllMapped(
      RegExp(r'(.)\1{2,}'),
      (m) => '${m.group(1)}${m.group(1)}',
    );

    return out;
  }

  /// Tokenize normalized text on non-letter boundaries (CJK runs are kept
  /// whole — they carry no spaces).
  static List<String> _tokens(String normalized) {
    return normalized
        .split(RegExp(r'[^\p{L}\p{N}]+', unicode: true))
        .where((t) => t.isNotEmpty)
        .toList();
  }

  // ── Term matching ────────────────────────────────────────────────

  /// Digit-as-letter fold used ONLY for the evasion-form match ("0nlyf4ns").
  /// Kept out of [normalize] so innocent tokens keep their digits.
  static const _digitFold = {
    '0': 'o',
    '1': 'i',
    '3': 'e',
    '4': 'a',
    '5': 's',
    '7': 't',
    '8': 'b',
    '9': 'g',
  };

  /// Evasion forms of a token: digits folded to letters ("0nlyf4ns" →
  /// "onlyfans") and digits stripped ("hotgirls4u" → "hotgirlsu" → no —
  /// stripping catches the "s3x"→"sx" case that folding misses when the
  /// digit is the LAST char of a leet word). Both forms match against the
  /// term list; a token with no digits yields neither.
  static Set<String> _evasionForms(String token) {
    if (!RegExp(r'[0-9]').hasMatch(token)) return const {};
    final buf = StringBuffer();
    for (final rune in token.runes) {
      final ch = String.fromCharCode(rune);
      buf.write(_digitFold[ch] ?? ch);
    }
    final folded = buf.toString();
    final stripped = token.replaceAll(RegExp(r'[0-9]'), '');
    return {
      if (folded != token) folded,
      if (stripped.length >= 3) stripped,
    };
  }

  /// Whether [text] (already normalized) contains any term from [terms].
  ///
  /// Single-token terms match on token equality ("sex" does not match
  /// "sexton"), on either the token as-is or its digit-folded evasion form.
  /// Multi-word phrases and CJK terms match as squashed substrings — CJK
  /// text has no token boundaries to anchor on.
  static String? _firstMatch(String normalizedText, Iterable<String> terms) {
    if (normalizedText.isEmpty) return null;

    final tokens = _tokens(normalizedText);
    final tokenSet = tokens.toSet();
    final foldedSet = <String>{
      for (final t in tokens) ..._evasionForms(t),
    };
    final squashed = normalizedText.replaceAll(RegExp(r'\s+'), '');

    for (final term in terms) {
      final t = normalize(term);
      if (t.isEmpty) continue;

      final isCjk = RegExp(r'[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]')
          .hasMatch(t);
      if (isCjk) {
        if (squashed.contains(t.replaceAll(RegExp(r'\s+'), ''))) return term;
        continue;
      }

      if (t.contains(' ')) {
        if (squashed.contains(t.replaceAll(RegExp(r'\s+'), ''))) return term;
      } else {
        if (tokenSet.contains(t) || foldedSet.contains(t)) return term;
        // Long terms (≥6 chars) also match as token prefixes on evasion
        // forms: "hotgirls4u" folds/strips to forms containing "hotgirls",
        // and a 6+ letter adult term at the start of a username token is a
        // strong signal — while short terms stay token-exact ("sex" must
        // not match "Essex").
        if (t.length >= 6) {
          final prefixHit = [...tokenSet, ...foldedSet].any(
            (tok) => tok.length > t.length && tok.startsWith(t),
          );
          if (prefixHit) return term;
        }
      }
    }
    return null;
  }

  // ── Spam link detection ──────────────────────────────────────────

  static final _urlRe = RegExp(
    r'https?://[^\s<>"\)]+|(?:^|\s)(?:www\.)?[a-z0-9-]+\.(?:com|net|org|info|xyz|top|icu|club|live|loan|bid|win|vip|work|date|men|online|site|website|space|fun|store|link|click|download|racing|review|stream|party|gdn|tk|ml|ga|cf|gq|cn|cc|pw)(?:/[^\s<>"\)]*)?',
    caseSensitive: false,
  );

  /// Paths that are search-spam near enough to always count. The first two
  /// are the pattern the whole class is named after.
  static final _spamPathRe = RegExp(
    r'/(?:search|find|seek|query|so|sousuo|chazhao)\.(?:html?|php|aspx?|jsp)\b',
    caseSensitive: false,
  );

  /// Domains seen in documented spam waves. Deliberately short — a TLD or
  /// host seen in the 92k-labelled Nostr spam set, not a guess.
  static final _spamHostRe = RegExp(
    r'(?:^|[.@/])(?:t\.me|postimg\.cc|bb38\.top|xdjz6\.nl|minepi\.com|download\.starnetwork\.io)\b',
    caseSensitive: false,
  );

  // ── Hashtag-spam detection ───────────────────────────────────────

  /// Hashtag tokens in the raw content ("#ziwei-comm-anchor").
  static final _hashtagRe = RegExp(r'#[\p{L}\p{N}_-]+', unicode: true);

  /// The anchor-spam shape: a hashtag that exists to anchor a feed, not to
  /// say anything. Two markers seen in the wild ("-comm-anchor" is the one
  /// that gave the class its name): a generated-looking compound ending in
  /// a routing word, and a long tag with no vowels.
  static final _anchorSuffixRe = RegExp(
    r'-(?:comm-anchor|anchor|channel|router|feed|hub|relay|drop)$',
    caseSensitive: false,
  );

  /// Judge hashtag use. A post whose whole content is hashtags is an
  /// anchor, not a thought — it exists to plant the tag in feeds (the
  /// "#ziwei-comm-anchor" pattern). A post stuffing more hashtags than a
  /// person would type is stuffing, for the same reason.
  ///
  /// Limits follow Amethyst's `hasExcessiveHashtags` work (the other client
  /// that fought this wave): >5 hashtags is stuffing, a hashtag-only post
  /// is an anchor.
  String? _hashtagSpamReason(NostrEvent event) {
    final content = event.content.trim();
    if (content.isEmpty) return null;

    // Count hashtags in the content itself (the visible ones — the t tags
    // can be inflated separately and are checked next).
    final contentTags = _hashtagRe.allMatches(content)
        .map((m) => m.group(0)!.toLowerCase())
        .toSet();

    // Anchor-shaped tags: any single one marks the post.
    for (final tag in contentTags) {
      if (_anchorSuffixRe.hasMatch(tag)) return 'anchor-tag';
    }

    // Hashtag-only: strip hashtags and whitespace — nothing left means the
    // post was never meant to be read, only indexed.
    final withoutTags = content.replaceAll(_hashtagRe, '').trim();
    final wordsLeft = withoutTags
        .split(RegExp(r'\s+'))
        .where((w) => w.isNotEmpty)
        .length;
    if (contentTags.isNotEmpty && wordsLeft == 0) {
      return 'hashtag-only-post';
    }
    // One hashtag plus one word ("#ziwei-comm-anchor soon") is still the
    // anchor, wearing a word as camouflage.
    if (contentTags.isNotEmpty && wordsLeft <= 2 && contentTags.length >= 2) {
      return 'hashtag-anchor-post';
    }

    // Excessive hashtags, content + t tags combined. A long post genuinely
    // about six topics passes five; spam passes twenty.
    final tTags = event.getTags('t').map((t) => t.toLowerCase()).toSet();
    final allTags = {...contentTags, ...tTags};
    if (allTags.length > 5) return 'hashtag-stuffing';

    return null;
  }

  /// Count URLs and words, then judge. A post that is mostly links, carries
  /// a known-spam host, or links at a "search.*" page is a link dump.
  String? _spamLinkReason(String content) {
    final matches = _urlRe.allMatches(content).toList();
    if (matches.isEmpty) return null;

    for (final m in matches) {
      final url = m.group(0)!;
      if (_spamPathRe.hasMatch(url)) return 'search-link-spam';
      if (_spamHostRe.hasMatch(url)) return 'spam-host';
    }

    // >3 links from a stranger is a dump, not a recommendation.
    if (matches.length > 3) return 'link-dump';

    // Link-heavy: links cover most of the visible text.
    final linkChars =
        matches.fold<int>(0, (sum, m) => sum + m.end - m.start);
    if (matches.length >= 2 &&
        content.isNotEmpty &&
        linkChars / content.length > 0.6) {
      return 'mostly-links';
    }

    return null;
  }

  // ── Public API ───────────────────────────────────────────────────

  /// Judge an event. [authorProfile] is passed when already loaded (feed
  /// cards load it anyway) so an author with explicit names/bios hides
  /// their posts too.
  FilterVerdict verdictForEvent(
    NostrEvent event, {
    NostrProfile? authorProfile,
    // Media posts (reels kind 21/22, pictures kind 20) carry URLs as their
    // CONTENT — the video/poster URL is the whole point, so the link-dump
    // ratio must not judge them (a lone video URL is 100% "mostly-links" and
    // every reel hid — the "all reels hidden by content filter" bug).
    bool isMediaPost = false,
  }) {
    if (blockedAuthors.contains(event.pubkey)) {
      return const FilterVerdict(FilterAction.hide, 'blocked-author');
    }

    // 1. The author's own label is honored first — warn, don't hide.
    if (nsfwTermsEnabled) {
      final cw = event.getTag('content-warning');
      if (cw != null) {
        return const FilterVerdict(FilterAction.warn, 'content-warning');
      }
      for (final tag in event.hashtags) {
        final t = tag.toLowerCase();
        if (t == 'nsfw' || t == 'nudity' || t == 'sensitive') {
          return const FilterVerdict(FilterAction.warn, 'nsfw-tag');
        }
      }
    }

    // 2. Spam hides outright — links and hashtag anchors. Media posts skip
    //    the LINK-ratio rules (their URLs are the content); the hashtag
    //    rules still apply (a stuffed/anchor reel is still spam).
    if (spamLinksEnabled && !isMediaPost) {
      final spam = _spamLinkReason(event.content);
      if (spam != null) return FilterVerdict(FilterAction.hide, spam);
    }
    if (spamLinksEnabled) {
      final hashtagSpam = _hashtagSpamReason(event);
      if (hashtagSpam != null) {
        return FilterVerdict(FilterAction.hide, hashtagSpam);
      }
    }

    // 3. Explicit text / blocked words.
    final normalized = normalize(event.content);
    if (nsfwTermsEnabled) {
      final word = _firstMatch(normalized, kExplicitTerms);
      if (word != null) {
        return const FilterVerdict(FilterAction.hide, 'explicit-content');
      }
    }
    final userWord = _firstMatch(normalized, blockedWords);
    if (userWord != null) {
      return const FilterVerdict(FilterAction.hide, 'blocked-word');
    }

    // 4. The author's profile, when loaded.
    if (nsfwTermsEnabled && isExplicitProfile(authorProfile)) {
      return const FilterVerdict(FilterAction.hide, 'nsfw-profile');
    }

    return FilterVerdict.show;
  }

  /// Whether a profile's name/bio marks it explicit. The username people
  /// search by, the display name, the bio, and the NIP-05 handle are all
  /// checked — the user asked for names "in any language", and the term
  /// lists carry 30+.
  bool isExplicitProfile(NostrProfile? profile) {
    if (profile == null || !nsfwTermsEnabled) return false;
    final haystack = normalize(
      [profile.name, profile.displayName, profile.about, profile.nip05]
          .whereType<String>()
          .join(' '),
    );
    return _firstMatch(haystack, kExplicitProfileTerms) != null;
  }

  /// Judge a profile on its own (user search results, profile screens).
  FilterVerdict verdictForProfile(NostrProfile? profile, String pubkey) {
    if (blockedAuthors.contains(pubkey)) {
      return const FilterVerdict(FilterAction.hide, 'blocked-author');
    }
    if (isExplicitProfile(profile)) {
      return const FilterVerdict(FilterAction.hide, 'nsfw-profile');
    }
    return FilterVerdict.show;
  }
}
