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

const defaultConfig: AppConfig = {
  theme: "system",
  accent: "violet",
  // Use relay.nostr.band as primary for better engagement data indexing
  relayUrl: "wss://relay.nostr.band",
  // Reads fan out across all of these; writes go to the ones marked write
  relays: [
    { url: "wss://relay.nostr.band", read: true, write: true },
    { url: "wss://relay.primal.net", read: true, write: true },
    { url: "wss://nos.lol", read: true, write: true },
    { url: "wss://relay.nostrfeed.com", read: true, write: true },
    { url: "wss://nostr.wine", read: true, write: true },
    { url: "wss://offchain.pub", read: true, write: false },
  ],
};

const presetRelays = [
  // Primary & Top Tier Relays (most stable and reliable)
  { url: 'wss://relay.nostrfeed.com', name: 'NostrFeed', active: true },
  { url: 'wss://nos.lol', name: 'nos.lol', active: true },
  { url: 'wss://relay.nostr.band', name: 'Nostr.Band', active: true },
  { url: 'wss://relay.primal.net', name: 'Primal', active: true },

  // Additional Quality Relays
  { url: 'wss://nostr.wine', name: 'Nostr.Wine', active: true },
  { url: 'wss://relay.snort.social', name: 'Snort' },
  { url: 'wss://ditto.pub/relay', name: 'Ditto' },
  { url: 'wss://at.nostrworks.com', name: 'NostrWorks', active: true },
  { url: 'wss://relay.nostrplebs.com', name: 'NostrPlebs', active: true },
  { url: 'wss://offchain.pub', name: 'Offchain', active: true },
  { url: 'wss://filter.nostr.wine', name: 'Filter.Nostr.Wine', active: true },
  { url: 'wss://relay.nostrview.com', name: 'NostrView', active: true },
  { url: 'wss://atlas.nostr.land', name: 'Atlas', active: true },
  { url: 'wss://puravida.nostr.land', name: 'PuraVida', active: true },

  // Specialized Relays
  { url: 'wss://nostr.oxtr.dev', name: 'Oxtr' },
  { url: 'wss://nostr.bitcoiner.social', name: 'Bitcoiner.Social' },
  { url: 'wss://bitcoiner.social', name: 'Bitcoiner', active: true },
  { url: 'wss://knostr.neutrine.com', name: 'Knostr', active: true },
  { url: 'wss://nostr-1.nbo.angani.co', name: 'Angani', active: true },
  { url: 'wss://eden.nostr.land', name: 'Eden', active: true },
  { url: 'wss://theforest.nostr1.com', name: 'TheForest', active: true },
  { url: 'wss://btc.klendazu.com', name: 'Klendazu', active: true }
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
