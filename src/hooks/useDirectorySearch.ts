import { useQuery } from '@tanstack/react-query';

import { hasDirectory, searchDirectory, type DirectoryHit } from '@/lib/getzap';

/**
 * Names in this deployment's directory matching what somebody typed.
 *
 * Runs alongside the relay search rather than instead of it — they answer
 * different questions. The relays know what has been *said*; the directory
 * knows who has a name here, which is the question behind "is `ana` taken"
 * and behind finding somebody you only know as an address.
 *
 * Disabled entirely when no directory is configured, so a deployment without
 * one issues no requests and renders no empty section.
 */
export function useDirectorySearch(query: string) {
  const term = query.trim();

  return useQuery<DirectoryHit[]>({
    queryKey: ['directory-search', term],
    queryFn: ({ signal }) => searchDirectory(term, { signal }),
    enabled: hasDirectory && term.length >= 2,

    /*
     * Never retried. `searchDirectory` resolves to an empty list rather than
     * throwing, so a retry could only repeat a request that already decided
     * it had nothing — and this is on a keystroke path.
     */
    retry: false,
    staleTime: 60_000,
  });
}
