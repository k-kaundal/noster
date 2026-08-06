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
