/**
 * Drawing a note as a picture, so it survives being shared.
 *
 * A link to a note previews as nothing useful. The URL is a client-side route,
 * every crawler is handed the same `index.html`, and X, Facebook, WhatsApp and
 * the rest read the HTML as served — so a shared note appears as the site's
 * front door, with the site's title and the site's image, whatever was
 * actually shared. Fixing that properly needs a server rendering tags per
 * request, which this app deliberately does not have.
 *
 * An image needs nobody's cooperation. It carries the author, the words and
 * the note's own picture into any feed that accepts a file, which is all of
 * them, and it reads the same on every platform because it is not being
 * re-rendered by any of them.
 *
 * Drawn on a canvas rather than through a DOM-to-image library. The layout is
 * a stack of blocks with one image in it — small enough that a dependency
 * would cost more than it saves, and hand-drawing means no surprises about
 * which CSS a screenshotting library does and does not implement.
 */

/** Wide enough to stay sharp when a feed scales it down. */
export const CARD_WIDTH = 1080;

const PADDING = 64;
const AVATAR = 96;

/** Beyond this the note is a wall of text in a feed, so it is cut. */
export const MAX_LINES = 14;

/** What a note earned, for the line above the footer. */
export interface ShareCardStats {
  replies?: number;
  reposts?: number;
  reactions?: number;
  zapSats?: number;
}

export interface ShareCardInput {
  displayName: string;
  /** Shown under the name, without the leading `@`. */
  handle: string;
  avatarUrl?: string;
  content: string;
  /** The note's own picture, when it has one. */
  imageUrl?: string;
  /** Unix seconds. */
  createdAt: number;
  /** Printed along the bottom, so somebody can find the original. */
  url: string;
  stats?: ShareCardStats;
}

/** `2.1k` rather than `2100`, which is a lot of digits on one line. */
export function compactCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

/**
 * The engagement line, or nothing when a note has none.
 *
 * Zero is left out rather than printed. "0 likes" on a shared note is a fact
 * nobody wanted to publish, and a card with one number on it reads better than
 * one advertising three absences.
 */
export function describeStats(stats: ShareCardStats | undefined): string {
  if (!stats) return '';

  const parts: string[] = [];

  const add = (count: number | undefined, one: string, many: string) => {
    if (!count || count <= 0) return;
    parts.push(`${compactCount(count)} ${count === 1 ? one : many}`);
  };

  add(stats.reactions, 'like', 'likes');
  add(stats.replies, 'reply', 'replies');
  add(stats.reposts, 'repost', 'reposts');

  if (stats.zapSats && stats.zapSats > 0) {
    parts.push(`${compactCount(stats.zapSats)} sats`);
  }

  return parts.join('  ·  ');
}

/**
 * Shortens text from the end until it fits a width.
 *
 * The footer used to print a full note URL — a `note1` is 63 characters — at
 * whatever width it wanted, straight through the brand drawn right-aligned on
 * the same line. The two overlapped into an unreadable smear on every card.
 */
export function fitText(
  text: string,
  maxWidth: number,
  measure: (text: string) => number
): string {
  if (measure(text) <= maxWidth) return text;

  let cut = text;

  while (cut.length > 1 && measure(`${cut}…`) > maxWidth) {
    cut = cut.slice(0, -1);
  }

  return `${cut}…`;
}

export interface CardTheme {
  background: string;
  foreground: string;
  muted: string;
  accent: string;
  border: string;
}

const FALLBACK_THEME: CardTheme = {
  background: '#0b0b12',
  foreground: '#fafafa',
  muted: '#a1a1aa',
  accent: '#8b5cf6',
  border: '#26262e',
};

/**
 * Splits text into lines that fit a width, honouring the breaks it already has.
 *
 * `measure` is injected rather than taken from a canvas so the wrapping can be
 * tested without one — this is the part with an off-by-one worth catching, and
 * a headless canvas measures nothing.
 *
 * A single word longer than the line is broken mid-word rather than allowed to
 * overflow, because a pasted npub or URL is exactly that and it is common.
 */
export function wrapText(
  text: string,
  maxWidth: number,
  measure: (text: string) => number
): string[] {
  const lines: string[] = [];

  for (const paragraph of text.split('\n')) {
    if (!paragraph.trim()) {
      lines.push('');
      continue;
    }

    let line = '';

    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;

      if (measure(candidate) <= maxWidth) {
        line = candidate;
        continue;
      }

      if (line) {
        lines.push(line);
        line = '';
      }

      // A word that cannot fit on a line of its own is cut into pieces that do
      if (measure(word) > maxWidth) {
        let piece = '';

        for (const character of word) {
          if (measure(piece + character) > maxWidth && piece) {
            lines.push(piece);
            piece = character;
          } else {
            piece += character;
          }
        }

        line = piece;
      } else {
        line = word;
      }
    }

    if (line) lines.push(line);
  }

  /*
   * Trailing blank lines are dropped. They come from notes that end with a
   * newline, which is most of them, and each one is an unexplained gap above
   * the footer.
   */
  while (lines.length && !lines[lines.length - 1]) lines.pop();

  return lines;
}

