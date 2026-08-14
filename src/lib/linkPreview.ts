/**
 * Turning a bare URL into something worth looking at.
 *
 * A note whose point is the thing it links to currently renders as a wall of
 * `https://` — the reader gets a coloured string and has to parse a hostname
 * out of it to know whether it is worth a tap. Every feed people already use
 * shows a card instead: where it goes, and what it is.
 *
 * What this deliberately does not do is fetch the page. Reading a title and a
 * thumbnail out of somebody else's HTML is impossible from a browser without a
 * proxy, and a proxy means every link anyone in your feed posts — plus your IP
 * — goes to a third party. In an app whose entire pitch is not leaking that,
 * quietly, is not a trade worth making by default. So the card is built from
 * the URL alone, which is free and tells the reader the thing they actually
 * need: where this goes.
 */

const MEDIA_EXT =
  /\.(jpe?g|png|gif|webp|avif|bmp|svg|mp4|webm|mov|m4v|mp3|m4a|wav|ogg)(\?[^\s]*)?$/i;

/** Hosts whose content is embedded elsewhere, so a card would duplicate it. */
const EMBEDDED_HOSTS = [
  'youtube.com',
  'youtu.be',
  'vimeo.com',
];

export interface LinkTarget {
  /** The full URL, as published. */
  url: string;
  /** `example.com`, with `www.` dropped — what a reader actually reads. */
  domain: string;
  /** Path and query, trimmed for display. Empty for a bare domain. */
  path: string;
  /** The site's own favicon, fetched from the site itself. */
  faviconUrl: string;
}

/**
 * Whether a URL should become a card.
 *
 * Media is already rendered as media, and an embedded video already has a
 * player — a card under either is the same thing twice.
 */
export function isCardableLink(url: string): boolean {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (MEDIA_EXT.test(parsed.pathname)) return false;

  const host = parsed.hostname.replace(/^www\./, '');
  return !EMBEDDED_HOSTS.some(
    (embedded) => host === embedded || host.endsWith(`.${embedded}`)
  );
}

/**
 * Splits a URL into the parts a card shows.
 *
 * The favicon comes from the destination's own origin rather than from a
 * favicon service. It still tells that one site somebody looked at a link to
 * it — but that is the site the reader is about to open anyway, which is a far
 * smaller thing than handing every URL in a feed to a shared third party.
 */
export function readLink(url: string): LinkTarget | null {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const domain = parsed.hostname.replace(/^www\./, '');

  // The bare domain is already the headline, so `/` adds nothing
  const rest = `${parsed.pathname}${parsed.search}`;
  const path = rest === '/' ? '' : rest;

  return {
    url,
    domain,
    path: truncatePath(path),
    faviconUrl: `${parsed.origin}/favicon.ico`,
  };
}

/**
 * Shortens a path from the middle rather than the end.
 *
 * The end of a URL is usually the part that says what it is — a slug, an
 * article title — so cutting there leaves `example.com/2024/11/articles/…` and
 * throws away the only informative half.
 */
export function truncatePath(path: string, max = 48): string {
  if (path.length <= max) return path;

  const keepEnd = Math.floor((max - 1) / 2);
  const keepStart = max - 1 - keepEnd;

  return `${path.slice(0, keepStart)}…${path.slice(-keepEnd)}`;
}

/**
 * The one link a note is about, if it is about a link.
 *
 * Only the first is promoted to a card. A note with six links is a list, and
 * six cards is a page of chrome where the author wrote a paragraph — the rest
 * stay inline where they were written.
 */
export function primaryLink(urls: string[]): string | undefined {
  return urls.find(isCardableLink);
}
