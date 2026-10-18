import 'dart:convert';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../models/nostr_models.dart';
import '../../utils/nip19.dart';

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
    final content = event.content;
    if (content.isEmpty) return const SizedBox.shrink();

    final defaultStyle = textStyle ??
        Theme.of(context).textTheme.bodyMedium!.copyWith(height: 1.45);

    // Parse content into segments
    final segments = _ContentParser.parse(content);

    // Separate image URLs to render at the bottom
    final imageUrls = <String>[];
    for (final segment in segments) {
      if (segment is _UrlSegment && segment.isImage && showImages) {
        imageUrls.add(segment.url);
      }
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _ContentRenderer(
          segments: segments,
          defaultStyle: defaultStyle,
          maxLines: maxLines,
        ),
        if (showImages && imageUrls.isNotEmpty) ...[
          const SizedBox(height: 8),
          _ImageGallery(urls: imageUrls),
        ],
      ],
    );
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
  static final _imageRegex = RegExp(
    r'\.(jpg|jpeg|png|gif|webp|svg)(\?[^\s]*)?$',
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
  static final _unorderedListRegex = RegExp(r'^\s*[-*+]\s+(.+)$', multiLine: true);
  static final _orderedListRegex = RegExp(r'^\s*\d+\.\s+(.+)$', multiLine: true);
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

    // URLs
    for (final m in _urlRegex.allMatches(processedContent)) {
      final overlaps = matches.any((x) =>
          (m.start >= x.start && m.start < x.end) ||
          (m.end > x.start && m.end <= x.end));
      if (!overlaps) {
        matches.add((start: m.start, end: m.end, type: _SegmentType.url));
      }
    }

    // Hashtags
    for (final m in _hashtagRegex.allMatches(processedContent)) {
      final overlaps = matches.any((x) =>
          (m.start >= x.start && m.start < x.end) ||
          (m.end > x.start && m.end <= x.end));
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
        _addTextSegments(segments, processedContent.substring(cursor, m.start), codeBlocks);
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
      }
      cursor = m.end;
    }

    if (cursor < processedContent.length) {
      _addTextSegments(segments, processedContent.substring(cursor), codeBlocks);
    }

    return segments;
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

    // Check for headers
    if (_headerRegex.hasMatch(text)) {
      final lines = text.split('\n');
      for (final line in lines) {
        final headerMatch = _headerRegex.firstMatch(line);
        if (headerMatch != null) {
          segments.add(_HeaderSegment(
            headerMatch.group(2)!,
            headerMatch.group(1)!.length,
          ));
        } else if (line.isNotEmpty) {
          segments.add(_TextSegment('$line\n'));
        }
      }
      return;
    }

    // Check for blockquotes
    if (_blockquoteRegex.hasMatch(text)) {
      final lines = text.split('\n');
      for (final line in lines) {
        final quoteMatch = _blockquoteRegex.firstMatch(line);
        if (quoteMatch != null) {
          segments.add(_BlockquoteSegment(quoteMatch.group(1)!));
        } else if (line.isNotEmpty) {
          segments.add(_TextSegment('$line\n'));
        }
      }
      return;
    }

    // Check for lists
    if (_unorderedListRegex.hasMatch(text) || _orderedListRegex.hasMatch(text)) {
      final lines = text.split('\n');
      var inList = false;
      var isOrdered = false;

      for (final line in lines) {
        final unorderedMatch = _unorderedListRegex.firstMatch(line);
        final orderedMatch = _orderedListRegex.firstMatch(line);

        if (unorderedMatch != null) {
          if (!inList || isOrdered) {
            if (inList) segments.add(_ListEndSegment());
            segments.add(_ListStartSegment(isOrdered: false));
            inList = true;
            isOrdered = false;
          }
          segments.add(_ListItemSegment(unorderedMatch.group(1)!));
        } else if (orderedMatch != null) {
          if (!inList || !isOrdered) {
            if (inList) segments.add(_ListEndSegment());
            segments.add(_ListStartSegment(isOrdered: true));
            inList = true;
            isOrdered = true;
          }
          segments.add(_ListItemSegment(orderedMatch.group(1)!));
        } else if (line.isNotEmpty && inList) {
          segments.add(_ListEndSegment());
          segments.add(_TextSegment('$line\n'));
          inList = false;
        } else if (line.isNotEmpty) {
          segments.add(_TextSegment('$line\n'));
        }
      }

      if (inList) {
        segments.add(_ListEndSegment());
      }
      return;
    }

    // Check for inline formatting
    if (_inlineCodeRegex.hasMatch(text) ||
        _boldRegex.hasMatch(text) ||
        _italicRegex.hasMatch(text) ||
        _strikethroughRegex.hasMatch(text)) {
      segments.add(_FormattedTextSegment(text));
      return;
    }

    // Plain text
    segments.add(_TextSegment(text));
  }
}

// ─── Segment Types ───────────────────────────────────────────────────

