/**
 * Drawing an ecash token as a shareable card.
 *
 * Painted onto a canvas rather than screenshotted from the DOM, because no
 * screenshot library can be installed here and because a canvas gives the same
 * picture on every device — a DOM capture inherits the reader's theme, font
 * scaling and dark mode, so the card somebody sends would not match the one
 * they were looking at.
 *
 * What the card deliberately does not say is the amount, or the note written
 * on it. Those are between the sender and whoever redeems it; a picture that
 * prints the value is a picture that announces it to everyone the image passes
 * on the way. The card carries who it is from, where it can be redeemed, and
 * the code. Scanning is how you find out what is in it.
 *
 * That is presentation, not protection: the QR still is the money, and anyone
 * who sees the image can take it. The card says so.
 */

export interface TokenCardArt {
  /** Who cut the token. */
  fromName?: string;
  /** The mint that will honour it — the one thing a holder must know. */
  mintHost: string;
  platform: string;
  /** Whether it is still claimable, which changes the whole card. */
  claimed: boolean;
  /** A rendered QR of the token, drawn in at its native size. */
  qr?: HTMLCanvasElement | null;
}

/** Rendered at 2× so it stays sharp when a phone displays it. */
export const CARD_WIDTH = 1000;
export const CARD_HEIGHT = 560;
const SCALE = 2;

const FONT = "'Inter Variable', Inter, system-ui, -apple-system, sans-serif";

/** The brand gradient, matching `--brand-from` / `--brand-to` in the stylesheet. */
const BRAND_FROM = '#7c3aed';
const BRAND_TO = '#3b82f6';

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

/**
 * Truncates to fit, measuring rather than guessing a character count.
 *
 * A display name is whatever somebody typed, in whatever script, and cutting
 * at a fixed length overflows for wide characters and wastes space for narrow
 * ones.
 */
