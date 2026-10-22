import 'dart:convert';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';
import 'package:nostrfeed_mobile/core/models/nostr_models.dart';
import 'package:nostrfeed_mobile/core/providers/app_providers.dart';
import 'package:nostrfeed_mobile/core/utils/media.dart';
import 'package:nostrfeed_mobile/core/utils/nip19.dart';
import 'package:nostrfeed_mobile/features/feed/presentation/widgets/link_preview_card.dart';
import 'package:nostrfeed_mobile/features/feed/presentation/widgets/video_card.dart';
import 'package:url_launcher/url_launcher.dart';

/// Renders a Nostr event's content with full markdown support:
/// - Headers (#, ##, ###, etc.)
/// - Bold, italic, strikethrough
/// - Inline code and code blocks with syntax highlighting
/// - Clickable URLs with link preview cards
/// - Clickable #hashtags → hashtag feed
/// - Clickable @mentions (nostr:npub1… / nostr:nprofile1…) → profile
/// - nostr:note1… / nostr:nevent1… → thread view
/// - Inline image previews for image URLs
/// - nostr:naddr1… → addressable view
/// - Lists (ordered and unordered)
/// - Blockquotes
class NoteContent extends ConsumerWidget {
  final NostrEvent event;
  final TextStyle? textStyle;
  final int? maxLines;
  final bool showImages;

  const NoteContent({
    super.key,
    required this.event,
    this.textStyle,
    this.maxLines,
    this.showImages = true,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // The heavy pure parsing (regex segmentation, media split, imeta) is
    // memoized per event — a feed card rebuilds whenever ANY provider it
    // watches updates, and re-running the parser each time is what janks the
    // scroll as the feed grows. See _NoteParseCache.
    final parsed = _NoteParseCache.of(event);
    if (parsed.content.isEmpty) return const SizedBox.shrink();

    final defaultStyle =
        textStyle ??
        Theme.of(context).textTheme.bodyMedium!.copyWith(height: 1.45);

    final render = parsed.render;
    final imeta = parsed.imeta;

    // Media-only post: the whole content was image/video URLs, so the text
    // column has nothing but invisible hidden-URL spans — an "empty card"
    // (author + timestamp, no body) is the bug that drew attention here.
    // Collapse the text column entirely and show only the media.
    final hasVisibleText = render.textSegments.any(
      (s) =>
          (s is _TextSegment && s.text.trim().isNotEmpty) ||
          (s is _FormattedTextSegment && s.text.trim().isNotEmpty) ||
          // Image/video URLs were pulled out of textSegments already, so a
          // URL segment still here is a visible link (plain or audio).
          s is _UrlSegment ||
          s is _NostrRefSegment ||
          s is _HashtagSegment ||
          s is _CodeBlockSegment ||
          s is _HeaderSegment ||
          s is _BlockquoteSegment ||
          s is _ListItemSegment,
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (hasVisibleText)
          _ContentRenderer(
            segments: render.textSegments,
            defaultStyle: defaultStyle,
            maxLines: maxLines,
          ),
        if (showImages && render.images.isNotEmpty) ...[
          const SizedBox(height: 8),
          _ImageGallery(urls: render.images, imeta: imeta),
        ],
        // Videos render as playable/branded cards (all types).
        for (final videoUrl in render.videos)
          VideoCard(url: videoUrl, imeta: imeta[videoUrl]),
        // A lone plain link (the post is basically just a shared URL) gets a
        // rich preview card — inline in the text too, plus the card below.
        if (_shouldShowLinkCard(render))
          LinkPreviewCard(url: render.links.first),
      ],
    );
  }

  /// Show a link preview card only when the post is dominated by a single
  /// plain link (no images/videos, and the link IS most of the text).
  bool _shouldShowLinkCard(
    ({
      List<_Segment> textSegments,
      List<String> images,
      List<String> videos,
      List<String> links,
    })
    render,
  ) {
    if (render.links.length != 1) return false;
    if (render.images.isNotEmpty || render.videos.isNotEmpty) return false;
    final textOnly = render.textSegments
        .whereType<_TextSegment>()
        .map((s) => s.text)
        .join()
        .trim();
    return textOnly.length < 80;
  }
}

/// Inline mention label that resolves a pubkey to the user's display name
/// via the shared profile cache (same one every avatar uses).
class _MentionLabel extends ConsumerWidget {
  final String pubkey;
  final TextStyle style;
  const _MentionLabel({required this.pubkey, required this.style});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profileAsync = ref.watch(profileProvider(pubkey));
    final name =
        profileAsync.valueOrNull?.displayNameOrName ??
        '${pubkey.substring(0, 8)}…';
    return GestureDetector(
      onTap: () => context.push('/profile/$pubkey'),
      child: Text('@$name', style: style),
    );
  }
}

// ─── Per-event parse cache ───────────────────────────────────────────

