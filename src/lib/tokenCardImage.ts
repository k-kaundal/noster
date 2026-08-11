/**
 * Drawing an ecash token as a shareable card.
 *
 * Painted onto a canvas rather than screenshotted from the DOM, because no
 * screenshot library can be installed here and because a canvas gives the same
 * picture on every device — a DOM capture inherits the reader's theme, font
 * scaling and dark mode, so the card somebody sends looks different from the
 * one they were looking at.
 *
 * The QR is the part that has to survive. Everything else on the card is
 * decoration around a string that has to scan, so it is drawn from a real
 * `QRCodeCanvas` at full resolution and never scaled up.
 */

export interface TokenCardArt {
  amountSats: number;
  memo?: string;
  /** Who cut the token. */
  fromName?: string;
  /** Mint host, as the money's actual custodian. */
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
 * A memo is free text in whatever script somebody types, and cutting at a
 * fixed length overflows for wide characters and wastes space for narrow ones.
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
   * Claimed cards go grey. The picture is often kept long after the fact, and
   * one that still looks live invites somebody to try to redeem it again.
   */
  const ink = art.claimed ? '#64748b' : '#0f172a';
  const accent = art.claimed ? '#94a3b8' : '#2563eb';

  const background = context.createLinearGradient(0, 0, CARD_WIDTH, CARD_HEIGHT);

  if (art.claimed) {
    background.addColorStop(0, '#f1f5f9');
    background.addColorStop(1, '#e2e8f0');
  } else {
    background.addColorStop(0, '#eef4ff');
    background.addColorStop(0.55, '#f8fafc');
    background.addColorStop(1, '#eef9f4');
  }

  context.fillStyle = background;
  context.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  // A hairline inside the edge, so the card reads as an object on any backdrop
  context.strokeStyle = art.claimed ? '#cbd5e1' : '#bfdbfe';
  context.lineWidth = 2;
  roundedRect(context, 10, 10, CARD_WIDTH - 20, CARD_HEIGHT - 20, 28);
  context.stroke();

  const left = 64;

  // Platform, small and quiet at the top — it is the source, not the subject
  context.fillStyle = accent;
  context.font = `600 22px ${FONT}`;
  context.letterSpacing = '2px';
  context.fillText(art.platform.toUpperCase(), left, 88);
  context.letterSpacing = '0px';

  context.fillStyle = art.claimed ? '#94a3b8' : '#475569';
  context.font = `400 20px ${FONT}`;
  context.fillText('ECASH TOKEN', left, 118);

  // The amount is the whole point of the card
  context.fillStyle = ink;
  context.font = `700 132px ${FONT}`;
  const amount = art.amountSats.toLocaleString();
  context.fillText(amount, left, 262);

  const amountWidth = context.measureText(amount).width;
  context.font = `400 40px ${FONT}`;
  context.fillStyle = art.claimed ? '#94a3b8' : '#475569';
  context.fillText('sats', left + amountWidth + 16, 262);

  let line = 320;

  if (art.memo) {
    context.fillStyle = ink;
    context.font = `italic 400 30px ${FONT}`;
    context.fillText(fit(context, `“${art.memo}”`, 560), left, line);
    line += 48;
  }

  if (art.fromName) {
    context.fillStyle = art.claimed ? '#94a3b8' : '#475569';
    context.font = `500 26px ${FONT}`;
    context.fillText(fit(context, `from ${art.fromName}`, 560), left, line);
    line += 44;
  }

  /**
   * The mint, named plainly. Ecash is only honoured by the mint that issued
   * it, so a card that does not say which one leaves the holder unable to
   * redeem it without pasting the string somewhere to find out.
   */
  context.fillStyle = art.claimed ? '#94a3b8' : '#64748b';
  context.font = `400 24px ${FONT}`;
  context.fillText(fit(context, `Issued by ${art.mintHost}`, 560), left, line);

  // Status, bottom left
  context.fillStyle = art.claimed ? '#64748b' : '#15803d';
  context.font = `600 24px ${FONT}`;
  context.fillText(
    art.claimed ? 'ALREADY CLAIMED' : 'READY TO CLAIM',
    left,
    CARD_HEIGHT - 62
  );

  if (!art.qr) return;

  /**
   * The QR sits on white whatever the card behind it does. A code drawn over a
   * gradient scans badly on many phone cameras, and one that fails to scan
   * makes the whole card useless.
   */
  const panel = 300;
  const panelX = CARD_WIDTH - panel - 64;
  const panelY = (CARD_HEIGHT - panel) / 2;

  context.fillStyle = '#ffffff';
  roundedRect(context, panelX, panelY, panel, panel, 24);
  context.fill();

  context.strokeStyle = '#e2e8f0';
  context.lineWidth = 2;
  roundedRect(context, panelX, panelY, panel, panel, 24);
  context.stroke();

  const inset = 24;
  context.drawImage(
    art.qr,
    panelX + inset,
    panelY + inset,
    panel - inset * 2,
    panel - inset * 2
  );

  // A claimed card's code is dead; dimming it says so without hiding it
  if (art.claimed) {
    context.fillStyle = 'rgba(241, 245, 249, 0.72)';
    roundedRect(context, panelX, panelY, panel, panel, 24);
    context.fill();
  }
}

/** The card as a PNG, or null when the browser refuses. */
export function tokenCardBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}

/** A filename that says what it is without revealing the token. */
export function tokenCardFilename(amountSats: number): string {
  return `ecash-${amountSats}-sats.png`;
}
