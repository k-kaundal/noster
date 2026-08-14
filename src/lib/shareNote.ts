import type { NostrEvent } from '@nostrify/nostrify';

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|bmp)(\?[^\s]*)?$/i;
const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;

/** The first `url` field out of a NIP-92 `imeta` tag, when it names an image. */
function imetaImage(event: NostrEvent): string | undefined {
  for (const tag of event.tags) {
    if (tag[0] !== 'imeta') continue;

    for (const field of tag.slice(1)) {
      const [key, ...rest] = field.split(' ');
      if (key !== 'url') continue;

      const url = rest.join(' ').trim();
      if (url && IMAGE_EXT.test(url)) return url;
    }
  }

  return undefined;
}

export interface ShareableNote {
  /** The words, with any media URL lifted out. */
  text: string;
  /** The note's picture, when it has one. */
  imageUrl?: string;
}

/**
 * What of a note goes on a share card.
 *
 * The media URL is removed from the text for the same reason the feed removes
 * it: a note that ends in `https://cdn.example/a1b2c3.jpg` is showing its
 * plumbing, and on a card that picture is already the thing underneath. What
 * is left is what the author actually wrote.
 *
 * Other links stay. A note whose point is the article it links to reads as
 * nothing at all with the link stripped out.
 */
export function shareableNote(event: NostrEvent): ShareableNote {
  const fromTag = imetaImage(event);

  let imageUrl = fromTag;
  let text = event.content.trim();

  /*
   * Every image URL comes out of the text, not just the one being drawn. A
   * note with three pictures would otherwise keep two bare URLs in its body
   * while showing the first as a picture, which reads as a mistake.
   */
  text = text
    .replace(URL_PATTERN, (url) => {
      if (!IMAGE_EXT.test(url)) return url;
      if (!imageUrl) imageUrl = url;
      return '';
    })
    // Collapse the blank lines the removals leave behind
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { text, imageUrl };
}

/**
 * The text to put alongside a shared image.
 *
 * Deliberately short. It rides in a share sheet next to a picture that already
 * carries the note, so its whole job is to name the author and hand over the
 * link — anything more is repeated twice in the same post.
 */
export function shareCaption(displayName: string, url: string): string {
  return `${displayName} on Nostr\n${url}`;
}
