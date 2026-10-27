# Smoothness Audit — Cold Start, Warm Start & the "Real App" Feel (2026-10-27)

**Reported:** app opens to "no posts" for a while, then fills — doesn't feel like
Insta/FB/Primal. Data flow not smooth, mostly on Android.

## The root cause (fixed)

`FeedState` started with `isRefreshing: false`. Frame one after `build()`
therefore evaluated `events.isEmpty && !isRefreshing` → the **"No posts" empty
state flashed** for the 1–2s the disk read + refresh took. Real apps open to
**cached content or a skeleton**, never an empty state.

**Fix:** `isRefreshing: true` by default — frame one is the skeleton, which
cross-fades into the cached content (returning user) or the fetched page
(fresh install). The empty state now only shows AFTER a completed refresh
returned empty.

## The full flow (verified correct)

| Phase | Path | Feel |
|---|---|---|
| **Cold open (fresh install)** | skeleton → relay page (fast hub) → content | one skeleton beat, then posts |
| **Warm open (returning user)** | disk read (SQLite, WAL) → cached posts **instantly** → silent refresh behind | instant cached content |
| **Refresh** | newest page merges silently (binary-search insert, NO re-order, stable `ValueKey`s) → engagement warm in background | no jump, no flicker |
| **Scroll** | lazy `ListView.builder`, 800px cache extent, image prefetch, window cap (direction-aware) | smooth |
| **Pagination** | `until` cursor, store-first backfill | infinite scroll |
| **Live** | EventBus tail → "N new posts" pill (never auto-inserts) | no yank |
| **Interactions** | like/repost/comment/post ingest into store → SQL count updates instantly | instant |

## Android specifics (all handled)

- **Renderer** — `EnableImpeller=true` (Vulkan; the old Skia pin forced the
  slow legacy renderer on modern devices).
- **Image cache** — 96 MB + `largeHeap`, `memCacheWidth` only (never W+H),
  CDN resize (`?w=1080`), browser UA headers.
- **DB** — WAL mode (readers don't block the writer), `synchronous=NORMAL`,
  `busy_timeout`, bounded (3000 events / 24 MB) so it never fills storage.
- **Frame work** — relay parse + Schnorr verify off the UI isolate
  (RelayFrameProcessor, 2–4 workers) + backpressure.
- **Chat** — DM decrypt off-isolate (DmCryptoWorker), reversed lazy list.

## The rules going forward

1. **Never open to an empty state** — first frame is skeleton or cached
   content. `isRefreshing` starts true so the empty state is only reachable
   after a completed empty refresh.
2. **Disk first, network behind** — `feedPage` (SQLite) paints, refresh merges
   silently. Never block the first paint on a relay round trip.
3. **Merges never re-order** — binary-search insert + stable keys; a refresh
   never makes the post the user is reading jump.
