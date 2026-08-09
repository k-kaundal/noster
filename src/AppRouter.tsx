import { Suspense, lazy } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ScrollToTop } from "./components/ScrollToTop";
import { PostSkeletonList } from "./components/PostSkeleton";

import Index from "./pages/Index";

// Everything past the home page loads on demand, so the first paint stays small
const ComposePage = lazy(() => import("./pages/ComposePage"));
const TrendingPage = lazy(() => import("./pages/TrendingPage"));
const ExplorePage = lazy(() => import("./pages/ExplorePage"));
const HashtagPage = lazy(() => import("./pages/HashtagPage"));
const RelaysPage = lazy(() => import("./pages/RelaysPage"));
const ReelsPage = lazy(() => import("./pages/ReelsPage"));
const BookmarksPage = lazy(() => import("./pages/BookmarksPage"));
const ChatPage = lazy(() => import("./pages/ChatPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const PremiumPage = lazy(() => import("./pages/PremiumPage"));
const WalletPage = lazy(() => import("./pages/WalletPage"));
const WritePage = lazy(() => import("./pages/WritePage"));
const CommunitiesPage = lazy(() => import("./pages/CommunitiesPage"));
const NotificationsPage = lazy(() => import("./pages/NotificationsPage"));
const IdentityVaultPage = lazy(() => import("./pages/IdentityVaultPage"));
const CommunityTreasuryPage = lazy(() => import("./pages/CommunityTreasuryPage"));
const BountiesPage = lazy(() => import("./pages/BountiesPage"));
const MembershipsPage = lazy(() => import("./pages/MembershipsPage"));
const SatsDropsPage = lazy(() => import("./pages/SatsDropsPage"));
const LiveStreamingPage = lazy(() => import("./pages/LiveStreamingPage"));
const MiniAppsPage = lazy(() => import("./pages/MiniAppsPage"));
const NIP19Page = lazy(() =>
  import("./pages/NIP19Page").then((m) => ({ default: m.NIP19Page }))
);
const FollowingPage = lazy(() =>
  import("./pages/FollowingPage").then((m) => ({ default: m.FollowingPage }))
);
const FollowersPage = lazy(() =>
  import("./pages/FollowersPage").then((m) => ({ default: m.FollowersPage }))
);
const NotFound = lazy(() => import("./pages/NotFound"));

function RouteFallback() {
  return (
    <div className="container py-10">
      <PostSkeletonList count={3} />
    </div>
  );
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/compose" element={<ComposePage />} />
          <Route path="/trending" element={<TrendingPage />} />
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
          {/* Custodial lightning wallet, authenticated with the Nostr key */}
          <Route path="/wallet" element={<WalletPage />} />
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
