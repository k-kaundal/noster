import { useCallback } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';
import { useAdultContent } from '@/hooks/useAdultContent';
import { useMachineEvents } from '@/hooks/useMachineEvents';
import { useMuteList } from '@/hooks/useMuteList';
import { filterMuted } from '@/lib/mute';
import { filterAdultContent } from '@/lib/nsfw';
import { filterMachineEvents } from '@/lib/machineEvents';

/**
 * The three filters that are not a preference, applied everywhere notes are.
 *
 * They lived inline in `Feed`, which meant they applied to one screen. Explore,
 * Trending, a hashtag, a search and a profile all rendered whatever the relays
 * sent — so somebody who muted an account still met them under a hashtag, and
 * somebody with adult content switched off still met it on Explore. A filter
 * with holes in it is worse than none: it is a promise that is kept often
 * enough to be trusted and broken often enough to matter.
 *
 * Reactive by construction. Every input is a store subscription, so turning
 * adult content off re-renders each caller and the memo it feeds recomputes
 * against notes already in hand — no refetch, and nothing left on screen from
 * before the switch was flipped.
 *
 * Advanced filters are deliberately not here. Those are opt-in as a set and
 * belong to the timeline that offers them; these three are what a reader has
 * already asked for and should not have to ask for again per screen.
 */
export function useContentFilter() {
  const { list: muteList } = useMuteList();
  const { showAdult } = useAdultContent();
  const { showMachine } = useMachineEvents();

  /**
   * Stable while the settings are, so a caller can pass it straight into a
   * `useMemo` dependency array without recomputing on every render.
   */
  const filter = useCallback(
    <T extends NostrEvent>(events: T[] | undefined): T[] | undefined => {
      if (!events) return events;

      return filterMachineEvents(
        filterAdultContent(filterMuted(events, muteList), showAdult),
        showMachine
      );
    },
    [muteList, showAdult, showMachine]
  );

  return {
    filter,
    /** Exposed for callers that need to explain an empty screen. */
    muteList,
    showAdult,
  };
}