/// Memoizes the pure, content-derived parse of an event so a card rebuild
/// (provider fan-out — engagement/zaps/profiles landing as the feed pages in)
/// never re-runs the regex segmentation, the media split, or the imeta parse.
///
/// Keyed on event id; validity is guarded by content length + tag count (an
/// edit that changes either re-parses). Bounded LRU so a long session's
/// scrolled-past posts don't accumulate.
class _NoteParseCache {
  _NoteParseCache._();

  static const int _maxEntries = 400;
  static final Map<String, _ParsedNote> _map = {};

  /// The parsed form of [event]: extracted text, the render split, imeta.
  static _ParsedNote of(NostrEvent event) {
    final key = event.id;
    final cached = _map[key];
    if (cached != null &&
        cached.contentLength == event.content.length &&
        cached.tagCount == event.tags.length) {
      // LRU touch: move to the end (most-recently-used).
      _map.remove(key);
      _map[key] = cached;
      return cached;
    }
    final parsed = _ParsedNote._from(event);
    _map[key] = parsed;
    if (_map.length > _maxEntries) {
      _map.remove(_map.keys.first); // evict least-recently-used
    }
    return parsed;
  }
}

/// The cached, content-derived parse of one event.
class _ParsedNote {
  /// Human-readable text after unwrapping JSON wrappers.
  final String content;

  /// Text segments + media/links split, ready for rendering.
  final ({
    List<_Segment> textSegments,
    List<String> images,
    List<String> videos,
    List<String> links,
  })
  render;

  /// NIP-92 imeta tags keyed by URL.
  final Map<String, ImetaInfo> imeta;

  final int contentLength;
  final int tagCount;

  _ParsedNote._(this.content, this.render, this.imeta, this.contentLength, this.tagCount);

  factory _ParsedNote._from(NostrEvent event) {
    final text = _extractContent(event.content);
    final segments = text.isEmpty ? const <_Segment>[] : _ContentParser.parse(text);
    final render = _ContentParser.splitForRender(segments, event);
    final imeta = MediaUtils.parseImeta(event);
    return _ParsedNote._(text, render, imeta, event.content.length, event.tags.length);
  }
}

// ─── Content Parser ─────────────────────────────────────────────────

class _ContentParser {
  static final _urlRegex = RegExp(
    r'https?://[^\s<>"\)\]]+',
    caseSensitive: false,
  );
  static final _hashtagRegex = RegExp(r'#(\w+)');
  static final _nostrRegex = RegExp(
    r'nostr:(npub1[a-z0-9]+|nprofile1[a-z0-9]+|note1[a-z0-9]+|nevent1[a-z0-9]+|naddr1[a-z0-9]+)',
    caseSensitive: false,
  );
  // Bare bech32 keys (npub/nsec/nprofile) without the nostr: prefix.
  static final _bareKeyRegex = RegExp(
    r'\b(npub1[a-z0-9]{20,}|nsec1[a-z0-9]{20,}|nprofile1[a-z0-9]{20,})\b',
    caseSensitive: false,
  );
  // Bare 64-char hex keys dumped into content — the "just long keys" posts.
  // A raw pubkey renders as an unreadable 64-char wall; treat it like a
  // mention so it resolves to a name.
  static final _bareHexRegex = RegExp(
    r'(?<![0-9a-z])[0-9a-f]{64}(?![0-9a-z])',
    caseSensitive: false,
  );
  static final _imageRegex = RegExp(
    r'\.(jpg|jpeg|png|gif|webp|svg|avif|heic|bmp)(\?[^\s]*)?$',
    caseSensitive: false,
  );
  static final _codeBlockRegex = RegExp(
    r'```(\w+)?\n([\s\S]*?)```',
    multiLine: true,
  );
  static final _inlineCodeRegex = RegExp(r'`([^`]+)`');
  static final _boldRegex = RegExp(r'\*\*([^*]+)\*\*');
  static final _italicRegex = RegExp(r'\*([^*]+)\*');
  static final _strikethroughRegex = RegExp(r'~~([^~]+)~~');
  static final _headerRegex = RegExp(r'^(#{1,6})\s+(.+)$', multiLine: true);
  static final _unorderedListRegex = RegExp(
    r'^\s*[-*+]\s+(.+)$',
    multiLine: true,
  );
  static final _orderedListRegex = RegExp(
    r'^\s*\d+\.\s+(.+)$',
    multiLine: true,
  );
  static final _blockquoteRegex = RegExp(r'^>\s+(.+)$', multiLine: true);

