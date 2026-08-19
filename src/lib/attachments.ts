/**
 * What a composer attaches to a note, and the tags that describe it.
 *
 * Lived inside the main composer as private helpers, which is why the
 * community box had none of it: pictures, hashtags and the tags that make
 * either discoverable were features of one screen rather than of posting.
 * Pulled out so a second composer is a second caller instead of a second
 * implementation that drifts.
 */

/** How many pictures one note carries. Past this it is an album, not a post. */
export const MAX_IMAGES = 4;

/** Refused before upload rather than after. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * The mime type for an uploaded image, from its extension.
 *
 * A guess, and a safe one: `imeta` is a hint for clients deciding how to lay a
 * picture out, so being wrong costs a layout choice rather than a broken note.
 * Anything unrecognised is called jpeg because that is what most of the web is.
 */
export function imageMimeType(url: string): string {
  const extension = url.split('.').pop()?.toLowerCase() ?? '';
  if (extension === 'png') return 'image/png';
  if (extension === 'gif') return 'image/gif';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'avif') return 'image/avif';
  if (extension === 'svg') return 'image/svg+xml';
  return 'image/jpeg';
}

/** NIP-92 `imeta` tags, one per attached picture. */
export function imetaTags(urls: string[]): string[][] {
  return urls.map((url) => ['imeta', `url ${url}`, `m ${imageMimeType(url)}`]);
}

/**
 * Hashtags written inline, as relays index them.
 *
 * Lowercased because `t` filters are exact: `#Bitcoin` and `#bitcoin` are one
 * subject to a reader and two to a relay, and a post filed under the wrong
 * case is a post nobody following the tag will see.
 *
 * The `#` has to open a word. Without that rule the fragment on a link —
 * `example.com/docs#install` — files the post under "install", and a URL is
 * the one place a `#` routinely appears meaning something else.
 */
export function extractHashtags(content: string): string[] {
  const found = content.match(/(?:^|\s)#([\p{L}\p{N}_]+)/gu) ?? [];
  return [
    ...new Set(found.map((match) => match.trim().slice(1).toLowerCase())),
  ];
}

export function hashtagTags(content: string): string[][] {
  return extractHashtags(content).map((tag) => ['t', tag]);
}

/**
 * Why this file cannot be attached, or null when it can.
 *
 * Returns the sentence rather than a code: every caller shows it to somebody,
 * and a shared list of reasons is only shared if the wording comes with it.
 */
export function imageProblem(
  file: File,
  attached: number,
  max = MAX_IMAGES
): string | null {
  if (attached >= max) {
    return `You can attach up to ${max} ${max === 1 ? 'image' : 'images'}.`;
  }
  if (!file.type.startsWith('image/')) {
    return 'That file is not an image.';
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return `Images have to be under ${Math.round(
      MAX_IMAGE_BYTES / (1024 * 1024)
    )}MB.`;
  }
  return null;
}

/**
 * The pictures appended to what was written.
 *
 * A URL in the content is how every Nostr client finds an image — `imeta`
 * describes one, it does not place one — so a note whose pictures live only in
 * tags shows as text everywhere it is read.
 */
export function withAttachments(content: string, urls: string[]): string {
  const body = content.trim();
  if (!urls.length) return body;
  return [body, ...urls].filter(Boolean).join('\n');
}
