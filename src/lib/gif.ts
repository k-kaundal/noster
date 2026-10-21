/**
 * GIF search and selection, via Klipy.
 *
 * Klipy is the designated Tenor successor — Discord, BeReal, and Damus all
 * migrated there when Google announced the Tenor API sunset. The API is free
 * for client-side use, which is why the key lives here rather than behind a
 * proxy: Klipy's model expects it, the same way GIPHY's does.
 *
 * The provider abstraction exists so a second source (GIPHY, a Nostr-native
 * set) can slot in without the picker component learning a new shape.
 */

export interface GifResult {
  /** Stable identifier from the provider. */
  id: string;
  /** Human-readable title, shown on hover and used as alt text. */
  title: string;
  /** The URL to insert into the note — medium quality. */
  url: string;
  /** A smaller URL for the picker grid, so 30 results don't download 30 full GIFs. */
  previewUrl: string;
  /** Pixel dimensions, for the `dim` imeta tag. */
  width: number;
  height: number;
}

interface KlipyMediaFormat {
  url: string;
  dims?: [number, number];
  size?: number;
}

interface KlipyResult {
  id: string;
  title?: string;
  media_formats?: {
    gif?: KlipyMediaFormat;
    tinygif?: KlipyMediaFormat;
  };
  file?: {
    md?: { gif?: { url: string; width?: number; height?: number } };
    sm?: { gif?: { url: string; width?: number; height?: number } };
  };
}

interface KlipyFeaturedResponse {
  results?: KlipyResult[];
  next?: string;
}

interface KlipySearchResponse {
  data?: {
    data?: KlipyResult[];
    has_next?: boolean;
  };
}

const KLIPY_BASE = 'https://api.klipy.com/v2';

/**
 * The Klipy API key.
 *
 * Client-side by design — Klipy's model is per-IP rate limiting, not
 * per-key secrecy, which is the same model GIPHY uses. The test key covers
 * development; a production key is requested from their partner panel.
 */
const KLIPY_KEY = import.meta.env.VITE_KLIPY_API_KEY ?? 'C0IgkB77GJXE6vUXnPhAuOoAZKVhLOMx';

function readGif(result: KlipyResult): GifResult | null {
  // Two response shapes: featured (Tenor-compatible) and search (Klipy native)
  const formats = result.media_formats;
  if (formats?.gif?.url) {
    const [width, height] = formats.gif.dims ?? [0, 0];
    return {
      id: result.id,
      title: result.title ?? 'GIF',
      url: formats.gif.url,
      previewUrl: formats.tinygif?.url ?? formats.gif.url,
      width,
      height,
    };
  }

  const file = result.file;
  if (file?.md?.gif?.url) {
    return {
      id: result.id,
      title: result.title ?? 'GIF',
      url: file.md.gif.url,
      previewUrl: file.sm?.gif?.url ?? file.md.gif.url,
      width: file.md.gif.width ?? 0,
      height: file.md.gif.height ?? 0,
    };
  }

  return null;
}

/** Trending GIFs, which is what the picker opens to before anybody types. */
export async function fetchTrendingGifs(
  limit = 30,
  signal?: AbortSignal
): Promise<GifResult[]> {
  const url = `${KLIPY_BASE}/gifs/featured?limit=${limit}&key=${KLIPY_KEY}`;

  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error('Could not load trending GIFs');

  const data: KlipyFeaturedResponse = await response.json();

  return (data.results ?? [])
    .map(readGif)
    .filter((gif): gif is GifResult => gif !== null);
}

/** Search GIFs by term. */
export async function searchGifs(
  query: string,
  limit = 30,
  signal?: AbortSignal
): Promise<GifResult[]> {
  const url = `${KLIPY_BASE}/gifs/search?q=${encodeURIComponent(query)}&per_page=${limit}&key=${KLIPY_KEY}`;

  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error('Could not search GIFs');

  const data: KlipySearchResponse = await response.json();

  return (data.data?.data ?? [])
    .map(readGif)
    .filter((gif): gif is GifResult => gif !== null);
}

/** The `imeta` tag for a selected GIF, per NIP-92. */
export function gifImetaTag(gif: GifResult): string[] {
  const tag = ['imeta', `url ${gif.url}`, 'm image/gif'];

  if (gif.width && gif.height) {
    tag.push(`dim ${gif.width}x${gif.height}`);
  }

  if (gif.title && gif.title !== 'GIF') {
    tag.push(`alt ${gif.title}`);
  }

  return tag;
}
