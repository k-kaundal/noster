import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';

import {
  APP_HANDLER_INFO_KIND,
  APP_HANDLER_RECOMMENDATION_KIND,
  newestAppHandlers,
  newestRecommendations,
  type AppHandler,
  type AppRecommendation,
} from '@/lib/nip89';

const TIMEOUT = 6000;
const LIMIT = 300;

/**
 * Every app handler on the relay, with the recommendations behind them.
 *
 * A handler is only worth listing if someone recommended it — an announcement
 * nobody vouched for is a developer talking to themselves. The directory is
 * built from recommendations first and filled in with the handler details.
 */
export function useAppDirectory() {
  const { nostr } = useNostr();

  const query = useQuery({
    queryKey: ['app-directory'],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(TIMEOUT)]);

      const [handlers, recommendations] = await Promise.all([
        nostr.query(
          [{ kinds: [APP_HANDLER_INFO_KIND], limit: LIMIT }],
          { signal }
        ),
        nostr.query(
          [{ kinds: [APP_HANDLER_RECOMMENDATION_KIND], limit: LIMIT }],
          { signal }
        ),
      ]);

      const handlerList = newestAppHandlers(handlers);
      const recList = newestRecommendations(recommendations);

      // Count recommendations per handler address
      const recCount = new Map<string, number>();
      for (const rec of recList) {
        recCount.set(
          rec.handlerAddress,
          (recCount.get(rec.handlerAddress) ?? 0) + 1
        );
      }

      // Only keep handlers somebody recommended, sorted by how many
      const recommended = handlerList
        .filter((handler) => recCount.has(handler.address))
        .map((handler) => ({
          handler,
          recommendations: recCount.get(handler.address) ?? 0,
          recommendedFor: recList
            .filter((rec) => rec.handlerAddress === handler.address)
            .map((rec) => rec.kind),
        }))
        .sort((a, b) => b.recommendations - a.recommendations);

      return recommended;
    },
    staleTime: 120_000,
  });

  return {
    apps: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error as Error | null,
  };
}

export type { AppHandler, AppRecommendation };