enum _SegmentType { url, hashtag, nostrRef }

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
          currentSpans.add(TextSpan(text: segment.text));
          break;

        case _FormattedTextSegment():
          currentSpans.add(_buildFormattedText(context, segment.text));
          break;

        case _UrlSegment():
          if (segment.isImage) {
            // Hide image URLs, they're rendered below
            currentSpans.add(TextSpan(
              text: segment.url,
              style: TextStyle(fontSize: 0.1, color: Colors.transparent),
            ));
          } else {
            currentSpans.add(TextSpan(
              text: segment.url,
              style: defaultStyle.copyWith(
                color: Theme.of(context).colorScheme.primary,
                decoration: TextDecoration.underline,
              ),
              recognizer: TapGestureRecognizer()
                ..onTap = () => _openUrl(segment.url),
            ));
          }
          break;

        case _HashtagSegment():
          currentSpans.add(TextSpan(
            text: segment.hashtag,
            style: defaultStyle.copyWith(
              color: Theme.of(context).colorScheme.primary,
              fontWeight: FontWeight.w600,
            ),
            recognizer: TapGestureRecognizer()
              ..onTap = () => context.push(
                  '/hashtag/${Uri.encodeComponent(segment.hashtag.substring(1))}'),
          ));
          break;

        case _NostrRefSegment():
          currentSpans.add(TextSpan(
            text: _labelForNostrRef(segment.ref),
            style: defaultStyle.copyWith(
              color: Theme.of(context).colorScheme.primary,
              fontWeight: FontWeight.w600,
            ),
            recognizer: TapGestureRecognizer()
              ..onTap = () => _openNostrRef(context, segment.ref),
          ));
          break;

        case _CodeBlockSegment():
          flushSpans();
          widgets.add(_CodeBlock(
            code: segment.code,
            language: segment.language,
          ));
          break;

        case _HeaderSegment():
          flushSpans();
          widgets.add(_Header(
            text: segment.text,
            level: segment.level,
          ));
          break;

        case _BlockquoteSegment():
          flushSpans();
          widgets.add(_Blockquote(text: segment.text));
          break;

        case _ListStartSegment():
          flushSpans();
          listStack.add(segment.isOrdered);
          break;

        case _ListItemSegment():
          widgets.add(_ListItem(
            text: segment.text,
            isOrdered: listStack.isNotEmpty ? listStack.last : false,
            index: widgets.whereType<_ListItem>().length + 1,
          ));
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
        spans.add(TextSpan(text: remaining));
        break;
      }

      // Add text before match
      if (earliestMatch.start > 0) {
        spans.add(TextSpan(text: remaining.substring(0, earliestMatch.start)));
      }

      // Add formatted span
      final formattedSpan = earliestBuilder!(earliestMatch);
      spans.add(formattedSpan.build(context));

      remaining = remaining.substring(earliestMatch.end);
    }

    return TextSpan(children: spans);
  }

  String _labelForNostrRef(String ref) {
    final id = ref.substring(6);
    if (id.startsWith('npub1') || id.startsWith('nprofile1')) {
      return '@${id.substring(0, 12)}…';
    }
    if (id.startsWith('note1') || id.startsWith('nevent1')) {
      return '🔗 ${id.substring(0, 12)}…';
    }
    return '${id.substring(0, 14)}…';
  }

  void _openNostrRef(BuildContext context, String ref) {
    final id = ref.substring(6);
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
        _openUrl(ref);
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
        style: TextStyle(
          fontSize: fontSize,
          fontWeight: FontWeight.bold,
        ),
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
        border: Border(
          left: BorderSide(
            color: colorScheme.primary,
            width: 3,
          ),
        ),
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
  const _ImageGallery({required this.urls});

  @override
  Widget build(BuildContext context) {
    if (urls.length == 1) {
      return _NetworkImageTile(url: urls.first, height: 240);
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
        return _NetworkImageTile(url: url, height: double.infinity);
      }).toList(),
    );
  }
}

class _NetworkImageTile extends StatelessWidget {
  final String url;
  final double height;
  const _NetworkImageTile({required this.url, required this.height});

  bool get _isSvg => url.toLowerCase().endsWith('.svg');

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: GestureDetector(
        onTap: () => _showFullscreen(context),
        child: _isSvg ? _buildSvgImage(context) : _buildRasterImage(context),
      ),
    );
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
    return CachedNetworkImage(
      imageUrl: url,
      height: height == double.infinity ? null : height,
      width: double.infinity,
      fit: BoxFit.cover,
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
            style: TextStyle(
              fontSize: 12,
              color: colorScheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
    );
  }

  void _showFullscreen(BuildContext context) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => Scaffold(
          backgroundColor: Colors.black,
          appBar: AppBar(
            backgroundColor: Colors.black,
            iconTheme: const IconThemeData(color: Colors.white),
            elevation: 0,
          ),
          body: Center(
            child: InteractiveViewer(
              minScale: 0.5,
              maxScale: 4.0,
              child: _isSvg
                  ? SvgPicture.network(
                      url,
                      fit: BoxFit.contain,
                      placeholderBuilder: (_) => const Center(
                        child: CircularProgressIndicator(color: Colors.white),
                      ),
                      errorBuilder: (_, _, _) => const Center(
                        child: Icon(
                          Icons.broken_image_outlined,
                          color: Colors.white54,
                          size: 64,
                        ),
                      ),
                    )
                  : CachedNetworkImage(
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
      ),
    );
  }
}

/// Try to parse an event as a repost and return the embedded original event.
/// Returns null if not a repost or if JSON parsing fails.
NostrEvent? extractRepostedEvent(NostrEvent event) {
  if (event.kind != 6 && event.kind != 16) return null;
  if (event.content.isEmpty) return null;
  try {
    final json = jsonDecode(event.content) as Map<String, dynamic>;
    return NostrEvent.fromJson(json);
  } catch (_) {
    return null;
  }
}
