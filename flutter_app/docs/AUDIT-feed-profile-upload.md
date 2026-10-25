# NostrFeed Flutter — Profile / Upload / Feed-Scroll Audit

Date: 2026-10-25. Verified against `lib/` source (file:line evidence inline).
Companion research: [`../../docs/FEED_SCROLL_ARCHITECTURE_DIGEST.md`](../../docs/FEED_SCROLL_ARCHITECTURE_DIGEST.md) (Nostr clients + Flutter scroll) and [`../../docs/primal-android-research-digest.md`](../../docs/primal-android-research-digest.md) (PrimalHQ/primal-android-app deep-dive with a 15-item Flutter port list, R1–R15).

The user reports three problem areas, in priority order:
1. **Profile banner issues.**
2. **Upload flow (needs in-depth review).**
3. **Feed / reply handling / scrolling — app stutters and scroll gets STUCK on Android after some time.** Wants smoother images, smoother scroll, better data handling, and to understand how top Nostr clients do it.

---

## TL;DR — root causes of "scroll gets stuck after some time"

This is a **memory + unbounded-growth** problem, not a single bug. Five compounding causes:

| # | Cause | Where | Effect |
|---|-------|-------|--------|
| 1 | **Feed list grows forever** — no cap on `state.events` | `feed_notifier.dart` `_merge` (459-489) has no trim | After ~20 pages = 1000 events in memory; every merge/scroll is O(n) on the UI isolate with growing n |
| 2 | **Profile banner decodes at FULL resolution** — no `memCacheWidth`, no CDN resize | `profile_screen.dart:407-414` | One 4000×3000 banner ≈ 48 MB decoded RAM for a 200-dp slot (ADR-0004 claims 200 dp — **not true in code**) |
| 3 | **No image-cache byte limit set** | `main.dart` (absent) | `PaintingBinding.imageCache` default = 1000 imgs / 100 MB; on a 3 GB Android phone → GC pauses → jank |
| 4 | **6 AnimationControllers per PostCard** (one per action button) | `post_card.dart:968-974` | ~15 cards in viewport+cache × 6 = **~90 live tickers** running vsync every frame |
| 5 | **Schnorr signature verify runs on the UI isolate** for every incoming event | `relay_pool.dart:154-178` → `nostr_models.dart:102-113` | A 1000-event engagement batch ≈ ~100 ms of synchronous crypto → dropped frames mid-scroll |

Fixes 1–4 are small, local, and high-impact. #5 needs an isolate.

---

## A. PROFILE SCREEN & BANNER

### How it works
- Banner renders in `SliverAppBar` → `FlexibleSpaceBar.background` → `SmartNetworkImage` (`profile_screen.dart:400-424`).
- Profile data: `profileProvider` (keepAlive) → `SocialRepository.fetchProfile` — TTL cache (10 min) → default relays → NIP-65 write relays → indexers, falls back to stale cache.
- Edit: `edit_profile_screen.dart` picks image (`maxWidth/Height 2048/1024, quality 85`) → `uploadProvider` → URL into kind-0. Quick-update camera overlays (`profile_screen.dart:55-141`) do the same then publish immediately.

### Issues (ranked)
1. **CRITICAL — banner decodes full-res.** `profile_screen.dart:407-414` passes no `width`/`height` → `SmartNetworkImage` computes `memCacheWidth/Height = null` → `CachedNetworkImage` decodes native bitmap. Also **no `MediaUtils.optimizedImageUrl`(?w=1200)** — that CDN resize is only applied to feed tiles (`note_content.dart:1415`). The "Display-size decode (ADR-0004)" comment is false.
   **Fix:** `SmartNetworkImage(url: MediaUtils.optimizedImageUrl(profile.banner!, width:1200), width: MediaQuery.sizeOf(context).width, height: 200, …)`.
2. **MAJOR — failed banner is a permanent dead-gray box** (no tap-to-retry / fallback walk like feed `_NetworkImageTile`).
   **Fix:** give banner the same evict-and-retry pattern; key on URL.
