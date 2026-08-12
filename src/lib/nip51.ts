import type { NostrEvent, NostrSigner } from '@nostrify/nostrify';

/**
 * NIP-51 private list items.
 *
 * Every list in the NIP has two halves. Public entries are ordinary tags;
 * private ones are the same tag array, stringified, encrypted to the author's
 * own key, and parked in `.content`. The spec leads with this, and for good
 * reason — a mute list is the clearest case. Published in the open it tells
 * everybody precisely who somebody has blocked, which is both an awkward thing
 * to broadcast and a ready-made target list for the people on it.
 *
 * Encryption is to self: the author's public key with their own private key,
 * which the signer does internally. No key ever leaves the signer, so this
 * keeps working with a browser extension or a remote bunker that will never
 * hand one over.
 */

/**
 * Whether a ciphertext is the deprecated NIP-04 form.
 *
 * The spec says to discover the scheme "by searching for 'iv' in the
 * ciphertext". Taken literally that is wrong often enough to break things: a
 * NIP-44 payload is base64, and `i` followed by `v` turns up in one by pure
 * chance surprisingly often. Measured over random base64 of the lengths these
 * payloads actually take, a bare substring search misfires on 2.9% of
 * 120-character payloads and 13.6% of 600-character ones — so a long private
 * mute list would be misread as NIP-04, handed to the wrong decryptor, and
 * reported to its owner as unreadable.
 *
 * NIP-04 has an actual shape — `<base64>?iv=<base64>` — and `?` is not in the
 * base64 alphabet, so matching the shape cannot collide with a NIP-44 payload
 * at all. Same test in spirit; no coincidences.
 */
export function isLegacyCiphertext(content: string): boolean {
  return /\?iv=[A-Za-z0-9+/=]+$/.test(content.trim());
}

/**
 * Validates a decrypted payload as a tag array.
 *
 * The content is whatever decrypted, and a signer handed the wrong key
 * produces plausible-looking garbage rather than an error. Anything that is
 * not an array of arrays of strings is discarded — a list that renders
 * `[object Object]` as a muted pubkey is worse than one that renders nothing.
 */
function asTags(value: unknown): string[][] {
  if (!Array.isArray(value)) return [];

  const tags: string[][] = [];

  for (const entry of value) {
    if (!Array.isArray(entry)) continue;
    if (!entry.every((part) => typeof part === 'string')) continue;
    if (!entry.length) continue;

    tags.push(entry as string[]);
  }

  return tags;
}

/**
 * Reads the private half of a list.
 *
 * Returns empty rather than throwing on anything that goes wrong. A list whose
 * private section cannot be read still has a public section worth showing, and
 * every failure here is one a reader can do nothing about: no signer, a signer
 * without the right method, a payload from a key they no longer hold.
 */
export async function decryptListItems(
  event: NostrEvent,
  signer: NostrSigner | undefined,
  pubkey: string
): Promise<string[][]> {
  const content = event.content?.trim();

  // Empty content is the normal case for a list with nothing private in it
  if (!content || !signer) return [];

  /**
   * Only the author can read their own private items, and only their own.
   * Attempting to decrypt somebody else's would fail anyway, but asking a
   * hardware signer or a bunker to try produces a prompt the user has no way
   * to make sense of.
   */
  if (event.pubkey !== pubkey) return [];

  try {
    const legacy = isLegacyCiphertext(content);

    const plaintext = legacy
      ? await signer.nip04?.decrypt(pubkey, content)
      : await signer.nip44?.decrypt(pubkey, content);

    if (!plaintext) return [];

    return asTags(JSON.parse(plaintext));
  } catch {
    /**
     * A wrong guess about the scheme lands here too. Rather than trying the
     * other decryptor as a fallback, this gives up: the shapes do not overlap,
     * so a NIP-44 payload that failed is a payload that was genuinely
     * unreadable, and a second prompt to the signer would only annoy.
     */
    return [];
  }
}

