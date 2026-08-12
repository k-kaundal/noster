import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { lnbitsRequest } from '@/lib/lnbits';
import {
  COMMON_CURRENCIES,
  HIDE_FIAT,
  formatFiat,
  guessCurrency,
  isStale,
  normalizeCurrency,
  readCurrencies,
  readRate,
  satsToFiat,
  type FiatRate,
} from '@/lib/currency';

const CURRENCY_KEY = 'nostrfeed:currency';

/** How long a price stays good enough to show without refetching. */
const FRESH_MS = 5 * 60 * 1000;

/**
 * The reader's chosen currency, or `HIDE_FIAT`.
 *
 * Separate from the rate query so that changing it does not force every
 * component reading a price to re-render through a fetch.
 */
export function useCurrencyPreference() {
  const fallback = useMemo(() => guessCurrency(), []);
  const [stored, setStored] = useLocalStorage<string>(CURRENCY_KEY, fallback);

  const currency = stored === HIDE_FIAT ? HIDE_FIAT : normalizeCurrency(stored) || fallback;

  return { currency, setCurrency: setStored, guessed: fallback };
}

/**
 * The current bitcoin price, in one currency.
 *
 * Refetched on an interval rather than only on mount: somebody watching a
 * balance or filling in a zap amount has the page open for minutes, and a
 * price frozen at the moment they arrived is the one thing worse than no
 * price — it looks live.
 */
export function useBtcRate(currency: string) {
  const enabled = !!currency && currency !== HIDE_FIAT;

  return useQuery<FiatRate | null>({
    queryKey: ['btc-rate', currency],
    enabled,
    queryFn: async ({ signal }) => {
      const body = await lnbitsRequest<unknown>(
        `/api/v1/rate/${encodeURIComponent(currency)}`,
        { signal }
      );

      const satsPerUnit = readRate(body, currency);
      if (satsPerUnit === null) return null;

      return { currency, satsPerUnit, fetchedAt: Date.now() };
    },
    staleTime: FRESH_MS,
    refetchInterval: FRESH_MS,
    /**
     * The last known price is kept while a refetch runs, and kept across a
     * navigation away and back. It is marked stale where it is shown rather
     * than blanked, because a price from ten minutes ago answers "roughly how
     * much is this" and an empty space does not.
     */
    gcTime: 6 * 60 * 60 * 1000,
    retry: 1,
  });
}

/**
 * Everything a component needs to put a fiat figure next to an amount of sats.
 *
 * Deliberately returns `null` from `format` rather than a placeholder when
 * there is no rate. A component can then render nothing at all, which is the
 * honest outcome — a dash or a zero next to a balance reads as a value.
 */
export function useFiat() {
  const { currency, setCurrency, guessed } = useCurrencyPreference();
  const { data: rate, isLoading, isError, refetch } = useBtcRate(currency);

  const format = useCallback(
    (sats: number): string | null =>
      rate ? formatFiat(satsToFiat(sats, rate), rate.currency) : null,
    [rate]
  );

  return {
    /** Whether the reader wants fiat shown at all. */
    enabled: currency !== HIDE_FIAT,
    currency,
    setCurrency,
    guessed,
    rate: rate ?? null,
    stale: !!rate && isStale(rate),
    isLoading,
    isError,
    refetch,
    format,
    toFiat: useCallback(
      (sats: number): number | null => (rate ? satsToFiat(sats, rate) : null),
      [rate]
    ),
  };
}

/**
 * Every currency the backend can price, for the picker.
 *
 * Falls back to the common ones rather than to nothing: a picker that fails to
 * load is a setting somebody cannot change, and the twenty codes bundled here
 * cover most of the people who would go looking for it.
 */
export function useCurrencyList(include?: string) {
  const query = useQuery({
    queryKey: ['fiat-currencies'],
    queryFn: async ({ signal }) => {
      const body = await lnbitsRequest<unknown>('/api/v1/currencies', { signal });
      return readCurrencies(body);
    },
    // A currency list changes on the timescale of geopolitics, not of a session
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    retry: 1,
  });

  const fetched = query.data?.length ? query.data : COMMON_CURRENCIES;

  /**
   * The current choice is always in the list.
   *
   * It is guessed from the browser's locale, which reaches currencies the
   * bundled fallback does not carry — so somebody in Dubai whose list failed
   * to load would open the picker and find it showing nothing selected, with
   * their own currency missing from the options.
   */
  const chosen = include && include !== HIDE_FIAT ? normalizeCurrency(include) : '';
  const all =
    chosen && !fetched.includes(chosen) ? [...fetched, chosen].sort() : fetched;

  return {
    /** Offered first, so the usual answer is one tap away. */
    common: COMMON_CURRENCIES.filter((code) => all.includes(code)),
    rest: all.filter((code) => !COMMON_CURRENCIES.includes(code)),
    all,
    isLoading: query.isLoading,
  };
}