  static List<_Segment> parse(String content) {
    final segments = <_Segment>[];

    // First, extract code blocks (highest priority)
    final codeBlocks = <({int start, int end, String language, String code})>[];
    for (final m in _codeBlockRegex.allMatches(content)) {
      codeBlocks.add((
        start: m.start,
        end: m.end,
        language: m.group(1) ?? '',
        code: m.group(2) ?? '',
      ));
    }

    // Process content, replacing code blocks with placeholders
    var processedContent = content;
    var offset = 0;
    for (final block in codeBlocks) {
      final placeholder = '\x00CODE${codeBlocks.indexOf(block)}\x00';
      final adjustedStart = block.start + offset;
      final adjustedEnd = block.end + offset;
      processedContent = processedContent.replaceRange(
        adjustedStart,
        adjustedEnd,
        placeholder,
      );
      offset += placeholder.length - (block.end - block.start);
    }

    // Extract URLs and nostr refs from remaining content
    final matches = <({int start, int end, _SegmentType type})>[];

    // Nostr references (highest priority)
    for (final m in _nostrRegex.allMatches(processedContent)) {
      matches.add((start: m.start, end: m.end, type: _SegmentType.nostrRef));
    }

    // Bare bech32 keys (npub/nsec/nprofile) — same treatment, skip overlaps.
    for (final m in _bareKeyRegex.allMatches(processedContent)) {
      final overlaps = matches.any(
        (x) =>
            (m.start >= x.start && m.start < x.end) ||
            (m.end > x.start && m.end <= x.end),
      );
      if (!overlaps) {
        matches.add((start: m.start, end: m.end, type: _SegmentType.nostrRef));
      }
    }

    // Bare hex pubkeys — resolve to a name like a mention.
    for (final m in _bareHexRegex.allMatches(processedContent)) {
      final overlaps = matches.any(
        (x) =>
            (m.start >= x.start && m.start < x.end) ||
            (m.end > x.start && m.end <= x.end),
      );
      if (!overlaps) {
        matches.add((start: m.start, end: m.end, type: _SegmentType.hexKey));
      }
    }

    // URLs
    for (final m in _urlRegex.allMatches(processedContent)) {
      final overlaps = matches.any(
        (x) =>
            (m.start >= x.start && m.start < x.end) ||
            (m.end > x.start && m.end <= x.end),
      );
      if (!overlaps) {
        matches.add((start: m.start, end: m.end, type: _SegmentType.url));
      }
    }

    // Hashtags
    for (final m in _hashtagRegex.allMatches(processedContent)) {
      final overlaps = matches.any(
        (x) =>
            (m.start >= x.start && m.start < x.end) ||
            (m.end > x.start && m.end <= x.end),
      );
      if (!overlaps) {
        matches.add((start: m.start, end: m.end, type: _SegmentType.hashtag));
      }
    }

    // Sort matches by position
    matches.sort((a, b) => a.start.compareTo(b.start));

    // Build segments
    var cursor = 0;
    for (final m in matches) {
      if (m.start > cursor) {
        _addTextSegments(
          segments,
          processedContent.substring(cursor, m.start),
          codeBlocks,
        );
      }

      final text = processedContent.substring(m.start, m.end);
      switch (m.type) {
        case _SegmentType.url:
          segments.add(_UrlSegment(text, isImage: _imageRegex.hasMatch(text)));
          break;
        case _SegmentType.hashtag:
          segments.add(_HashtagSegment(text));
          break;
        case _SegmentType.nostrRef:
          segments.add(_NostrRefSegment(text));
          break;
        case _SegmentType.hexKey:
          segments.add(_HexKeySegment(text));
          break;
      }
      cursor = m.end;
    }

    if (cursor < processedContent.length) {
      _addTextSegments(
        segments,
        processedContent.substring(cursor),
        codeBlocks,
      );
    }

    return segments;
  }

  /// Split parsed segments into render groups: text (with links/hashtags),
  /// image URLs, video URLs, and plain external links (for link previews).
  static ({
    List<_Segment> textSegments,
    List<String> images,
    List<String> videos,
    List<String> links,
  })
  splitForRender(List<_Segment> segments, NostrEvent event) {
    final images = <String>[];
    final videos = <String>[];
    final links = <String>[];
    final textSegments = <_Segment>[];

    for (final s in segments) {
      if (s is _UrlSegment) {
        final mediaType = MediaUtils.classify(s.url);
        switch (mediaType) {
          case MediaType.image:
            images.add(s.url);
          case MediaType.video:
            videos.add(s.url);
          case MediaType.audio:
          case MediaType.other:
            // Plain links stay inline in text AND get a preview card if
            // they're the only content (common for shared links).
            links.add(s.url);
            textSegments.add(s);
        }
      } else {
        textSegments.add(s);
      }
    }
    return (
      textSegments: textSegments,
      images: images,
      videos: videos,
      links: links,
    );
  }

  static void _addTextSegments(
    List<_Segment> segments,
    String text,
    List<({int start, int end, String language, String code})> codeBlocks,
  ) {
    if (text.isEmpty) return;

    // Check for code block placeholders
    final placeholderRegex = RegExp(r'\x00CODE(\d+)\x00');
    var lastEnd = 0;

    for (final m in placeholderRegex.allMatches(text)) {
      // Add text before placeholder
      if (m.start > lastEnd) {
        final beforeText = text.substring(lastEnd, m.start);
        _addFormattedTextSegments(segments, beforeText);
      }

      // Add code block
      final index = int.parse(m.group(1)!);
      if (index < codeBlocks.length) {
        final block = codeBlocks[index];
        segments.add(_CodeBlockSegment(block.code, block.language));
      }

      lastEnd = m.end;
    }

    // Add remaining text
    if (lastEnd < text.length) {
      final remainingText = text.substring(lastEnd);
      _addFormattedTextSegments(segments, remainingText);
    }
  }

