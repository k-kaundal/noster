import 'dart:convert';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../models/nostr_models.dart';
import '../../utils/nip19.dart';

/// Renders a Nostr event's content with:
/// - Clickable URLs
/// - Clickable #hashtags → hashtag feed
/// - Clickable @mentions (nostr:npub1… / nostr:nprofile1…) → profile
/// - nostr:note1… / nostr:nevent1… → thread view
/// - Inline image previews for image URLs
/// - nostr:naddr1… → addressable view
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
    r'\.(jpg|jpeg|png|gif|webp)(\?[^\s]*)?$',
    caseSensitive: false,
  );

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final content = event.content;
    if (content.isEmpty) return const SizedBox.shrink();

    final defaultStyle = textStyle ??
        Theme.of(context).textTheme.bodyMedium!.copyWith(height: 1.45);
    final linkStyle = defaultStyle.copyWith(
      color: Theme.of(context).colorScheme.primary,
      decoration: TextDecoration.none,
    );

    // Tokenize content
    final tokens = _tokenize(content);

    // Separate image URLs to render at the bottom
    final imageUrls = tokens
        .where((t) => t.kind == _TokenKind.url && _imageRegex.hasMatch(t.text))
        .map((t) => t.text)
        .toList();

    // Build spans (excluding trailing image URLs to avoid duplication)
    final spans = <InlineSpan>[];
    for (final token in tokens) {
      switch (token.kind) {
        case _TokenKind.text:
          spans.add(TextSpan(text: token.text));
          break;
        case _TokenKind.url:
          final isImage = _imageRegex.hasMatch(token.text);
          if (isImage && showImages) {
            // Will be rendered as image below — keep a small inline link
            spans.add(TextSpan(
              text: token.text,
              style: linkStyle.copyWith(fontSize: 0.1, color: Colors.transparent),
            ));
          } else {
            spans.add(TextSpan(
              text: token.text,
              style: linkStyle,
              recognizer: TapGestureRecognizer()
                ..onTap = () => _openUrl(token.text),
            ));
          }
          break;
        case _TokenKind.hashtag:
          spans.add(TextSpan(
            text: token.text,
            style: linkStyle.copyWith(fontWeight: FontWeight.w600),
            recognizer: TapGestureRecognizer()
              ..onTap = () => context.push(
                  '/hashtag/${Uri.encodeComponent(token.text.substring(1))}'),
          ));
          break;
        case _TokenKind.nostrRef:
          spans.add(TextSpan(
            text: _labelForNostrRef(token.text),
            style: linkStyle.copyWith(fontWeight: FontWeight.w600),
            recognizer: TapGestureRecognizer()
              ..onTap = () => _openNostrRef(context, token.text),
          ));
          break;
      }
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text.rich(
          TextSpan(style: defaultStyle, children: spans),
          maxLines: maxLines,
          overflow: maxLines != null ? TextOverflow.ellipsis : null,
        ),
        if (showImages && imageUrls.isNotEmpty) ...[
          const SizedBox(height: 8),
          _ImageGallery(urls: imageUrls),
        ],
      ],
    );
  }

  // ─── Tokenizer ─────────────────────────────────────────────────────

  List<_Token> _tokenize(String content) {
    final tokens = <_Token>[];
    final matches = <({int start, int end, _TokenKind kind})>[];

    // Nostr references (highest priority — must come before URL matching)
    for (final m in _nostrRegex.allMatches(content)) {
      matches.add((start: m.start, end: m.end, kind: _TokenKind.nostrRef));
    }

    // URLs
    for (final m in _urlRegex.allMatches(content)) {
      // Skip if overlaps with a nostr ref
      final overlaps = matches.any((x) =>
          (m.start >= x.start && m.start < x.end) ||
          (m.end > x.start && m.end <= x.end));
      if (!overlaps) {
        matches.add((start: m.start, end: m.end, kind: _TokenKind.url));
      }
    }

    // Hashtags
    for (final m in _hashtagRegex.allMatches(content)) {
      // Skip if overlaps with a URL or nostr ref (likely part of URL fragment)
      final overlaps = matches.any((x) =>
          (m.start >= x.start && m.start < x.end) ||
          (m.end > x.start && m.end <= x.end));
      if (!overlaps) {
        matches.add((start: m.start, end: m.end, kind: _TokenKind.hashtag));
      }
    }

    // Sort matches by position
    matches.sort((a, b) => a.start.compareTo(b.start));

    // Build token list with text between matches
    var cursor = 0;
    for (final m in matches) {
      if (m.start > cursor) {
        tokens.add(_Token(content.substring(cursor, m.start), _TokenKind.text));
      }
      tokens.add(_Token(content.substring(m.start, m.end), m.kind));
      cursor = m.end;
    }
    if (cursor < content.length) {
      tokens.add(_Token(content.substring(cursor), _TokenKind.text));
    }

    return tokens;
  }

  // ─── Navigation ────────────────────────────────────────────────────

  String _labelForNostrRef(String ref) {
    // "nostr:npub1abc..." → "@npub1abc…"
    final id = ref.substring(6); // remove 'nostr:'
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

// ─── Token ───────────────────────────────────────────────────────────

enum _TokenKind { text, url, hashtag, nostrRef }

class _Token {
  final String text;
  final _TokenKind kind;
  const _Token(this.text, this.kind);
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
    // Grid for multiple images
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

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: GestureDetector(
        onTap: () => _showFullscreen(context),
        child: CachedNetworkImage(
          imageUrl: url,
          height: height == double.infinity ? null : height,
          width: double.infinity,
          fit: BoxFit.cover,
          placeholder: (_, _) => Container(
            height: height == double.infinity ? 120 : height,
            color: Theme.of(context).colorScheme.surfaceContainerHighest,
            child: const Center(
              child: SizedBox(
                width: 24,
                height: 24,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            ),
          ),
          errorWidget: (_, _, _) => Container(
            height: height == double.infinity ? 120 : height,
            color: Theme.of(context).colorScheme.surfaceContainerHighest,
            child: Icon(
              Icons.broken_image_outlined,
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
          ),
        ),
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
          ),
          body: Center(
            child: InteractiveViewer(
              child: CachedNetworkImage(imageUrl: url, fit: BoxFit.contain),
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