/** Cuts a wrapped block to `max` lines, marking that something was left out. */
export function truncateLines(lines: string[], max = MAX_LINES): string[] {
  if (lines.length <= max) return lines;

  const kept = lines.slice(0, max);
  const last = kept[max - 1];

  kept[max - 1] = `${last.replace(/[\s.,;:]+$/, '')}…`;

  return kept;
}

/** Reads one of the app's HSL custom properties as a canvas-usable colour. */
function readColor(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;

  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();

  // Stored as bare HSL components — "263.4 70% 60%" — not as a colour
  return value ? `hsl(${value})` : fallback;
}

/**
 * The card's palette, taken from the running app.
 *
 * So a shared note looks like the app it came from, accent and all, rather
 * than like a generic template — and so it keeps matching when somebody
 * changes their accent colour.
 */
export function cardTheme(): CardTheme {
  return {
    background: readColor('--card', FALLBACK_THEME.background),
    foreground: readColor('--foreground', FALLBACK_THEME.foreground),
    muted: readColor('--muted-foreground', FALLBACK_THEME.muted),
    accent: readColor('--primary', FALLBACK_THEME.accent),
    border: readColor('--border', FALLBACK_THEME.border),
  };
}

/**
 * Loads an image for drawing, or gives up quietly.
 *
 * `crossOrigin` is what makes the canvas exportable. Without it a drawn
 * cross-origin image taints the canvas and `toBlob` throws — so a note with a
 * picture from a host that sends no CORS headers would produce no card at all.
 * Returning null instead means the card is drawn without that picture, which
 * is the right trade: the words are the note.
 */
function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();

    /*
     * `crossOrigin` is required — a drawn cross-origin image without it taints
     * the canvas and `toBlob` throws — and it is also why some avatars cannot
     * be drawn at all: a host that sends no `Access-Control-Allow-Origin` will
     * fail this load, and the card falls back to initials. `no-referrer` wins
     * back the hosts that block on the referring page rather than on CORS.
     */
    image.crossOrigin = 'anonymous';
    image.referrerPolicy = 'no-referrer';

    // Some hosts hang rather than fail, and a share sheet that never opens is
    // worse than one that opens without a picture
    const timeout = window.setTimeout(() => resolve(null), 6000);

    image.onload = () => {
      window.clearTimeout(timeout);
      resolve(image);
    };
    image.onerror = () => {
      window.clearTimeout(timeout);
      resolve(null);
    };

    image.src = url;
  });
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

/**
 * Draws an image to fill a box, cropping the overflow rather than squashing it.
 *
 * `object-fit: cover`, by hand. A portrait photo stretched to a landscape box
 * is instantly recognisable as a bug, and every note picture is some aspect
 * ratio nobody chose for this card.
 */
function drawCover(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  const scale = Math.max(width / image.width, height / image.height);
  const drawnWidth = image.width * scale;
  const drawnHeight = image.height * scale;

  ctx.drawImage(
    image,
    x + (width - drawnWidth) / 2,
    y + (height - drawnHeight) / 2,
    drawnWidth,
    drawnHeight
  );
}

const FONT = '"Inter Variable", Inter, system-ui, sans-serif';

/**
 * Renders the card and hands back a PNG.
 *
 * Height follows the content: a one-line note gets a small card and a long one
 * gets a tall card, rather than either being padded out or cropped to a fixed
 * shape. Feeds scale an image to fit whatever they allow, so the only thing a
 * fixed height would buy is a guarantee of wasted space or lost words.
 */
