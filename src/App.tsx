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
import { NWCProvider } from '@/contexts/NWCContext';
import { AppConfig } from '@/contexts/AppContext';
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

const defaultConfig: AppConfig = {
  theme: "system",
  accent: "violet",
  relayUrl: "wss://relay.damus.io",
  // Reads fan out across all of these; writes go to the ones marked write
  relays: [
    { url: "wss://relay.damus.io", read: true, write: true },
    { url: "wss://relay.primal.net", read: true, write: true },
    { url: "wss://relay.nostr.band", read: true, write: false },
    { url: "wss://nos.lol", read: true, write: true },
  ],
};

const presetRelays = [
  { url: 'wss://relay.damus.io', name: 'Damus' },
  { url: 'wss://relay.primal.net', name: 'Primal' },
  { url: 'wss://relay.nostr.band', name: 'Nostr.Band' },
  { url: 'wss://relay.nostrfeed.com', name: 'NostrFeed', active: true },
  { url: 'wss://nos.lol', name: 'nos.lol' },
  { url: 'wss://relay.snort.social', name: 'Snort' },
  { url: 'wss://ditto.pub/relay', name: 'Ditto' },
  { url: 'wss://nostr.oxtr.dev', name: 'Oxtr' },
  { url: 'wss://nostr.bitcoiner.social', name: 'Bitcoiner.Social' },
  { url: 'wss://nostr.wine', name: 'Nostr.Wine', active: true },
  { url: 'wss://at.nostrworks.com', name: 'NostrWorks', active: true },
  { url: 'wss://btc.klendazu.com', name: 'Klendazu', active: true },
  { url: 'wss://knostr.neutrine.com', name: 'Knostr', active: true },
  { url: 'wss://nostr-1.nbo.angani.co', name: 'Angani', active: true },
  { url: 'wss://atlas.nostr.land', name: 'Atlas', active: true },
  { url: 'wss://bitcoiner.social', name: 'Bitcoiner', active: true },
  { url: 'wss://filter.nostr.wine', name: 'Filter.Nostr.Wine', active: true },
  { url: 'wss://puravida.nostr.land', name: 'PuraVida', active: true },
  { url: 'wss://relay.nostrplebs.com', name: 'NostrPlebs', active: true },
  { url: 'wss://offchain.pub', name: 'Offchain', active: true },
  { url: 'wss://relay.nostrview.com', name: 'NostrView', active: true },
  { url: 'wss://eden.nostr.land', name: 'Eden', active: true },
  { url: 'wss://theforest.nostr1.com', name: 'TheForest', active: true }
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
                  <Toaster />
                  <Sonner />
                  <Suspense>
                    <AppRouter />
                  </Suspense>
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
