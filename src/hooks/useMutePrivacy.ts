import { useLocalStorage } from '@/hooks/useLocalStorage';

/**
 * Whether new mutes go in the private half of the list.
 *
 * Defaults to on. NIP-51 offers both halves without ranking them, but the two
 * are not equally safe for this particular list: a public mute list names
 * everybody a person has blocked, which is both an odd thing to broadcast and
 * a convenient list of targets for anyone who wants to find people that a
 * given account dislikes.
 *
 * Only the default changes. Entries already published in the open stay there
 * until their owner moves them — quietly re-encrypting somebody's existing
 * public mutes would rewrite a record other clients may already show.
 */
export function useMutePrivacy() {
  const [isPrivate, setPrivate] = useLocalStorage('mute:private-default', true);

  return { isPrivate, setPrivate };
}
