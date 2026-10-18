/// A small Markdown reader for article bodies, matching the web's
/// `lib/markdown.ts`. Produces structured blocks and inline spans — never
/// HTML — so nothing an author wrote can become markup injection.
library;

// ── Block types ──────────────────────────────────────────────────────

sealed class MdBlock {
  const MdBlock();
}

class MdHeading extends MdBlock {
  final int level; // 1–4, clamped from 1–6
  final String text;
  const MdHeading(this.level, this.text);
}

class MdParagraph extends MdBlock {
  final String text;
  const MdParagraph(this.text);
}

class MdList extends MdBlock {
  final bool ordered;
  final List<String> items;
  const MdList({required this.ordered, required this.items});
}

class MdQuote extends MdBlock {
  final String text;
  const MdQuote(this.text);
}

class MdCode extends MdBlock {
  final String? language;
  final String text;
  const MdCode({this.language, required this.text});
}

class MdImage extends MdBlock {
  final String url;
  final String alt;
  const MdImage({required this.url, required this.alt});
}

class MdRule extends MdBlock {
  const MdRule();
}

// ── Inline types ─────────────────────────────────────────────────────

sealed class MdInline {
  const MdInline();
}

class MdText extends MdInline {
  final String text;
  const MdText(this.text);
}

class MdBold extends MdInline {
  final String text;
  const MdBold(this.text);
}

class MdItalic extends MdInline {
  final String text;
  const MdItalic(this.text);
}

class MdInlineCode extends MdInline {
  final String text;
  const MdInlineCode(this.text);
}

class MdLink extends MdInline {
  final String text;
  final String href;
  const MdLink({required this.text, required this.href});
}

// ── Patterns ─────────────────────────────────────────────────────────

final _heading = RegExp(r'^(#{1,6})\s+(.*)$');
final _unordered = RegExp(r'^[-*+]\s+(.*)$');
final _ordered = RegExp(r'^\d+[.)]\s+(.*)$');
final _quote = RegExp(r'^>\s?(.*)$');
final _rule = RegExp(r'^(?:---+|\*\*\*+|___+)$');
final _imageOnly = RegExp(r'^!\[([^\]]*)\]\(([^)\s]+)[^)]*\)$');
final _fence = RegExp(r'^```\s*(\S*)\s*$');

// ── Block parser ─────────────────────────────────────────────────────

/// Splits an article body into blocks. Mirrors `parseMarkdown` in the web's
/// `lib/markdown.ts` exactly: same block types, same precedence, same
/// paragraph-joining behaviour.
List<MdBlock> parseMarkdown(String source) {
  final lines = source.replaceAll(RegExp(r'\r\n?'), '\n').split('\n');
  final blocks = <MdBlock>[];
  var paragraph = <String>[];

  void flushParagraph() {
    if (paragraph.isEmpty) return;
    blocks.add(MdParagraph(paragraph.join(' ').trim()));
    paragraph = [];
  }

  for (var index = 0; index < lines.length; index++) {
    final line = lines[index];
    final trimmed = line.trim();

    if (trimmed.isEmpty) {
      flushParagraph();
      continue;
    }

    // Code fence
    final fence = _fence.firstMatch(trimmed);
    if (fence != null) {
      flushParagraph();
      final body = <String>[];
      index += 1;
      // An unclosed fence runs to the end
      while (index < lines.length && !_fence.hasMatch(lines[index].trim())) {
        body.add(lines[index]);
        index += 1;
      }
      blocks.add(MdCode(
        language: fence.group(1)?.isNotEmpty == true ? fence.group(1) : null,
        text: body.join('\n'),
      ));
      continue;
    }

    // Horizontal rule
    if (_rule.hasMatch(trimmed)) {
      flushParagraph();
      blocks.add(const MdRule());
      continue;
    }

    // Standalone image
    final image = _imageOnly.firstMatch(trimmed);
    if (image != null) {
      flushParagraph();
      blocks.add(MdImage(
        alt: image.group(1)!,
        url: image.group(2)!,
      ));
      continue;
    }

    // Heading
    final heading = _heading.firstMatch(trimmed);
    if (heading != null) {
      flushParagraph();
      blocks.add(MdHeading(
        heading.group(1)!.length.clamp(1, 4),
        heading.group(2)!.trim(),
      ));
      continue;
    }

    // Blockquote (may span multiple lines)
    final quote = _quote.firstMatch(trimmed);
    if (quote != null) {
      flushParagraph();
      final body = [quote.group(1)!];
      while (index + 1 < lines.length) {
        final next = _quote.firstMatch(lines[index + 1].trim());
        if (next == null) break;
        body.add(next.group(1)!);
        index += 1;
      }
      blocks.add(MdQuote(body.join(' ').trim()));
      continue;
    }

    // List (ordered or unordered, may span multiple lines)
    final bullet = _unordered.firstMatch(trimmed);
    final numbered = _ordered.firstMatch(trimmed);
    if (bullet != null || numbered != null) {
      flushParagraph();
      final isOrdered = numbered != null;
      final items = [(bullet ?? numbered)!.group(1)!];

      while (index + 1 < lines.length) {
        final next = lines[index + 1].trim();
        final match = isOrdered
            ? _ordered.firstMatch(next)
            : _unordered.firstMatch(next);
        if (match == null) break;
        items.add(match.group(1)!);
        index += 1;
      }

      blocks.add(MdList(ordered: isOrdered, items: items));
      continue;
    }

    paragraph.add(trimmed);
  }

  flushParagraph();
  return blocks;
}

