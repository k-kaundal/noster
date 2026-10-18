import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { fetchTrendingGifs, searchGifs, type GifResult } from '@/lib/gif';

/** Matches Damus's 300ms debounce — fast enough to feel live, slow enough to not spam. */
const DEBOUNCE_MS = 300;

/**
 * GIF search with debounced input and trending by default.
 *
 * The picker opens to trending — an empty search box is not a blank grid,
 * it is the answer to "what's popular right now". Typing switches to search
 * after the debounce, and clearing the box switches back.
 */
export function useGifSearch() {
  const [input, setInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(input.trim());
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [input]);

  const isSearching = debouncedQuery.length > 0;

  const query = useQuery<GifResult[]>({
    queryKey: isSearching ? ['gif-search', debouncedQuery] : ['gif-trending'],
    queryFn: async ({ signal }) => {
      return isSearching
        ? searchGifs(debouncedQuery, 30, signal)
        : fetchTrendingGifs(30, signal);
    },
    staleTime: 5 * 60 * 1000,
    // The previous results stay on screen while the next letter's fetch is
    // in flight — a grid that blinks empty on every keystroke reads as broken
    placeholderData: (previousData) => previousData,
  });

  return {
    gifs: query.data ?? [],
    input,
    setInput,
    isSearching,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
