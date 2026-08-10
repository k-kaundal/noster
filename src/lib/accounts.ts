/**
 * Telling your own accounts apart.
 *
 * Nostr identities are public keys, and the switcher showed each one by the
 * name on its profile. That works exactly until two of them are the same
 * person — a main account and an alt, a personal one and a project one, a
 * throwaway made to test something — at which point the menu offers two rows
 * reading "kkworld" and switching accounts becomes a coin flip.
 *
 * A nickname is private: it lives on this device, is never published, and
 * exists purely so the row means something to the one person reading it.
 */

/** Nicknames by hex pubkey. Local to this browser and never published. */
export type AccountLabels = Record<string, string>;

/** Longest nickname worth keeping; the switcher truncates well before this. */
export const MAX_NICKNAME_LENGTH = 24;

/**
 * What to call an account in the switcher.
 *
 * The private nickname wins over the published profile name, because someone
 * who has bothered to name an account has said what they want to see. The
 * fallback is the key-derived name, which is stable — unlike a blank row while
 * the profile loads.
 */
export function accountName(input: {
  nickname?: string;
  profileName?: string;
  fallback: string;
}): string {
  return input.nickname?.trim() || input.profileName?.trim() || input.fallback;
}

/**
 * Whether the profile name is worth showing underneath the nickname.
 *
 * Only when it says something the nickname does not. Repeating "kkworld"
 * on two lines is noise.
 */
export function accountSubtitle(input: {
  nickname?: string;
  profileName?: string;
}): string | null {
  const nickname = input.nickname?.trim();
  const profileName = input.profileName?.trim();

  if (!nickname || !profileName) return null;
  return nickname === profileName ? null : profileName;
}

/**
 * Sets or clears a nickname.
 *
 * Clearing removes the entry rather than storing an empty string, so the
 * stored object does not grow a tombstone for every name ever tried, and
 * `accountName` does not have to treat `''` as a special case.
 */
export function withNickname(
  labels: AccountLabels,
  pubkey: string,
  nickname: string
): AccountLabels {
  const next = { ...labels };
  const trimmed = nickname.trim().slice(0, MAX_NICKNAME_LENGTH);

  if (trimmed) {
    next[pubkey] = trimmed;
  } else {
    delete next[pubkey];
  }

  return next;
}
