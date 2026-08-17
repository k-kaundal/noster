// NOTE: This file should normally not be modified unless you are adding a new provider.
// To add new routes, edit the AppRouter.tsx file.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createHead, UnheadProvider } from '@unhead/react/client';
import { InferSeoMetaPlugin } from '@unhead/addons';
import { Suspense } from 'react';
import NostrProvider from '@/components/NostrProvider';
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NostrLoginProvider } from '@nostrify/react/login';
import { AppProvider } from '@/components/AppProvider';
import { ImageLightboxProvider } from '@/components/ImageLightbox';
import { NWCProvider } from '@/contexts/NWCContext';
import { AppConfig } from '@/contexts/AppContext';
import { persistQueryCache, restoreQueryCache } from '@/lib/queryPersistence';
import { recallSync, warmEventStore } from '@/lib/eventStore';
import { RELAY_LIST_SCOPE, primeOutboxTable } from '@/lib/outboxRouting';
import { pruneLegacyProviders } from '@/lib/zapProviders';
import AppRouter from './AppRouter';

const head = createHead({
  plugins: [
    InferSeoMetaPlugin(),
  ],
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      // Navigating back to a page should paint from cache, not re-query the
      // relay; the data is only refetched once it is actually stale.
      refetchOnMount: false,
      refetchOnReconnect: true,
      staleTime: 2 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      // Relays are flaky enough that one retry helps, but more just delays
      // the empty state the reader needs to see.
      retry: 1,
      retryDelay: (attempt) => Math.min(500 * 2 ** attempt, 3000),
    },
  },
});

/**
 * Paint from the last visit, then refresh.
 *
 * Restored before the first render so the feed and the names in it are already
 * there when React mounts, rather than several relay round trips later. The
 * data is still refetched — this only changes what the reader looks at while
 * that happens.
 */
restoreQueryCache(queryClient);
persistQueryCache(queryClient);

/*
 * Zap provider keys were briefly stored per domain, where one pay link's key
 * was applied to receipts from every other pay link on the same host — and
 * refused them. See `lib/zapProviders`.
 */
pruneLegacyProviders();

/**
 * Loads the durable event store into memory alongside it.
 *
 * Deliberately not awaited. IndexedDB is where the things too big for
 * localStorage live — follower sets, and whatever else grows past a couple of
 * megabytes — and a slow disk should cost a later paint, never a blocked one.
 */
void warmEventStore().then(() => {
  /*
   * Relay lists learned on earlier visits go back into the routing table, so
   * the first feed of a session is already routed to where people publish
   * rather than having to rediscover it one profile at a time.
   */
  primeOutboxTable(recallSync(RELAY_LIST_SCOPE));
});

const defaultConfig: AppConfig = {
  theme: "system",
  accent: "violet",
  // Our own relay is primary: the routers put it first and never truncate it
  // away, so it is the one relay every read and every publish is guaranteed
  // to reach. A note written here should be on the relay this app runs.
  relayUrl: "wss://relay.nostrfeed.com",
  // Reads fan out across all of these; writes go to the ones marked write
  relays: [
    { url: "wss://relay.nostrfeed.com", read: true, write: true },
    { url: "wss://relay.nostr.band", read: true, write: true },
    { url: "wss://relay.primal.net", read: true, write: true },
    { url: "wss://nos.lol", read: true, write: true },
    { url: "wss://nostr.wine", read: true, write: true },
    { url: "wss://offchain.pub", read: true, write: false },
  ],
};

/**
 * Relays offered in the picker.
 *
 * `active` means "suggested" — the shortlist someone is steered towards. It
 * used to mark almost everything, including several wide-open relays that
 * carry whatever anybody posts, which is how adult content reaches a global
 * feed. The suggested set is now small and moderated; the rest stay available
 * for anyone who wants them, because removing a relay from a Nostr client is
 * not the same as it not existing.
 *
 * This is a curated list, not a verdict on any operator. Self-labelled adult
 * posts are filtered on the way in regardless of which relay they arrive
 * from — see `lib/nsfw.ts` — because a general relay's contents change daily
 * and a list like this cannot keep up.
 */
const presetRelays = [
  // Suggested: our own first, then well-run general relays
  { url: 'wss://relay.nostrfeed.com', name: 'NostrFeed', active: true },
  { url: 'wss://relay.nostr.band', name: 'Nostr.Band', active: true },
  { url: 'wss://relay.primal.net', name: 'Primal', active: true },
  { url: 'wss://nos.lol', name: 'nos.lol', active: true },
  { url: 'wss://offchain.pub', name: 'Offchain', active: true },

  // Paid and filtered: spam and adult content are far rarer behind a fee
  { url: 'wss://nostr.wine', name: 'Nostr.Wine (paid)', active: true },
  { url: 'wss://filter.nostr.wine', name: 'Filter.Nostr.Wine (paid)' },
  { url: 'wss://relay.nostrplebs.com', name: 'NostrPlebs (paid)' },
  { url: 'wss://eden.nostr.land', name: 'Eden (paid)' },
  { url: 'wss://atlas.nostr.land', name: 'Atlas (paid)' },
  { url: 'wss://puravida.nostr.land', name: 'PuraVida (paid)' },

  // Available, not suggested. Open relays with no moderation of their own.
  { url: 'wss://relay.snort.social', name: 'Snort' },
  { url: 'wss://ditto.pub/relay', name: 'Ditto' },
  { url: 'wss://nostr.oxtr.dev', name: 'Oxtr' },
  { url: 'wss://nostr.bitcoiner.social', name: 'Bitcoiner.Social' },
  { url: 'wss://at.nostrworks.com', name: 'NostrWorks' },
  { url: 'wss://relay.nostrview.com', name: 'NostrView' },
  { url: 'wss://knostr.neutrine.com', name: 'Knostr' },
  { url: 'wss://theforest.nostr1.com', name: 'TheForest' },
];

export function App() {
  return (
    <UnheadProvider head={head}>
      <AppProvider storageKey="nostr:app-config" defaultConfig={defaultConfig} presetRelays={presetRelays}>
        <QueryClientProvider client={queryClient}>
          <NostrLoginProvider storageKey='nostr:login'>
            <NostrProvider>
              <NWCProvider>
                <TooltipProvider delayDuration={250}>
                  <ImageLightboxProvider>
                    <Toaster />
                    <Sonner />
                    <Suspense>
                      <AppRouter />
                    </Suspense>
                  </ImageLightboxProvider>
                </TooltipProvider>
              </NWCProvider>
            </NostrProvider>
          </NostrLoginProvider>
        </QueryClientProvider>
      </AppProvider>
    </UnheadProvider>
  );
}

export default App;