function fit(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string {
  if (context.measureText(text).width <= maxWidth) return text;

  let cut = text;
  while (cut.length > 1 && context.measureText(`${cut}…`).width > maxWidth) {
    cut = cut.slice(0, -1);
  }

  return `${cut}…`;
}

/**
 * The NostrFeed mark: a capital N built from relay nodes and the edges between
 * them.
 *
 * Redrawn from the same 24×24 geometry the component and the icon generator
 * use, rather than loading a PNG. An image would need fetching and decoding
 * before the card could be painted, and a logo that sometimes arrives late is
 * a card that sometimes exports without one.
 */
function drawMark(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  colour: string
): void {
  const unit = size / 24;
  const at = (value: number) => value * unit;

  context.save();
  context.translate(x, y);

  context.strokeStyle = colour;
  context.fillStyle = colour;
  context.lineWidth = at(3);
  context.lineCap = 'round';
  context.lineJoin = 'round';

  context.beginPath();
  context.moveTo(at(7.2), at(17.28));
  context.lineTo(at(7.2), at(6.72));
  context.lineTo(at(16.8), at(17.28));
  context.lineTo(at(16.8), at(6.72));
  context.stroke();

  for (const [cx, cy] of [
    [7.2, 6.72],
    [7.2, 17.28],
    [16.8, 6.72],
    [16.8, 17.28],
  ]) {
    context.beginPath();
    context.arc(at(cx), at(cy), at(2.1), 0, Math.PI * 2);
    context.fill();
  }

  context.restore();
}

/** Paints the card. The canvas is resized to fit. */
export function drawTokenCard(
  canvas: HTMLCanvasElement,
  art: TokenCardArt
): void {
  canvas.width = CARD_WIDTH * SCALE;
  canvas.height = CARD_HEIGHT * SCALE;

  const context = canvas.getContext('2d');
  if (!context) return;

  context.scale(SCALE, SCALE);
  context.textBaseline = 'alphabetic';

  /**
   * A claimed card goes grey. The picture outlives the token, and one that
   * still looks live invites somebody to try redeeming it again.
   */
  const brandFrom = art.claimed ? '#94a3b8' : BRAND_FROM;
  const brandTo = art.claimed ? '#cbd5e1' : BRAND_TO;

  // Deep brand panel, so the white QR reads as the object on top of it
  const backdrop = context.createLinearGradient(0, 0, CARD_WIDTH, CARD_HEIGHT);
  backdrop.addColorStop(0, art.claimed ? '#475569' : '#1e1b4b');
  backdrop.addColorStop(0.55, art.claimed ? '#334155' : '#312e81');
  backdrop.addColorStop(1, art.claimed ? '#1e293b' : '#0f172a');

  context.fillStyle = backdrop;
  context.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  /**
   * A soft wash in the brand colours over the corner. Flat dark panels read as
   * unfinished; this is what makes it look like a card somebody designed
   * rather than a screenshot of a div.
   */
  const wash = context.createRadialGradient(140, 90, 20, 140, 90, 620);
  wash.addColorStop(0, art.claimed ? 'rgba(148,163,184,0.30)' : 'rgba(124,58,237,0.45)');
  wash.addColorStop(1, 'rgba(0,0,0,0)');
  context.fillStyle = wash;
  context.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  const glow = context.createRadialGradient(880, 520, 20, 880, 520, 560);
  glow.addColorStop(0, art.claimed ? 'rgba(100,116,139,0.25)' : 'rgba(59,130,246,0.35)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  context.fillStyle = glow;
  context.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  const left = 64;

  // The mark, on its own rounded tile in the brand gradient
  const tile = 64;
  const tileGradient = context.createLinearGradient(left, 56, left + tile, 56 + tile);
  tileGradient.addColorStop(0, brandFrom);
  tileGradient.addColorStop(1, brandTo);

  context.fillStyle = tileGradient;
  roundedRect(context, left, 56, tile, tile, 18);
  context.fill();

  drawMark(context, left + 10, 56 + 10, tile - 20, '#ffffff');

  context.fillStyle = '#ffffff';
  context.font = `700 34px ${FONT}`;
  context.fillText(art.platform, left + tile + 20, 88);

  context.fillStyle = 'rgba(226,232,240,0.72)';
  context.font = `500 20px ${FONT}`;
  context.letterSpacing = '2px';
  context.fillText('ECASH GIFT', left + tile + 20, 116);
  context.letterSpacing = '0px';

  /**
   * The only two facts the card states. Not the amount and not the note —
   * those belong to whoever scans it, and printing them puts the value in
   * front of everyone the picture passes on the way.
   */
  let line = 268;

  if (art.fromName) {
    context.fillStyle = 'rgba(148,163,184,0.9)';
    context.font = `500 22px ${FONT}`;
    context.letterSpacing = '1.5px';
    context.fillText('FROM', left, line);
    context.letterSpacing = '0px';

    context.fillStyle = '#ffffff';
    context.font = `600 44px ${FONT}`;
    context.fillText(fit(context, art.fromName, 480), left, line + 52);
    line += 116;
  }

  context.fillStyle = 'rgba(148,163,184,0.9)';
  context.font = `500 22px ${FONT}`;
  context.letterSpacing = '1.5px';
  context.fillText('REDEEM AT', left, line);
  context.letterSpacing = '0px';

  context.fillStyle = '#ffffff';
  context.font = `600 32px ${FONT}`;
  context.fillText(fit(context, art.mintHost, 480), left, line + 42);

  // Status along the bottom, quiet unless it matters
  context.fillStyle = art.claimed ? 'rgba(203,213,225,0.85)' : 'rgba(134,239,172,0.95)';
  context.font = `600 22px ${FONT}`;
  context.letterSpacing = '1.5px';
  context.fillText(
    art.claimed ? 'ALREADY CLAIMED' : 'SCAN TO CLAIM',
    left,
    CARD_HEIGHT - 56
  );
  context.letterSpacing = '0px';

  if (!art.qr) return;

  /**
   * The QR sits on white whatever the card behind it does. A code drawn over
   * a gradient scans badly on many phone cameras, and one that fails to scan
   * makes the whole card useless.
   */
  const panel = 320;
  const panelX = CARD_WIDTH - panel - 64;
  const panelY = (CARD_HEIGHT - panel) / 2;

  context.save();
  context.shadowColor = 'rgba(0,0,0,0.35)';
  context.shadowBlur = 40;
  context.shadowOffsetY = 12;
  context.fillStyle = '#ffffff';
  roundedRect(context, panelX, panelY, panel, panel, 28);
  context.fill();
  context.restore();

  const inset = 26;
  context.drawImage(
    art.qr,
    panelX + inset,
    panelY + inset,
    panel - inset * 2,
    panel - inset * 2
  );

  // A claimed card's code is dead; dimming it says so without hiding it
  if (art.claimed) {
    context.fillStyle = 'rgba(30,41,59,0.72)';
    roundedRect(context, panelX, panelY, panel, panel, 28);
    context.fill();
  }
}

/** The card as a PNG, or null when the browser refuses. */
export function tokenCardBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}

/**
 * A filename that says nothing.
 *
 * Filenames survive into share sheets, chat previews and screenshots. The
 * amount used to be in it, which put the value back on the outside of a card
 * built not to state it.
 */
export function tokenCardFilename(): string {
  return 'ecash-gift.png';
}