/**
 * Encrypts private items for a list's content.
 *
 * NIP-44 only. NIP-04 is deprecated by this spec and everything else that
 * touches it, and writing it now would mean producing ciphertext that clients
 * are being told to stop supporting.
 */
export async function encryptListItems(
  tags: string[][],
  signer: NostrSigner | undefined,
  pubkey: string
): Promise<string> {
  if (!tags.length) return '';

  if (!signer?.nip44) {
    throw new Error(
      'Your signer cannot encrypt private list items. Upgrade it, or keep the list public.'
    );
  }

  return await signer.nip44.encrypt(pubkey, JSON.stringify(tags));
}

/** The public tags of a list, minus the metadata ones. */
const METADATA_TAGS = new Set(['d', 'title', 'image', 'description', 'name', 'alt']);

export function publicItems(event: NostrEvent): string[][] {
  return event.tags.filter(([name]) => !METADATA_TAGS.has(name));
}

/** A list read with both halves separated. */
export interface ListItems {
  /** Everyone can see these. */
  public: string[][];
  /** Only the author can. Empty when unreadable or absent. */
  private: string[][];
}

export async function readListItems(
  event: NostrEvent,
  signer: NostrSigner | undefined,
  pubkey: string
): Promise<ListItems> {
  return {
    public: publicItems(event),
    private: await decryptListItems(event, signer, pubkey),
  };
}

/** Whether a tag is in a list, by name and value. */
function has(tags: string[][], name: string, value: string): boolean {
  return tags.some(([tagName, tagValue]) => tagName === name && tagValue === value);
}

export function hasItem(items: ListItems, name: string, value: string): boolean {
  return has(items.public, name, value) || has(items.private, name, value);
}

/** Whether an item is in the private half specifically. */
export function isPrivate(items: ListItems, name: string, value: string): boolean {
  return has(items.private, name, value);
}

/**
 * Adds an item, at the end.
 *
 * "When new items are added to an existing list, clients SHOULD append them to
 * the end of the list, so they are stored in chronological order." Prepending
 * would be the easier thing to write and would silently destroy the ordering
 * every other client depends on to show a list oldest-first.
 *
 * Adding something already present in the other half moves it: an item cannot
 * be both public and private, and leaving a copy behind would mean unmuting
 * somebody publicly while still muting them in secret.
 */
export function addItem(
  items: ListItems,
  tag: string[],
  options: { private?: boolean } = {}
): ListItems {
  const [name, value] = tag;

  const withoutIt = (tags: string[][]) =>
    tags.filter(
      ([tagName, tagValue]) => !(tagName === name && tagValue === value)
    );

  if (options.private) {
    return {
      public: withoutIt(items.public),
      private: [...withoutIt(items.private), tag],
    };
  }

  return {
    public: [...withoutIt(items.public), tag],
    private: withoutIt(items.private),
  };
}

/** Removes an item from both halves. */
export function removeItem(
  items: ListItems,
  name: string,
  value: string
): ListItems {
  const withoutIt = (tags: string[][]) =>
    tags.filter(
      ([tagName, tagValue]) => !(tagName === name && tagValue === value)
    );

  return {
    public: withoutIt(items.public),
    private: withoutIt(items.private),
  };
}

/** Every value under one tag name, both halves, public first. */
export function values(items: ListItems, name: string): string[] {
  const collect = (tags: string[][]) =>
    tags
      .filter(([tagName, value]) => tagName === name && !!value)
      .map(([, value]) => value);

  return [...collect(items.public), ...collect(items.private)];
}

/**
 * The tags and content to publish for a list.
 *
 * Metadata tags are passed separately and always written first, because they
 * describe the list rather than belonging to it — and because a `d` tag buried
 * halfway down a hundred entries is one a careless reader will miss.
 */
export async function buildListEvent(
  items: ListItems,
  options: {
    metadata?: string[][];
    signer?: NostrSigner;
    pubkey: string;
  }
): Promise<{ tags: string[][]; content: string }> {
  return {
    tags: [...(options.metadata ?? []), ...items.public],
    content: await encryptListItems(items.private, options.signer, options.pubkey),
  };
}
