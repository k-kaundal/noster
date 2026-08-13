/**
 * The `@handle` under somebody's name.
 *
 * A display name and a handle are different things and the app was showing the
 * same string for both. When a profile has no `name`, `genUserName` invents a
 * friendly two-word label — "Keen Eagle" — which is a fine thing to call
 * somebody and not a handle at all, so a post header read:
 *
 *     Keen Eagle
 *     @Keen Eagle
 *
 * Twice the same words, the second with a space in it, which no handle
 * anywhere has. It also says nothing: two different people with no profile
 * both show a name somebody invented for them, and the one thing that would
 * tell them apart — their key — is the thing not shown.
 *
 * So the handle falls back to the key rather than to the label. It is longer
 * and less friendly and it is *true*, which is the job of the line under a
 * name.
 */
import { nip19 } from 'nostr-tools';

/**
 * What can be a handle: no spaces, and nothing that would break a mention.
 *
 * Deliberately loose about the character set. NIP-05 local parts are
 * restricted, but `name` in a kind 0 is freeform and people put all sorts in
 * it; rejecting a name for an unusual character would replace a handle
 * somebody chose with a key they did not.
 */
export function isHandleShaped(value: string | undefined): value is string {
  if (!value) return false;

  const trimmed = value.trim();
  return trimmed.length > 0 && !/\s/.test(trimmed);
}

/** `npub1abcd…wxyz` — recognisable, pasteable, and short enough to sit inline. */
export function shortNpub(pubkey: string, edge = 8): string {
  let npub: string;

  try {
    npub = nip19.npubEncode(pubkey);
  } catch {
    // A malformed key is still better shown than replaced with a fiction
    npub = pubkey;
  }

  if (npub.length <= edge * 2 + 1) return npub;

  return `${npub.slice(0, edge)}…${npub.slice(-4)}`;
}

/**
 * The handle to show for somebody, without the leading `@`.
 *
 * In order: the name they chose, if it is shaped like a handle; the local part
 * of a verified NIP-05, which is a name somebody proved; then their key.
 */
export function handleFor(
  metadata: { name?: string; nip05?: string } | undefined,
  pubkey: string
): string {
  if (isHandleShaped(metadata?.name)) return metadata.name.trim();

  const nip05 = metadata?.nip05?.trim();
  if (nip05) {
    const local = nip05.split('@')[0];
    /*
     * `_@domain.com` is NIP-05 for "the domain itself", so the handle worth
     * showing is the domain rather than an underscore.
     */
    if (local === '_') {
      const domain = nip05.split('@')[1];
      if (isHandleShaped(domain)) return domain;
    } else if (isHandleShaped(local)) {
      return local;
    }
  }

  return shortNpub(pubkey);
}
