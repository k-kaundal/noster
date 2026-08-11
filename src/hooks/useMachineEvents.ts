import { useStored } from '@/hooks/useStore';
import { defineKey } from '@/lib/store';

/**
 * Whether machine-published events belong in the shared timeline.
 *
 * Off by default. A gateway beaconing its presence every ten seconds puts
 * hundreds of JSON payloads into a global feed in an hour, and a feed that
 * mixes them with people's posts is unusable for either purpose. Nothing is
 * hidden permanently — the events stay on the author's profile, and this
 * toggle brings them back everywhere.
 *
 * Per device, like the adult-content switch: whether you want a wall of
 * telemetry is about what you are doing at this screen, not about which key
 * is signed in.
 */
const showMachineKey = defineKey<boolean>('nostr:show-machine-events', false);

export function useMachineEvents() {
  const [showMachine, setShowMachine] = useStored(showMachineKey);

  return { showMachine, setShowMachine };
}
