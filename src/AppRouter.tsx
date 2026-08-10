import { Suspense, lazy } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { ScrollRestoration } from "./components/ScrollRestoration";

import { importChunk } from "./lib/importChunk";

import Index from "./pages/Index";

// Everything past the home page loads on demand, so the first paint stays small
const ComposePage = lazy(() => importChunk(() => import("./pages/ComposePage")));
const TrendingPage = lazy(() => importChunk(() => import("./pages/TrendingPage")));
const DiscoveryPage = lazy(() => importChunk(() => import("./pages/DiscoveryPage")));
const ExplorePage = lazy(() => importChunk(() => import("./pages/ExplorePage")));
const HashtagPage = lazy(() => importChunk(() => import("./pages/HashtagPage")));
const RelaysPage = lazy(() => importChunk(() => import("./pages/RelaysPage")));
const ReelsPage = lazy(() => importChunk(() => import("./pages/ReelsPage")));
const BookmarksPage = lazy(() => importChunk(() => import("./pages/BookmarksPage")));
const ChatPage = lazy(() => importChunk(() => import("./pages/ChatPage")));
const SettingsPage = lazy(() => importChunk(() => import("./pages/SettingsPage")));
const PremiumPage = lazy(() => importChunk(() => import("./pages/PremiumPage")));
const WalletPage = lazy(() => importChunk(() => import("./pages/WalletPage")));
const EcashPage = lazy(() => importChunk(() => import("./pages/EcashPage")));
const ServicesPage = lazy(() => importChunk(() => import("./pages/ServicesPage")));
const WritePage = lazy(() => importChunk(() => import("./pages/WritePage")));
const CommunitiesPage = lazy(() => importChunk(() => import("./pages/CommunitiesPage")));
const GroupsPage = lazy(() => importChunk(() => import("./pages/GroupsPage")));
const ListsPage = lazy(() => importChunk(() => import("./pages/ListsPage")));
const NotificationsPage = lazy(() => importChunk(() => import("./pages/NotificationsPage")));
const IdentityVaultPage = lazy(() => importChunk(() => import("./pages/IdentityVaultPage")));
const CommunityTreasuryPage = lazy(() => importChunk(() => import("./pages/CommunityTreasuryPage")));
const BountiesPage = lazy(() => importChunk(() => import("./pages/BountiesPage")));
const MembershipsPage = lazy(() => importChunk(() => import("./pages/MembershipsPage")));
const SatsDropsPage = lazy(() => importChunk(() => import("./pages/SatsDropsPage")));
const LiveStreamingPage = lazy(() => importChunk(() => import("./pages/LiveStreamingPage")));
const MiniAppsPage = lazy(() => importChunk(() => import("./pages/MiniAppsPage")));
const NIP19Page = lazy(() =>
  importChunk(() =>
    import("./pages/NIP19Page").then((m) => ({ default: m.NIP19Page }))
  )
);
const FollowingPage = lazy(() =>
  importChunk(() =>
    import("./pages/FollowingPage").then((m) => ({ default: m.FollowingPage }))
  )
);
const FollowersPage = lazy(() =>
  importChunk(() =>
    import("./pages/FollowersPage").then((m) => ({ default: m.FollowersPage }))
  )
);
const NotFound = lazy(() => importChunk(() => import("./pages/NotFound")));

/**
 * Shown only while a route's code is still downloading.
 *
 * Deliberately quiet, and deliberately not post-shaped. It used to be three
 * shimmering post cards, which meant opening Settings flashed a fake timeline
 * at you first — an animation promising content that was never coming. The
 * loading bar at the top of the layout already says something is happening;
 * this only needs to hold the space without lying about what goes in it.
 */
function RouteFallback() {
  return (
    <div
      className="container flex min-h-[50vh] items-center justify-center"
      role="status"
      aria-label="Loading"
    >
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <ScrollRestoration />
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/compose" element={<ComposePage />} />
          <Route path="/trending" element={<TrendingPage />} />
          <Route path="/discovery" element={<DiscoveryPage />} />
          <Route path="/explore" element={<ExplorePage />} />
          {/* Hashtag feed */}
          <Route path="/t/:tag" element={<HashtagPage />} />
          {/* Relay management */}
          <Route path="/relays" element={<RelaysPage />} />
          {/* NIP-71 short video feed */}
          <Route path="/reels" element={<ReelsPage />} />
          {/* NIP-51 saved notes */}
          <Route path="/bookmarks" element={<BookmarksPage />} />
          {/* NIP-17 private messages */}
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/chat/:npub" element={<ChatPage />} />
          {/* Mentions, reactions, reposts and NIP-57 zaps */}
          <Route path="/notifications" element={<NotificationsPage />} />
          {/* NIP-23 long-form articles */}
          <Route path="/write" element={<WritePage />} />
          {/* NIP-72 moderated communities */}
          <Route path="/communities" element={<CommunitiesPage />} />
          {/* NIP-29 groups, which live on one relay rather than the network */}
          <Route path="/groups" element={<GroupsPage />} />
          {/* NIP-51 follow sets and starter packs */}
          <Route path="/lists" element={<ListsPage />} />
          {/* Custodial lightning wallet, authenticated with the Nostr key */}
          <Route path="/wallet" element={<WalletPage />} />
          {/* NIP-60 Cashu ecash, held in the browser and backed up to relays */}
          <Route path="/ecash" element={<EcashPage />} />
          {/* The lightning wallet, mint and standalone wallet we run */}
          <Route path="/services" element={<ServicesPage />} />
          {/* Paid relay access, sold through LNbits pay links */}
          <Route path="/premium" element={<PremiumPage />} />
          {/* Nostr identity vault: signing devices, relays, apps, permissions */}
          <Route path="/identity" element={<IdentityVaultPage />} />
          {/* Community treasury: shared wallet, members, transactions */}
          <Route path="/community-treasury" element={<CommunityTreasuryPage />} />
          {/* Bounties: fund tasks, submit solutions, earn sats */}
          <Route path="/bounties" element={<BountiesPage />} />
          {/* Memberships: recurring revenue from subscribers */}
          <Route path="/memberships" element={<MembershipsPage />} />
          {/* Sats Drops: LNURL-withdraw distributions to community */}
          <Route path="/sats-drops" element={<SatsDropsPage />} />
          {/* Live Streaming: Broadcast content and earn sats in real-time */}
          <Route path="/live" element={<LiveStreamingPage />} />
          {/* Mini Apps: Community-built extensions and tools */}
          <Route path="/mini-apps" element={<MiniAppsPage />} />
          {/* Appearance, NIP-51 mutes, NIP-17 message relays */}
          <Route path="/settings" element={<SettingsPage />} />
          {/* Follow pages */}
          <Route path="/:nip19/following" element={<FollowingPage />} />
          <Route path="/:nip19/followers" element={<FollowersPage />} />
          {/* NIP-19 route for npub1, note1, naddr1, nevent1, nprofile1 */}
          <Route path="/:nip19" element={<NIP19Page />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
export default AppRouter;