export async function renderShareCard(input: ShareCardInput): Promise<Blob> {
  const theme = cardTheme();

  /*
   * Waited for, or the first card of a session is drawn in Times New Roman.
   * Canvas does not trigger a font load and does not wait for one in flight —
   * it silently substitutes, and the result is a card that looks nothing like
   * the app.
   */
  if (document.fonts?.ready) await document.fonts.ready;

  const [avatar, picture] = await Promise.all([
    input.avatarUrl ? loadImage(input.avatarUrl) : Promise.resolve(null),
    input.imageUrl ? loadImage(input.imageUrl) : Promise.resolve(null),
  ]);

  // Measured on a scratch context, since the real one needs the height first
  const scratch = document.createElement('canvas').getContext('2d')!;
  scratch.font = `400 34px ${FONT}`;

  const textWidth = CARD_WIDTH - PADDING * 2;
  const lines = truncateLines(
    wrapText(input.content.trim(), textWidth, (text) =>
      scratch.measureText(text).width
    )
  );

  const statsLine = describeStats(input.stats);

  const lineHeight = 48;
  const headerHeight = AVATAR;
  const textHeight = lines.length ? lines.length * lineHeight : 0;
  const pictureHeight = picture
    ? Math.min(
        Math.round((textWidth * picture.height) / picture.width),
        // Capped, or a tall screenshot makes a card nothing else fits on
        720
      )
    : 0;
  const footerHeight = 56;

  const height =
    PADDING +
    headerHeight +
    (textHeight ? 40 + textHeight : 0) +
    (pictureHeight ? 36 + pictureHeight : 0) +
    (statsLine ? 36 + 32 : 0) +
    44 +
    footerHeight +
    PADDING;

  // Drawn at 2x so it stays sharp on the screens it will be viewed on
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = CARD_WIDTH * scale;
  canvas.height = height * scale;

  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.textBaseline = 'top';

  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, CARD_WIDTH, height);

  // A stripe of the app's accent, which is what makes the card recognisable
  ctx.fillStyle = theme.accent;
  ctx.fillRect(0, 0, CARD_WIDTH, 8);

  let y = PADDING;

  // Avatar, circular, with initials when the picture will not load
  ctx.save();
  ctx.beginPath();
  ctx.arc(PADDING + AVATAR / 2, y + AVATAR / 2, AVATAR / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  if (avatar) {
    drawCover(ctx, avatar, PADDING, y, AVATAR, AVATAR);
  } else {
    ctx.fillStyle = theme.accent;
    ctx.fillRect(PADDING, y, AVATAR, AVATAR);
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 36px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(
      input.displayName.slice(0, 2).toUpperCase(),
      PADDING + AVATAR / 2,
      y + AVATAR / 2 - 18
    );
    ctx.textAlign = 'left';
  }

  ctx.restore();

  const nameX = PADDING + AVATAR + 24;

  ctx.fillStyle = theme.foreground;
  ctx.font = `700 38px ${FONT}`;
  ctx.fillText(input.displayName, nameX, y + 8, CARD_WIDTH - nameX - PADDING);

  ctx.fillStyle = theme.muted;
  ctx.font = `400 30px ${FONT}`;
  ctx.fillText(
    `@${input.handle} · ${new Date(input.createdAt * 1000).toLocaleDateString(
      undefined,
      { day: 'numeric', month: 'short', year: 'numeric' }
    )}`,
    nameX,
    y + 56,
    CARD_WIDTH - nameX - PADDING
  );

  y += headerHeight;

  if (textHeight) {
    y += 40;
    ctx.fillStyle = theme.foreground;
    ctx.font = `400 34px ${FONT}`;

    for (const line of lines) {
      ctx.fillText(line, PADDING, y);
      y += lineHeight;
    }
  }

  if (picture && pictureHeight) {
    y += 36;

    ctx.save();
    roundedRect(ctx, PADDING, y, textWidth, pictureHeight, 24);
    ctx.clip();
    drawCover(ctx, picture, PADDING, y, textWidth, pictureHeight);
    ctx.restore();

    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 2;
    roundedRect(ctx, PADDING, y, textWidth, pictureHeight, 24);
    ctx.stroke();

    y += pictureHeight;
  }

  /*
   * What the note earned, when it earned anything. Above the rule rather than
   * beside the brand: these are facts about the note, and the footer line is
   * about where it lives.
   */
  if (statsLine) {
    y += 36;

    ctx.fillStyle = theme.foreground;
    ctx.font = `600 28px ${FONT}`;
    ctx.fillText(statsLine, PADDING, y, textWidth);

    y += 32;
  }

  y += 44;

  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(PADDING, y);
  ctx.lineTo(CARD_WIDTH - PADDING, y);
  ctx.stroke();

  y += 24;

  /*
   * The brand is measured first and the URL is cut to what is left. Drawing
   * both from their own edges printed a 63-character `note1` straight through
   * the right-aligned name, which turned every card's footer into a smear.
   */
  ctx.font = `700 26px ${FONT}`;
  const brand = 'NostrFeed';
  const brandWidth = ctx.measureText(brand).width;

  ctx.fillStyle = theme.accent;
  ctx.textAlign = 'right';
  ctx.fillText(brand, CARD_WIDTH - PADDING, y);
  ctx.textAlign = 'left';

  ctx.fillStyle = theme.muted;
  ctx.font = `500 26px ${FONT}`;
  ctx.fillText(
    fitText(
      input.url.replace(/^https?:\/\/(www\.)?/, ''),
      textWidth - brandWidth - 32,
      (text) => ctx.measureText(text).width
    ),
    PADDING,
    y
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error('Could not render the card as an image')),
      'image/png'
    );
  });
}