  static void _addFormattedTextSegments(List<_Segment> segments, String text) {
    if (text.isEmpty) return;

    final hasBlockFormatting =
        _headerRegex.hasMatch(text) ||
        _blockquoteRegex.hasMatch(text) ||
        _unorderedListRegex.hasMatch(text) ||
        _orderedListRegex.hasMatch(text);

    // Fast path — no block formatting at all
    if (!hasBlockFormatting) {
      _addInlineOrText(segments, text);
      return;
    }

    // Line-by-line so block constructs can span/be detected per line.
    // Each non-block line still goes through inline formatting, so
    // **bold** and `code` next to headers keep working.
    final lines = text.split('\n');
    var inList = false;
    var isOrdered = false;

    void closeList() {
      if (inList) {
        segments.add(_ListEndSegment());
        inList = false;
      }
    }

    for (var i = 0; i < lines.length; i++) {
      final line = lines[i];
      final suffix = i < lines.length - 1 ? '\n' : '';

      final headerMatch = _headerRegex.firstMatch(line);
      if (headerMatch != null) {
        closeList();
        segments.add(
          _HeaderSegment(headerMatch.group(2)!, headerMatch.group(1)!.length),
        );
        continue;
      }

      final quoteMatch = _blockquoteRegex.firstMatch(line);
      if (quoteMatch != null) {
        closeList();
        segments.add(_BlockquoteSegment(quoteMatch.group(1)!));
        continue;
      }

      final unorderedMatch = _unorderedListRegex.firstMatch(line);
      if (unorderedMatch != null) {
        if (!inList || isOrdered) {
          closeList();
          segments.add(_ListStartSegment(isOrdered: false));
          inList = true;
          isOrdered = false;
        }
        segments.add(_ListItemSegment(unorderedMatch.group(1)!));
        continue;
      }

      final orderedMatch = _orderedListRegex.firstMatch(line);
      if (orderedMatch != null) {
        if (!inList || !isOrdered) {
          closeList();
          segments.add(_ListStartSegment(isOrdered: true));
          inList = true;
          isOrdered = true;
        }
        segments.add(_ListItemSegment(orderedMatch.group(1)!));
        continue;
      }

      // Ordinary line — close any open list and run inline formatting
      closeList();
      if (line.isNotEmpty) {
        _addInlineOrText(segments, '$line$suffix');
      } else if (suffix.isNotEmpty) {
        segments.add(_TextSegment(suffix));
      }
    }

    closeList();
  }

  /// Inline formatting (bold/italic/code/strike) or plain text.
  static void _addInlineOrText(List<_Segment> segments, String text) {
    if (_inlineCodeRegex.hasMatch(text) ||
        _boldRegex.hasMatch(text) ||
        _italicRegex.hasMatch(text) ||
        _strikethroughRegex.hasMatch(text)) {
      segments.add(_FormattedTextSegment(text));
    } else {
      segments.add(_TextSegment(text));
    }
  }
}

// ─── Segment Types ───────────────────────────────────────────────────

enum _SegmentType { url, hashtag, nostrRef, hexKey }

abstract class _Segment {}

class _TextSegment extends _Segment {
  final String text;
  _TextSegment(this.text);
}

class _FormattedTextSegment extends _Segment {
  final String text;
  _FormattedTextSegment(this.text);
}

class _UrlSegment extends _Segment {
  final String url;
  final bool isImage;
  _UrlSegment(this.url, {this.isImage = false});
}

class _HashtagSegment extends _Segment {
  final String hashtag;
  _HashtagSegment(this.hashtag);
}

class _NostrRefSegment extends _Segment {
  final String ref;
  _NostrRefSegment(this.ref);
}

class _HexKeySegment extends _Segment {
  final String hex;
  _HexKeySegment(this.hex);
}

class _CodeBlockSegment extends _Segment {
  final String code;
  final String language;
  _CodeBlockSegment(this.code, this.language);
}

class _HeaderSegment extends _Segment {
  final String text;
  final int level;
  _HeaderSegment(this.text, this.level);
}

class _BlockquoteSegment extends _Segment {
  final String text;
  _BlockquoteSegment(this.text);
}

class _ListStartSegment extends _Segment {
  final bool isOrdered;
  _ListStartSegment({required this.isOrdered});
}

class _ListEndSegment extends _Segment {}

class _ListItemSegment extends _Segment {
  final String text;
  _ListItemSegment(this.text);
}

// ─── Content Renderer ────────────────────────────────────────────────

class _ContentRenderer extends StatelessWidget {
  final List<_Segment> segments;
  final TextStyle defaultStyle;
  final int? maxLines;

  const _ContentRenderer({
    required this.segments,
    required this.defaultStyle,
    this.maxLines,
  });