// ── Inline parser ────────────────────────────────────────────────────

final _inlinePattern = RegExp(
  r'(\[[^\]]+\]\([^)\s]+\))|(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*]+\*)|(_[^_]+_)',
);

/// Splits a line into runs of plain text and emphasis. Deliberately
/// non-nesting: bold inside a link inside italics is rare and the extra
/// machinery is where parsers start mangling ordinary prose.
List<MdInline> parseInline(String text) {
  final parts = <MdInline>[];
  var rest = text;

  while (rest.isNotEmpty) {
    final match = _inlinePattern.firstMatch(rest);
    if (match == null) break;

    if (match.start > 0) {
      parts.add(MdText(rest.substring(0, match.start)));
    }

    final token = match.group(0)!;

    if (token.startsWith('[')) {
      final linkMatch =
          RegExp(r'^\[([^\]]+)\]\(([^)\s]+)\)$').firstMatch(token)!;
      parts.add(MdLink(text: linkMatch.group(1)!, href: linkMatch.group(2)!));
    } else if (token.startsWith('`')) {
      parts.add(MdInlineCode(token.substring(1, token.length - 1)));
    } else if (token.startsWith('**') || token.startsWith('__')) {
      parts.add(MdBold(token.substring(2, token.length - 2)));
    } else {
      parts.add(MdItalic(token.substring(1, token.length - 1)));
    }

    rest = rest.substring(match.start + token.length);
  }

  if (rest.isNotEmpty) parts.add(MdText(rest));
  return parts;
}

// ── Helpers ──────────────────────────────────────────────────────────

/// Whether a link is safe to render as one. `javascript:` and `data:` URLs
/// in an author-supplied href are the one way markdown becomes script
/// execution, so anything that is not plainly a web or nostr link is
/// rendered as text instead.
bool isSafeHref(String href) {
  return RegExp(r'^(https?:\/\/|mailto:|nostr:|\/|#)', caseSensitive: false)
      .hasMatch(href.trim());
}

/// Plain text of an article, for summaries and search.
String markdownToText(String source) {
  return parseMarkdown(source)
      .map((block) {
        if (block is MdList) return block.items.join(' ');
        if (block is MdImage || block is MdRule) return '';
        if (block is MdHeading) return block.text;
        if (block is MdParagraph) return block.text;
        if (block is MdQuote) return block.text;
        if (block is MdCode) return block.text;
        return '';
      })
      .where((s) => s.isNotEmpty)
      .join(' ')
      .replaceAll(RegExp(r'[*_`#>]'), '')
      .replaceAll(RegExp(r'\s+'), ' ')
      .trim();
}
