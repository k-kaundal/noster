/**
 * A small Markdown reader for article bodies.
 *
 * Written rather than pulled in because the output here is React elements, not
 * an HTML string. Nothing this produces can carry markup from the author, so
 * there is no sanitiser to get wrong and no `dangerouslySetInnerHTML` anywhere
 * in the article path.
 *
 * It covers what people actually write in a post: headings, paragraphs, lists,
 * quotes, code, images, links, and inline emphasis. Anything it does not
 * recognise is shown as plain text rather than dropped.
 */

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3 | 4; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'quote'; text: string }
  | { type: 'code'; language?: string; text: string }
  | { type: 'image'; url: string; alt: string }
  | { type: 'rule' };

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'bold'; text: string }
  | { type: 'italic'; text: string }
  | { type: 'code'; text: string }
  | { type: 'link'; text: string; href: string };

// Six levels are valid Markdown; the deeper ones are clamped when rendered
// rather than falling through and showing their hashes as literal text
const HEADING = /^(#{1,6})\s+(.*)$/;
const UNORDERED = /^[-*+]\s+(.*)$/;
const ORDERED = /^\d+[.)]\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const RULE = /^(?:---+|\*\*\*+|___+)$/;
const IMAGE_ONLY = /^!\[([^\]]*)\]\(([^)\s]+)[^)]*\)$/;
const FENCE = /^```\s*(\S*)\s*$/;

/** Splits an article body into blocks. */
export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];

  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push({ type: 'paragraph', text: paragraph.join(' ').trim() });
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      continue;
    }

    const fence = FENCE.exec(trimmed);
    if (fence) {
      flushParagraph();

      const body: string[] = [];
      index += 1;
      // An unclosed fence runs to the end rather than swallowing the article
      while (index < lines.length && !FENCE.test(lines[index].trim())) {
        body.push(lines[index]);
        index += 1;
      }

      blocks.push({
        type: 'code',
        language: fence[1] || undefined,
        text: body.join('\n'),
      });
      continue;
    }

    if (RULE.test(trimmed)) {
      flushParagraph();
      blocks.push({ type: 'rule' });
      continue;
    }

    const image = IMAGE_ONLY.exec(trimmed);
    if (image) {
      flushParagraph();
      blocks.push({ type: 'image', alt: image[1], url: image[2] });
      continue;
    }

    const heading = HEADING.exec(trimmed);
    if (heading) {
      flushParagraph();
      blocks.push({
        type: 'heading',
        level: Math.min(heading[1].length, 4) as 1 | 2 | 3 | 4,
        text: heading[2].trim(),
      });
      continue;
    }

    const quote = QUOTE.exec(trimmed);
    if (quote) {
      flushParagraph();

      const body = [quote[1]];
      while (index + 1 < lines.length) {
        const next = QUOTE.exec(lines[index + 1].trim());
        if (!next) break;
        body.push(next[1]);
        index += 1;
      }

      blocks.push({ type: 'quote', text: body.join(' ').trim() });
      continue;
    }

    const bullet = UNORDERED.exec(trimmed);
    const numbered = ORDERED.exec(trimmed);
    if (bullet || numbered) {
      flushParagraph();

      const ordered = !!numbered;
      const items = [(bullet ?? numbered)![1]];

      while (index + 1 < lines.length) {
        const next = lines[index + 1].trim();
        const match = ordered ? ORDERED.exec(next) : UNORDERED.exec(next);
        if (!match) break;
        items.push(match[1]);
        index += 1;
      }

      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    paragraph.push(trimmed);
  }

  flushParagraph();
  return blocks;
}

const INLINE =
  /(\[[^\]]+\]\([^)\s]+\))|(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*]+\*)|(_[^_]+_)/;

/**
 * Splits a line into runs of plain text and emphasis.
 *
 * Deliberately non-nesting: bold inside a link inside italics is rare in a
 * post and the extra machinery to support it is where these parsers usually
 * start mangling ordinary prose containing an asterisk.
 */
export function parseInline(text: string): Inline[] {
  const parts: Inline[] = [];
  let rest = text;

  while (rest) {
    const match = INLINE.exec(rest);
    if (!match || match.index === undefined) break;

    if (match.index > 0) {
      parts.push({ type: 'text', text: rest.slice(0, match.index) });
    }

    const token = match[0];

    if (token.startsWith('[')) {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token)!;
      parts.push({ type: 'link', text: link[1], href: link[2] });
    } else if (token.startsWith('`')) {
      parts.push({ type: 'code', text: token.slice(1, -1) });
    } else if (token.startsWith('**') || token.startsWith('__')) {
      parts.push({ type: 'bold', text: token.slice(2, -2) });
    } else {
      parts.push({ type: 'italic', text: token.slice(1, -1) });
    }

    rest = rest.slice(match.index + token.length);
  }

  if (rest) parts.push({ type: 'text', text: rest });

  return parts;
}

/**
 * Whether a link is safe to render as one.
 *
 * `javascript:` and `data:` URLs in an author-supplied href are the one way
 * markdown becomes script execution, so anything that is not plainly a web or
 * nostr link is rendered as text instead.
 */
export function isSafeHref(href: string): boolean {
  return /^(https?:\/\/|mailto:|nostr:|\/|#)/i.test(href.trim());
}

/** Plain text of an article, for summaries and search. */
export function markdownToText(source: string): string {
  return parseMarkdown(source)
    .map((block) => {
      if (block.type === 'list') return block.items.join(' ');
      if (block.type === 'image' || block.type === 'rule') return '';
      return block.text;
    })
    .filter(Boolean)
    .join(' ')
    .replace(/[*_`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Whether some text was probably written as Markdown.
 *
 * Used to offer the article editor to somebody typing a post, not to change
 * how the post renders. NIP-23 is explicit that clients dealing in kind 1
 * notes "should not be expected to implement this NIP" — a note is plain text,
 * and quietly formatting one would make this app show something different from
 * every other client reading the same event.
 *
 * The bar is deliberately high, because the cost of the two mistakes is not
 * the same. Missing some Markdown costs nothing: the note posts as written.
 * Firing on ordinary prose puts a "write an article?" prompt in front of
 * somebody typing a sentence, every time.
 *
 * So the signals are split. A few are unambiguous enough to fire alone; the
 * rest have to agree with each other. `#bitcoin` is not a heading — a heading
 * needs the space — and one dash at the start of a line is a dash.
 */
export function looksLikeMarkdown(text: string): boolean {
  const source = text.replace(/\r\n?/g, '\n');
  if (source.trim().length < 40) return false;

  /** Anything inside a code fence would confuse the weaker tests below. */
  const fenced = /^```/m.test(source);
  if (fenced) return true;

  // A link with a URL in brackets is not something people type by accident
  if (/\[[^\]\n]+\]\([^)\s]+\)/.test(source)) return true;

  const weak = [
    // A heading needs the space, which is what tells it apart from a hashtag
    /^#{1,6}\s+\S/m,
    // Two or more list items, since a single leading dash is just a dash
    /^[-*+]\s+\S[\s\S]*^[-*+]\s+\S/m,
    /^\d+[.)]\s+\S[\s\S]*^\d+[.)]\s+\S/m,
    // Emphasis, requiring a closing pair on the same line
    /\*\*[^*\n]+\*\*/,
    /(?:^|\s)_[^_\n]+_(?:$|\s)/m,
    // Inline code
    /`[^`\n]+`/,
    // A quote line
    /^>\s+\S/m,
  ].filter((pattern) => pattern.test(source)).length;

  return weak >= 2;
}