  @override
  Widget build(BuildContext context) {
    final widgets = <Widget>[];
    var currentSpans = <InlineSpan>[];
    var listStack = <bool>[];

    void flushSpans() {
      if (currentSpans.isNotEmpty) {
        widgets.add(
          Text.rich(
            TextSpan(style: defaultStyle, children: currentSpans),
            maxLines: maxLines,
            overflow: maxLines != null ? TextOverflow.ellipsis : null,
          ),
        );
        currentSpans = [];
      }
    }

    for (final segment in segments) {
      switch (segment) {
        case _TextSegment():
          // Re-sanitize: parser substring splits can cut surrogate pairs.
          currentSpans.add(TextSpan(text: sanitizeText(segment.text)));
          break;

        case _FormattedTextSegment():
          currentSpans.add(
            _buildFormattedText(context, sanitizeText(segment.text)),
          );
          break;

        case _UrlSegment():
          if (segment.isImage) {
            // Hide image URLs, they're rendered below
            currentSpans.add(
              TextSpan(
                text: sanitizeText(segment.url),
                style: const TextStyle(fontSize: 0.1, color: Colors.transparent),
              ),
            );
          } else {
            currentSpans.add(
              TextSpan(
                text: sanitizeText(segment.url),
                style: defaultStyle.copyWith(
                  color: Theme.of(context).colorScheme.primary,
                  decoration: TextDecoration.underline,
                ),
                recognizer: TapGestureRecognizer()
                  ..onTap = () => _openUrl(segment.url),
              ),
            );
          }
          break;

        case _HashtagSegment():
          currentSpans.add(
            TextSpan(
              text: sanitizeText(segment.hashtag),
              style: defaultStyle.copyWith(
                color: Theme.of(context).colorScheme.primary,
                fontWeight: FontWeight.w600,
              ),
              recognizer: TapGestureRecognizer()
                ..onTap = () => context.push(
                  '/hashtag/${Uri.encodeComponent(segment.hashtag.substring(1))}',
                ),
            ),
          );
          break;

        case _NostrRefSegment():
          // Mentions resolve to the user's NAME (not just a truncated key) —
          // WidgetSpan with a live profile lookup. Other refs (note/event/
          // address/key) get typed icons + tap-through.
          currentSpans.add(_nostrRefSpan(context, segment.ref));
          break;

        case _HexKeySegment():
          // A raw 64-char hex key renders as the person's name, like a
          // mention — never the unreadable wall of hex itself.
          currentSpans.add(
            WidgetSpan(
              alignment: PlaceholderAlignment.baseline,
              baseline: TextBaseline.alphabetic,
              child: _MentionLabel(
                pubkey: segment.hex,
                style: defaultStyle.copyWith(
                  color: Theme.of(context).colorScheme.primary,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          );
          break;

        case _CodeBlockSegment():
          flushSpans();
          widgets.add(
            _CodeBlock(
              code: sanitizeText(segment.code),
              language: segment.language,
            ),
          );
          break;

        case _HeaderSegment():
          flushSpans();
          widgets.add(_Header(text: sanitizeText(segment.text), level: segment.level));
          break;

        case _BlockquoteSegment():
          flushSpans();
          widgets.add(_Blockquote(text: sanitizeText(segment.text)));
          break;

        case _ListStartSegment():
          flushSpans();
          listStack.add(segment.isOrdered);
          break;

        case _ListItemSegment():
          widgets.add(
            _ListItem(
              text: sanitizeText(segment.text),
              isOrdered: listStack.isNotEmpty ? listStack.last : false,
              index: widgets.whereType<_ListItem>().length + 1,
            ),
          );
          break;

        case _ListEndSegment():
          if (listStack.isNotEmpty) {
            listStack.removeLast();
          }
          break;
      }
    }

    flushSpans();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: widgets,
    );
  }

  InlineSpan _buildFormattedText(BuildContext context, String text) {
    final spans = <InlineSpan>[];
    var remaining = text;

    final patterns = [
      (RegExp(r'`([^`]+)`'), (Match m) => _InlineCodeSpan(m.group(1)!)),
      (RegExp(r'\*\*([^*]+)\*\*'), (Match m) => _BoldSpan(m.group(1)!)),
      (RegExp(r'\*([^*]+)\*'), (Match m) => _ItalicSpan(m.group(1)!)),
      (RegExp(r'~~([^~]+)~~'), (Match m) => _StrikethroughSpan(m.group(1)!)),
    ];

    while (remaining.isNotEmpty) {
      Match? earliestMatch;
      Function(Match)? earliestBuilder;
      var earliestIndex = remaining.length;

      for (final (pattern, builder) in patterns) {
        final match = pattern.firstMatch(remaining);
        if (match != null && match.start < earliestIndex) {
          earliestIndex = match.start;
          earliestMatch = match;
          earliestBuilder = builder;
        }
      }

      if (earliestMatch == null) {
        spans.add(TextSpan(text: sanitizeText(remaining)));
        break;
      }

      // Add text before match
      if (earliestMatch.start > 0) {
        spans.add(TextSpan(text: sanitizeText(remaining.substring(0, earliestMatch.start))));
      }

      // Add formatted span
      final formattedSpan = earliestBuilder!(earliestMatch);
      spans.add(formattedSpan.build(context));

      remaining = remaining.substring(earliestMatch.end);
    }

    return TextSpan(children: spans);
  }

  /// Inline span for a Nostr reference: mentions get a tappable label that
  /// resolves to a real name via _MentionLabel, other refs get typed icons.
  InlineSpan _nostrRefSpan(BuildContext context, String ref) {
    final id = ref.startsWith('nostr:') ? ref.substring(6) : ref;
    final decoded = decodeNip19(id);
    final scheme = Theme.of(context).colorScheme;
    final style = defaultStyle.copyWith(
      color: scheme.primary,
      fontWeight: FontWeight.w600,
    );

    // Mentions (npub/nprofile): a widget span resolving to the display name.
    if (decoded is Nip19Pubkey || decoded is Nip19Profile) {
      final pk = decoded is Nip19Pubkey
          ? decoded.pubkey
          : (decoded as Nip19Profile).pubkey;
      return WidgetSpan(
        alignment: PlaceholderAlignment.baseline,
        baseline: TextBaseline.alphabetic,
        child: _MentionLabel(pubkey: pk, style: style),
      );
    }

    // Other references: typed icon + tap-through.
    final (icon, label) = switch (decoded) {
      Nip19Note() || Nip19Event() => ('🔗', 'note'),
      Nip19Address() => ('📄', 'article'),
      _ => id.startsWith('nsec1') ? ('🔑', 'key') : ('', 'link'),
    };
    return TextSpan(
      text: '$icon ${label.isNotEmpty ? '$label ' : ''}${_shortId(id)}',
      style: style,
      recognizer: TapGestureRecognizer()
        ..onTap = () => _openNostrRef(context, id),
    );
  }

  /// Sanitized + truncated id for display — relay content can carry lone
  /// surrogates, and a TextSpan fed one crashes the paint pipeline.
  String _shortId(String id) {
    final clean = sanitizeText(id);
    return clean.length > 12 ? '${clean.substring(0, 10)}…' : clean;
  }

  void _openNostrRef(BuildContext context, String id) {
    final decoded = decodeNip19(id);
    switch (decoded) {
      case Nip19Pubkey(pubkey: final pk):
        context.push('/profile/$pk');
        break;
      case Nip19Profile(pubkey: final pk):
        context.push('/profile/$pk');
        break;
      case Nip19Note():
      case Nip19Event():
        context.push('/$id');
        break;
      case Nip19Address():
        context.push('/$id');
        break;
      default:
        _openUrl(id.startsWith('nostr:') ? id : 'nostr:$id');
    }
  }

  Future<void> _openUrl(String url) async {
    final uri = Uri.tryParse(url);
    if (uri == null) return;
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }
}

// ─── Formatted Span Builders ─────────────────────────────────────────

abstract class _FormattedSpan {
  InlineSpan build(BuildContext context);
}

class _InlineCodeSpan extends _FormattedSpan {
  final String text;
  _InlineCodeSpan(this.text);

  @override
  InlineSpan build(BuildContext context) {
    return TextSpan(
      text: text,
      style: TextStyle(
        fontFamily: 'monospace',
        fontSize: 13,
        backgroundColor: Theme.of(context).colorScheme.surfaceContainerHighest,
        color: Theme.of(context).colorScheme.onSurface,
      ),
    );
  }
}

class _BoldSpan extends _FormattedSpan {
  final String text;
  _BoldSpan(this.text);

  @override
  InlineSpan build(BuildContext context) {
    return TextSpan(
      text: text,
      style: const TextStyle(fontWeight: FontWeight.bold),
    );
  }
}

class _ItalicSpan extends _FormattedSpan {
  final String text;
  _ItalicSpan(this.text);

  @override
  InlineSpan build(BuildContext context) {
    return TextSpan(
      text: text,
      style: const TextStyle(fontStyle: FontStyle.italic),
    );
  }
}

class _StrikethroughSpan extends _FormattedSpan {
  final String text;
  _StrikethroughSpan(this.text);

  @override
  InlineSpan build(BuildContext context) {
    return TextSpan(
      text: text,
      style: const TextStyle(decoration: TextDecoration.lineThrough),
    );
  }
}

// ─── Widget Components ───────────────────────────────────────────────

class _CodeBlock extends StatelessWidget {
  final String code;
  final String language;

  const _CodeBlock({required this.code, required this.language});

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;

    return Container(
      margin: const EdgeInsets.symmetric(vertical: 8),
      decoration: BoxDecoration(
        color: colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: colorScheme.outline.withValues(alpha: 0.2)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header with language and copy button
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            decoration: BoxDecoration(
              color: colorScheme.surfaceContainerHigh,
              borderRadius: const BorderRadius.only(
                topLeft: Radius.circular(8),
                topRight: Radius.circular(8),
              ),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  language.isEmpty ? 'code' : language,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: colorScheme.onSurfaceVariant,
                  ),
                ),
                InkWell(
                  onTap: () {
                    Clipboard.setData(ClipboardData(text: code));
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text('Code copied to clipboard'),
                        duration: Duration(seconds: 1),
                      ),
                    );
                  },
                  child: Icon(
                    Icons.copy,
                    size: 16,
                    color: colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
          // Code content
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.all(12),
            child: SelectableText(
              code,
              style: TextStyle(
                fontFamily: 'monospace',
                fontSize: 13,
                color: colorScheme.onSurface,
                height: 1.4,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Header extends StatelessWidget {
  final String text;
  final int level;

  const _Header({required this.text, required this.level});

  @override
  Widget build(BuildContext context) {
    final fontSize = switch (level) {
      1 => 24.0,
      2 => 20.0,
      3 => 18.0,
      4 => 16.0,
      5 => 14.0,
      _ => 13.0,
    };

    return Padding(
      padding: const EdgeInsets.only(top: 12, bottom: 6),
      child: Text(
        text,
        style: TextStyle(fontSize: fontSize, fontWeight: FontWeight.bold),
      ),
    );
  }
}

class _Blockquote extends StatelessWidget {
  final String text;

  const _Blockquote({required this.text});

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;

    return Container(
      margin: const EdgeInsets.symmetric(vertical: 8),
      padding: const EdgeInsets.only(left: 12),
      decoration: BoxDecoration(
        border: Border(left: BorderSide(color: colorScheme.primary, width: 3)),
      ),
      child: Text(
        text,
        style: TextStyle(
          fontStyle: FontStyle.italic,
          color: colorScheme.onSurfaceVariant,
        ),
      ),
    );
  }
}

class _ListItem extends StatelessWidget {
  final String text;
  final bool isOrdered;
  final int index;

  const _ListItem({
    required this.text,
    required this.isOrdered,
    required this.index,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(left: 16, top: 4, bottom: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            isOrdered ? '$index. ' : '• ',
            style: const TextStyle(fontWeight: FontWeight.w500),
          ),
          Expanded(child: Text(text)),
        ],
      ),
    );
  }
}

// ─── Image Gallery ───────────────────────────────────────────────────

class _ImageGallery extends StatelessWidget {
  final List<String> urls;
  final Map<String, ImetaInfo> imeta;
  const _ImageGallery({required this.urls, this.imeta = const {}});

  @override
  Widget build(BuildContext context) {
    if (urls.length == 1) {
      final url = urls.first;
      // NIP-92: use declared dimensions for a correctly-sized tile
      // (portrait images no longer get cropped to a landscape strip).
      final ar = imeta[url]?.aspectRatio;
      return _NetworkImageTile(
        url: url,
        height: ar != null && ar < 0.8 ? 360 : 240,
        alt: imeta[url]?.alt,
      );
    }
    final crossCount = urls.length == 2 ? 2 : (urls.length == 3 ? 3 : 2);
    return GridView.count(
      crossAxisCount: crossCount,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: 4,
      crossAxisSpacing: 4,
      childAspectRatio: 1,
      children: urls.take(4).map((url) {
        return _NetworkImageTile(
          url: url,
          height: double.infinity,
          alt: imeta[url]?.alt,
        );
      }).toList(),
    );
  }
}

class _NetworkImageTile extends StatelessWidget {
  final String url;
  final double height;
  final String? alt;
  const _NetworkImageTile({required this.url, required this.height, this.alt});

  bool get _isSvg => url.toLowerCase().endsWith('.svg');

  /// The Hero tag for the feed↔fullscreen shared-element transition. URLs
  /// are unique per image, so they are the tag.
  String get _heroTag => 'feed-image:$url';

  @override
  Widget build(BuildContext context) {
    // SVGs can't Hero (they render via a different pipeline) — plain tile.
    final tile = ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: GestureDetector(
        onTap: () => _showFullscreen(context),
        child: _isSvg ? _buildSvgImage(context) : _buildRasterImage(context),
      ),
    );

    if (_isSvg) return tile;

    return Hero(tag: _heroTag, child: tile);
  }

  Widget _buildSvgImage(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Container(
      height: height == double.infinity ? null : height,
      width: double.infinity,
      decoration: BoxDecoration(
        color: colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(12),
      ),
      child: SvgPicture.network(
        url,
        height: height == double.infinity ? null : height,
        width: double.infinity,
        fit: BoxFit.cover,
        placeholderBuilder: (_) => _buildLoadingPlaceholder(context),
        errorBuilder: (_, _, _) => _buildErrorWidget(context),
      ),
    );
  }

  Widget _buildRasterImage(BuildContext context) {
    // Decode at display size (ADR-0004): the feed tile is at most ~1200 px
    // wide on any phone — decode to that, not the source's 4000 px. The
    // fullscreen view decodes separately at full size.
    final dpr = MediaQuery.devicePixelRatioOf(context);
    return CachedNetworkImage(
      imageUrl: url,
      height: height == double.infinity ? null : height,
      width: double.infinity,
      fit: BoxFit.cover,
      memCacheWidth: (1200 * dpr).round(),
      placeholder: (_, _) => _buildLoadingPlaceholder(context),
      errorWidget: (_, _, _) => _buildErrorWidget(context),
      // Suppress network errors from crashing the app
      httpHeaders: const {'Accept': 'image/*'},
      // Fade in animation for smooth loading
      fadeInDuration: const Duration(milliseconds: 300),
      fadeOutDuration: const Duration(milliseconds: 100),
    );
  }

  Widget _buildLoadingPlaceholder(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Container(
      height: height == double.infinity ? 120 : height,
      decoration: BoxDecoration(
        color: colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Center(
        child: SizedBox(
          width: 24,
          height: 24,
          child: CircularProgressIndicator(
            strokeWidth: 2,
            valueColor: AlwaysStoppedAnimation<Color>(colorScheme.primary),
          ),
        ),
      ),
    );
  }

  Widget _buildErrorWidget(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Container(
      height: height == double.infinity ? 120 : height,
      decoration: BoxDecoration(
        color: colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: colorScheme.outline.withValues(alpha: 0.2),
          width: 1,
        ),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.broken_image_outlined,
            color: colorScheme.onSurfaceVariant,
            size: 32,
          ),
          const SizedBox(height: 8),
          Text(
            'Image unavailable',
            style: TextStyle(fontSize: 12, color: colorScheme.onSurfaceVariant),
          ),
        ],
      ),
    );
  }

