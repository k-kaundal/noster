import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ScrollToTop } from "./components/ScrollToTop";

import Index from "./pages/Index";
import ComposePage from "./pages/ComposePage";
import TrendingPage from "./pages/TrendingPage";
import ExplorePage from "./pages/ExplorePage";
import { NIP19Page } from "./pages/NIP19Page";
import { FollowingPage } from "./pages/FollowingPage";
import { FollowersPage } from "./pages/FollowersPage";
import NotFound from "./pages/NotFound";

export function AppRouter() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/compose" element={<ComposePage />} />
        <Route path="/trending" element={<TrendingPage />} />
        <Route path="/explore" element={<ExplorePage />} />
        {/* Follow pages */}
        <Route path="/:nip19/following" element={<FollowingPage />} />
        <Route path="/:nip19/followers" element={<FollowersPage />} />
        {/* NIP-19 route for npub1, note1, naddr1, nevent1, nprofile1 */}
        <Route path="/:nip19" element={<NIP19Page />} />
        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
export default AppRouter;