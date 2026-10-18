import { useMemo } from 'react';
import { useLists } from '@/hooks/useLists';
import { starterPacksOnly } from '@/lib/starterPacks';

/**
 * Every starter pack on the current relays.
 *
 * A pack is a kind 39089 follow set, but the job it does is different from a
 * list you keep for yourself — it is the answer to "I just joined, who do I
 * follow". This hook only surfaces packs, not every follow set.
 */
export function useStarterPacks() {
  const { data: lists, isLoading, error } = useLists();

  const packs = useMemo(() => starterPacksOnly(lists ?? []), [lists]);

  return {
    packs,
    isLoading,
    error: error as Error | null,
  };
}