3. **MAJOR — `_quickUpdateImage` publishes kind-0 from possibly-stale `auth.profile`** (`profile_screen.dart:98-104`), silently reverting other fields edited elsewhere (last-writer-wins).
   **Fix:** refetch kind-0 / merge into cached latest before publishing the quick image update.
4. **MINOR — NIP-05 ✓ badge shown with no actual `/.well-known` verification** (`profile_screen.dart:675-683`). Anyone can paste a nip05 and look verified.
5. **MINOR — compose avatar uses raw `NetworkImage`** (`compose_screen.dart:371-373`) — no `kImageHttpHeaders` (the Android-403 class the codebase bans), no cache, no memCache.
6. **MINOR — banner URL not trimmed/validated** before render (`profile_screen.dart:406`).

---

## B. UPLOAD FLOW

### How it works
`UploadService.uploadBytes` (`features/compose/data/upload_service.dart:42-117`): login check → sha256 of full bytes → sign BUD-02 kind-**24242** auth (`t=upload`, `x=<hash>`, 5-min expiration) → `PUT {server}/upload` for each of `Env.blossomServers` (default blossom.band / blossom.primal.net / nostr.build) with **60 s timeout** → first 2xx wins, parse `{url}`.

Call sites: compose image (1920/q85), profile avatar/banner, chat image (2048/q85), reel video (`reel_uploader.dart:63-139`), article cover.

### Issues (ranked)
1. **CRITICAL — reel video read fully into memory.** `reel_uploader.dart:94` `await _video!.readAsBytes()` then `bodyBytes = bytes` (non-streamed). No size/duration cap → a 500 MB clip = ~1 GB RAM (twice) → **OOM kill**. Also **no video compression/transcode** at all.
   **Fix:** cap size/duration at pick; stream the request (`StreamedRequest` from file path); consider `video_compress`.
2. **CRITICAL — no `imeta` (NIP-92) on posted images.** Compose appends bare URLs (`compose_screen.dart:131-148`); the sha256 is computed then **thrown away** — no `dim`, `blurhash`, `x`, or fallback. Feed tiles can't reserve aspect ratio → layout jump; BUD-03 re-host can't verify. Reels write imeta but omit `dim`/`blurhash`/`x` too.
   **Fix:** `uploadImage` returns `{url, sha256, size, mime, dim}`; write an `imeta` tag per URL; probe dimensions before upload.
3. **MAJOR — fixed 60 s timeout, one attempt per server, no retry/backoff.** Big file on slow uplink always fails; worst case ~3 min of spinner across 3 servers.
4. **MAJOR — no upload progress and no cancellation.** `UploadState` is only `{isUploading, error}` — users stare at an indeterminate spinner; leaving the screen keeps the request alive.
5. **MAJOR — returned URL not verified** against the local sha256 (a misbehaving server could swap content).
6. **MINOR —** filename leaks in signed auth content; MIME sniffed from extension only (extensionless → octet-stream → may not render inline); article editor pick lacks `imageQuality`; three ad-hoc `UploadService` constructions bypass the shared provider; 429 not backed off.

---

## C. FEED / REPLY / SCROLL

### How it works (the good parts — already correct)
- Offline-first SQLite `EventStore` (events / event_refs / profiles), `INSERT OR REPLACE`, `prune()` bounded.
- Batched warming: one batched profile prefetch + one batched engagement fetch per page (`_warmPage`, `_syncEngagement`) → counts come from local SQL, not per-card relay queries.
- Memoized per-event: `_NoteParseCache`, `_RepostCache`, `_TimeAgoCache`, `_VerdictCache` (LRU 400).
- Merge never re-orders; future-timestamp clamp; `refresh`/`loadMore` serialized; 15 s hung-fetch timeout; live tail counts into "N new posts" pill (never auto-splices).
- Videos in feed are static thumbnails (no controller per feed item) — correct.

### Issues (ranked)

