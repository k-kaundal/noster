# NostrFeed Flutter — Full-App Performance Analysis & Fixes

Date: 2026-10-25. Companion to `AUDIT-feed-profile-upload.md` (scroll/memory)
and `ADR-0005-event-pipeline.md` (architecture). This doc covers **latency**
(time-to-content) across the app — the "explore is slow" report plus a full
sweep for the same pattern elsewhere.

---

## 1. What was slow — root causes found & fixed

### A. Explore screen = two serial relay waterfalls per visit ✅ FIXED
- `fetchTrendingHashtags`: **500** events (8s timeout) → engagement batch
  (**8s**) → count. Worst case ~16s before a chip row appears.
- `fetchTrending`: **250** candidates (`limit*5`, 10s) → engagement batch
  (8s) → rank. Another ~18s worst case.
- Both were `autoDispose` → **threw everything away on every tab switch**,
  so *every* Explore visit paid both waterfalls again. This is the "explore
  is slow" complaint in one sentence.

**Fixes:**
- `trendingProvider` → keepAlive + per-window **5-min TTL** on the relay
  leg (was autoDispose). Re-entry is instant; pull-to-refresh still works
  via `ref.invalidate`.
- `trendingHashtagsProvider` → keepAlive + **10-min TTL** cache.
- Payload trims: hashtags **500→250** events (8s→6s), trending candidates
  **250→150** (`limit*3`, 10s→6s), engagement batch **8s→5s** (it's a
  weight signal, not the data — a slow relay must not hold the screen).

Result: first visit ≈ local paint instantly + relay ≤ ~11s worst (was ~34s
combined), **re-visit ≈ instant** (TTL cache).

### B. Profile fetch = serial 3s→2s→2s waterfall per profile ✅ FIXED
`fetchProfile` ran default relays → NIP-65 outbox relays → indexer relays
**one after another** — a profile that missed all three cost ~7s (avatars,
banners, profile screens stalling).

**Fix:** all three legs now run **concurrently** and the **first non-empty
leg wins** (`_firstNonEmpty` helper). Worst case drops from ~7s to ~3s, and
the common case (default-relay hit) is unchanged (<1s).

### C. Verified earlier this session (scroll/memory latency)
- Feed window cap (400), image-cache caps (48 MB), banner display-size
  decode, no per-card tickers, lazy thread rendering, cross-relay sig-verify
  dedup (C4), EventStore open race fix — see `AUDIT-feed-profile-upload.md`.

---

## 2. Other slow paths found (ranked, with fix direction)

### HIGH
1. **`fetchEngagementBatch` is still the second serial leg everywhere.**
   Explore/trending now TTL-gate it, but any screen calling it directly
   pays 5s worst. Direction: read counts from the local engagement index
   (`event_refs`) first (ADR-0005 L5), relay only to backfill deltas.
2. **Notifications screen** (`notificationsProvider`): autoDispose +
   relay-only, refetches on every visit. Direction: store-first (the
   notification center already ingests social events) + keepAlive + TTL.
3. **Bookmarked-id check per card** (`bookmarkedIdsProvider`): keepAlive ✅
   already, but the first fetch blocks card rendering until the kind-10003
   list resolves. Direction: read from store, warm in background.

### MEDIUM — now FIXED (2026-10-25)
4. **Search** ✅ FIXED: `userSearchProvider` step 4 fired a SECOND relay
   query (500 recent kind-0s) serially after the NIP-50 leg on EVERY query.
   Now: the local fallback runs over the persistent profile cache
   (`EventStore.searchProfiles`, SQL LIKE + field match, zero network) and
   is skipped entirely when NIP-50 fills the result set. NIP-50 timeout
   6s→5s. The screen already debounces at 400ms.
5. **Bookmarks/Communities/Articles** ✅ FIXED: converted to keepAlive +
   5-min TTL `AsyncNotifier`s (store-warmed), same pattern as trending.
   `ref.invalidate`/pull-to-refresh still forces a real refetch.
6. **Chat** ✅ FIXED (both halves): `dmsProvider` → keepAlive + TTL (was
   autoDispose — re-ran fetch + decrypt on every chat open). `DmStore.prime`
   is now **time-sliced** — the synchronous NIP-44/NIP-04 crypto yields to
   the event loop every 4 decryptions, so a gap-fill burst no longer freezes
   the UI (no isolate/nsec risk).
7. **Lists / Calendar / Market / Live / Videos / Hashtag-feed** ✅ FIXED
   (2026-10-25): all converted from autoDispose relay-only to keepAlive +
   TTL `AsyncNotifier`s (store-warmed). Live uses a 1-min TTL (goes stale
   fast); hashtag feed is a family with per-tag TTL. That completes the
   browse-screen sweep — every tab/screen now renders from cache on
   re-entry and only refetches on TTL expiry or explicit pull-to-refresh.

### LOW (already good)
7. **Feed** — store-first, batched warming, bounded, prefetched images ✅.
8. **Thread** — store-first replies + lazy list ✅.
9. **Image decode** — display-size + CDN resize + prefetch ✅.
10. **Relay verify** — cross-relay dedup ✅.

---

## 3. The standing rules (so it doesn't regress)

- **Browse screens never autoDispose network data.** keepAlive + TTL;
  `ref.invalidate` on pull-to-refresh. autoDispose is for detail screens
  and per-card family entries (see `localEngagementProvider`'s note).
- **Never a serial relay waterfall.** Concurrent legs, first-hit wins; a
  leg that only *weights* data gets a shorter timeout than the data leg.
- **Payloads are sized for the UI**, not "as much as the relay will give" —
  browse rows ≠ feeds.
- **Store-first everywhere** (ADR-0005): relays backfill, the store paints.

---

## 4. Follow-up regressions FIXED (2026-10-25, user-reported)

**Feed pull-to-refresh "not working":** after the P3 ingest pipeline, live
posts land in the store + "N new posts" pill the moment they arrive, so a
pull that only re-merged the relay page showed NO visible change. Fix:
`refreshFromPull` now folds the pill's pending posts in first
(`showNewPosts()`), then refreshes — a pull is an explicit "show me what's
new".

**Notification tap shows stale data:** `ThreadScreen` rendered the passed
(possibly-old) event object. Fix: `_freshRootProvider` — store-first +
bounded relay backfill, the root card renders the freshest known revision.

**Trending hashtags not showing in explore:** the new keepAlive+TTL cache
cached `[]` on a quiet first fetch (slow relays on cold start) and stuck
"No trending hashtags right now" for the full 10-min TTL. Fix: EMPTY
results are NOT TTL-cached — they retry on the next visit.
