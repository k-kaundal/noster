import { useStored } from '@/hooks/useStore';
import { defineKey } from '@/lib/store';

/**
 * Whether to show posts that label themselves as adult content.
 *
 * Off by default, and not part of the advanced filters — those are opt-in as a
 * set, so putting this among them would mean a general feed showed pornography
 * to everyone who had never opened a settings panel. This is the one filter
 * that has to be on before anybody asks for it.
 *
 * Per device rather than per account: it is about who can see the screen, not
 * about which key is signed in.
 */
const showAdultKey = defineKey<boolean>('nostr:show-adult', false);

export function useAdultContent() {
  const [showAdult, setShowAdult] = useStored(showAdultKey);

  return { showAdult, setShowAdult };
}