**1. CRITICAL — `state.events` unbounded (the #1 "stuck after a while" cause).**
`feed_notifier.dart` `_merge` (459-489) appends every page forever. `loadMore` uses `state.events.last.createdAt` as the `until` cursor, so you cannot simply drop the tail without moving the cursor. Fix needs a **windowed list + separate cursor**:
```dart
static const _maxInMemory = 300; // ~6 pages
// keep a separate `_oldestCursorTs` for pagination so the tail can be dropped
if (merged.length > _maxInMemory) merged = merged.sublist(0, _maxInMemory);
```
Also `_merge` is O(n·m) (linear insert scan per new event) and rebuilds `existingIds` per call — use binary-search insertion and cache `_orderTs`.

**2. CRITICAL — thread replies render ALL in a `Column` inside a `ListView`** (`thread_screen.dart:184-188`). A 200-reply thread builds 200 PostCards eagerly = 1200 AnimationControllers → freeze on opening a popular thread.
**Fix:** `ListView.builder` for replies (or `SliverList` with `itemExtent` estimate / `super_sliver_list`).

**3. CRITICAL — banner full-res decode** (see A1) — same memory problem, also hits profile scroll.

**4. MAJOR — Schnorr verify on UI isolate.** Move `event.isValid` to `Isolate.run`/`compute` in `RelayConnection._handleMessage`, or batch-verify.

**5. MAJOR — 6 AnimationControllers per card.** Replace `_ActionButton`'s `AnimationController` with an implicit `TweenAnimationBuilder`/`AnimatedScale` (fire-and-forget), or share one controller per card.

**6. MAJOR — no image-cache limits.** In `main()`:
```dart
PaintingBinding.instance.imageCache.maximumSize = 300;
PaintingBinding.instance.imageCache.maximumSizeBytes = 48 << 20; // 48 MB
```

**7. MAJOR — no optimistic reply insert** (`thread_screen.dart:74-78`). After publishing, the reply only appears after a relay round-trip (2-8 s) → users double-post. **Fix:** optimistically add to the reply list + `EventStore.ingest([replyEvent])` so the count updates immediately.

**8. MAJOR — live-tail `_pending` grows unbounded + O(n) dedup per event** (`feed_notifier.dart:405-406`). Use a `LinkedHashSet`/`Set` for dedup and cap `_pending` at ~100 (drop oldest).

**9. MAJOR — `profileCache` unbounded** (`nostr_service.dart:48-49`, plain Map, never evicted). Add LRU cap ~500.

**10. MINOR —** social-notification listener invalidates providers on every event (debounce 2 s); both feed notifiers refresh on every resume even when the tab is never viewed; `DmStore` maps unbounded (cap ~1000); `_parentEventProvider` not autoDispose.

---

## D. How top Nostr clients do it (from the research digest)

| Technique | Who | Takeaway for NostrFeed |
|-----------|-----|------------------------|
| Visible-notes-driven **batched REQs** (one kind:0 + one engagement REQ per page), token-bucket rate limit, ref-counted sub dedup | Amethyst | Already mostly done via `_warmPage`/`_syncEngagement` — keep |
| `bufferTime+batch` REQ merge, `tie/uniq/latestEach`, Forward(live)/Backward(until) strategies, lazy since on reconnect | rx-nostr | Adopt: close page subs on EOSE, re-evaluate `since` on reconnect |
| Pre-compute engagement into the store, not at render | Primal | Store an `engagement` table refreshed on ingest → render = dumb SELECT |
| Local-relay model: UI only queries the validated local DB | Damus/nostrdb | Already the direction — push further (intern events, projections) |
| **Prefetch ±5 items ahead off the UI thread** (pre-parse text, precache images, reserve aspect-ratio box) — measured zero main-thread cost | Amethyst PR #3325 | **Biggest smooth-scroll win to add** — `precacheImage` + content-addressed parse cache + reserve image boxes from imeta `dim` |
| Windowing / NIP-40 sweep — cap in-memory feed, periodic DELETE of old events | Amethyst/quartz, Twitter | Matches fix C1 |
| Decode at display size, bound image cache, `super_sliver_list` for variable heights | Flutter | Matches fixes C3/C6 |
| Foreground-only websockets + periodic WorkManager sync (Doze kills 24/7 sockets; ~5%/hr drain on 4G) | Android/ntfy | Keep sockets foreground; background = periodic sync + local notifs |

Full citations in `docs/FEED_SCROLL_ARCHITECTURE_DIGEST.md` (14-item checklist at the end).

---

## Recommended fix order (highest ROI first)

1. **C6** image-cache limits (2 lines in `main()`).
2. **A1/C3** banner display-size decode + CDN resize (one widget call).
3. **C1** cap in-memory feed window (needs a separate pagination cursor).
4. **C5** remove per-button AnimationControllers.
5. **C2** thread replies → `ListView.builder`.
6. **B1** reel video: size cap + streamed upload (OOM).
7. **C4** signature verify → isolate.
8. **B2** write `imeta` (dim/blurhash/sha256) on upload → enables aspect-ratio reservation = no layout jump.
9. **C7** optimistic reply insert.
10. **Amethyst-style prefetch** (precacheImage + parse-ahead) for butter scroll.

Each is independently shippable. 1–5 are small and directly attack the "stuck" symptom.

---

## ✅ IMPLEMENTED — Phase 1 (2026-10-25)

All five quick wins landed, `flutter analyze` = 0 issues, `flutter test` = 437 passed:

| # | Fix | File | What changed |
|---|-----|------|--------------|
| 1 | Image-cache caps | `main.dart` | `imageCache.maximumSize = 300`, `maximumSizeBytes = 48 MB` (was 1000 / 100 MB default) |
| 2 | Banner display-size decode | `profile_screen.dart` | `MediaUtils.optimizedImageUrl(?w=1200)` + `width/height` → memCache; `_hasBanner` validates/trims URL; keyed on URL (stale-pixel guard) |
| 3 | No per-card AnimationControllers | `post_card.dart` | `_ActionButton` → stateless + `_PopIcon` (implicit `TweenAnimationBuilder`, no dedicated vsync ticker) — kills ~90 live tickers/screen |
| 4 | Lazy thread rendering | `thread_screen.dart` | eager `Column` → `ListView.builder` (header + lazy replies) — fixes 200-reply freeze |
| 5 | Feed window cap + binary merge | `feed_notifier.dart` | `_maxInMemoryEvents = 400` (drop from top, keep tail so `loadMore` cursor works); O(n·m)→O(m log n) binary-search insert |

**Deferred (Phase 2+):** signature-verify → isolate (C4), reel streaming upload + imeta (B1/B2), optimistic reply insert (C7), sqflite-backed feed paging (R1), scroll-driven image prefetch (R7), live-tail `_pending` cap (C8), profileCache LRU (C9).

---

## ✅ IMPLEMENTED — Phase 2 (2026-10-25)

`flutter analyze` = 0 issues, `flutter test` = 441 passed (4 new upload tests):

| # | Fix | Files | What changed |
|---|-----|-------|--------------|
| 6 | **Optimistic replies** (C7) | `event_store.dart`, `content_providers.dart`, `thread_screen.dart` | New `EventStore.repliesFor` (engagement-index join); `repliesProvider` now **store-first** (instant) + relay backfill; `_postReply` ingests the signed reply before the round-trip → it renders immediately, killing double-post |
| 7 | **Streaming upload + imeta** (B1/B2) | `upload_service.dart` (rewrite), `upload_providers.dart`, `compose_screen.dart`, `reel_uploader.dart`, `nostr_service.dart` | Two-pass streamed upload (hash pass → streamed PUT) — **videos no longer `readAsBytes`** (OOM fix); new `UploadResult{url,sha256,size,mime}`; compose writes NIP-92 `imeta` per image; `createVideoEvent` + reel imeta now carry `x`/`size`; magic-byte MIME sniffing; server-sha256 verification (anti content-swap); 429/5xx backoff + 1 retry; size-scaled timeout (45s→10min) |

**Key decisions:**
- **C4 (sig-verify → isolate) DEFERRED**: per-event `Isolate.run` spawn (~1ms) costs more than the ~100µs verify and `_handleMessage` is synchronous — making it async risks reordering + flooding during catch-up. Only worth it for the **engagement batch** (large `limit` one-shot queries); needs profiling first. See note below.
- **Upload API is back-compatible**: `uploadImage`/`uploadBytes` still return `String` (URL) — the 10 existing call sites (profile, chat, communities, articles, groups, live, market) work unchanged. New `*Detailed`/`uploadFile` methods return `UploadResult` for imeta. Only compose + reels opted in.

**Remaining (Phase 3):** C4 (batched sig-verify, pending profile), R1 (sqflite-backed feed paging — the biggest refactor), R7 (scroll-driven image prefetch), C8 (live-tail `_pending` cap), C9 (profileCache LRU), upload progress UI + cancel.

---

## ✅ IMPLEMENTED — Phase 3 (2026-10-25)

`flutter analyze` = 0 issues, `flutter test` = 447 passed:

| # | Fix | Files | What changed |
|---|-----|-------|--------------|
| 8 | **Scroll-driven image prefetch** (R7) | `feed_screen.dart`, `note_content.dart` | Debounced (150 ms, ~5-item move) prefetch of the next 6 items' images via `precacheImage`, warming the EXACT resized URL the feed tile requests (cache-key match) → images decode off-screen instead of mid-frame during flings. `NoteParseCache` made public + `imagesFor`/`feedTileUrl` exposed. |
| 9 | **Live-tail `_pending` cap + O(1) dedup** (C8) | `feed_notifier.dart` | `_pendingIds` Set replaces the O(n) `.any()` scan per live event; buffer capped at 100 (drop-oldest) — was unbounded with a `[..._pending, event]` full-list copy per arrival. |
| 10 | **profileCache LRU cap** (C9) | new `core/nostr/profile_cache.dart`, `nostr_service.dart`, `social_repository.dart`, `auth_providers.dart` | `cacheProfileBounded` extension (1500-entry cap, insertion-order LRU) at all 4 write sites — the map previously grew by every prefetched author forever. |

**Remaining:** C4 (batched sig-verify — pending a device profile), R1 (sqflite-backed feed paging — the biggest refactor, the true endgame for bounded feed memory), upload progress UI + cancel.

---

## 🐛 USER-REPORTED REGRESSIONS FIXED (2026-10-25)

**Trending chips identical (P4 correction):** `trendingProvider` local-first meant every window ranked the same already-seen set. Fixed → STREAM: local instant paint, relay per-window truth (see ADR-0005 "P4 correction").

**For You / Following tab data (3 bugs from the P4 `_init` change):**
1. **Following tab blocked on network before disk paint** — `_init` awaited `_resolveFollows()` (relay fetch) before the store read; slow relays = hung skeleton, offline = dead tab (threw). Fixed: disk paint never awaits network; follows resolve in parallel.
2. **Empty follows leaked GLOBAL content into Following** — `feedPage(authors: [])` treats empty as unfiltered (SQL `authors.isNotEmpty` guard). Fixed: empty follows = explicit EMPTY feed + refresh-triggered fill; legacy migration applies the same author filter; `_refreshInner` backfills from the store once follows resolve.
3. Store contract pinned by tests: `authors: []` = unfiltered at the DB layer; the feed layer guards empty-vs-null.
4 regression tests (`following_feed_test.dart`).

---

## 🏛 ARCHITECTURE DECISION — ADR-0005 (2026-10-25)

The R1 "feed paging" item has been subsumed by a bigger decision: a **unified event pipeline** (relays → dispatch → typed processors → store → projections), the Damus/Gossip/Amethyst local-relay model. See [`ADR-0005-event-pipeline.md`](ADR-0005-event-pipeline.md): feed/following/explore/trending become **SQL projections over the store** (trending 24h/7d = a WHERE clause, not a refetch), subscriptions become reference-counted specs, and background = opt-in Android foreground service (DM/inbox only) + WorkManager catch-up. Phased P1–P6; R1 = phase P4.