  void _showFullscreen(BuildContext context) {
    Navigator.of(context).push(
      PageRouteBuilder(
        opaque: false,
        barrierColor: Colors.black,
        pageBuilder: (_, _, _) => _FullscreenImage(url: url, heroTag: _heroTag),
        transitionsBuilder: (_, animation, _, child) {
          return FadeTransition(opacity: animation, child: child);
        },
      ),
    );
  }
}

/// The full-screen image: Hero-flies in from the feed tile, pinch-zoomable,
/// fades in over black. Same URL = same Hero tag = the shared element.
class _FullscreenImage extends StatelessWidget {
  final String url;
  final String heroTag;
  const _FullscreenImage({required this.url, required this.heroTag});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        iconTheme: const IconThemeData(color: Colors.white),
        elevation: 0,
      ),
      body: Center(
        child: Hero(
          tag: heroTag,
          child: InteractiveViewer(
            minScale: 0.5,
            maxScale: 4.0,
            child: CachedNetworkImage(
              imageUrl: url,
              fit: BoxFit.contain,
              placeholder: (_, _) => const Center(
                child: CircularProgressIndicator(color: Colors.white),
              ),
              errorWidget: (_, _, _) => const Center(
                child: Icon(
                  Icons.broken_image_outlined,
                  color: Colors.white54,
                  size: 64,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Extract human-readable content from an event's content field.
///
/// Some clients publish kind 1 with content like `{"content": "...", "header": "..."}`
/// which renders as raw JSON. This unwraps the actual text when it detects
/// that pattern, or returns the raw content for plain text notes.
String _extractContent(String raw) {
  final trimmed = sanitizeText(raw.trim());
  if (trimmed.isEmpty) return '';
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return trimmed;

  try {
    final parsed = jsonDecode(trimmed);
    if (parsed is Map<String, dynamic>) {
      // Common wrapper patterns — extract the text field
      for (final key in ['content', 'text', 'body', 'message']) {
        if (parsed[key] is String) return sanitizeText(parsed[key] as String);
      }
      // JSON that is NOT a text wrapper (profile data, relay lists, app
      // data, etc.) has no business being rendered as a post. Return empty
      // so the card collapses instead of showing raw JSON.
      return '';
    }
  } catch (_) {
    // Not valid JSON — return as-is (genuine text that starts with {)
  }

  return trimmed;
}

/// Try to parse an event as a repost and return the embedded original event.
/// Returns null if not a repost, if JSON parsing fails, or if the embedded
/// event is not a displayable kind (e.g. a profile or contact list JSON that
/// a kind-16 generic repost happened to wrap).
NostrEvent? extractRepostedEvent(NostrEvent event) {
  if (event.kind != 6 && event.kind != 16) return null;
  if (event.content.isEmpty) return null;

  // Only attempt to parse content that looks like JSON
  final trimmed = event.content.trim();
  if (!trimmed.startsWith('{')) return null;

  try {
    final json = jsonDecode(trimmed) as Map<String, dynamic>;
    final parsed = NostrEvent.fromJson(json);

    // Kind 6 is specifically a repost of kind 1. Kind 16 can wrap anything,
    // but we only want to display text notes — wrapping a kind 0 (profile)
    // or kind 3 (contacts) would render raw JSON as the post body.
    if (parsed.kind != 1) return null;

    return parsed;
  } catch (_) {
    return null;
  }
}
