# Performance Audit — Android Loading, Jank & Data Sync

**Date:** 2026-10-26 · **Scope:** Android loading delays, scroll jank, per-card queries, renderer choice.

## Fixes shipped

| # | Issue | Root cause | Fix |
|---|---|---|---|
| 1 | Android renderer slow/janky | `EnableImpeller=false` (Skia pinned for a 2024 engine) forced the legacy renderer | `EnableImpeller=true` — Impeller on Vulkan is default + mature on Flutter 3.47 (shaders pre-compile AOT, first-scroll jank gone) |
| 2 | Zap sats didn't show / extra relay load | `zapReceiptsProvider` fired ONE relay query per zapped post card | New store-backed `_localZapReceiptsProvider` → `EventStore.receiptsFor(targetId)` (kind 9735 from `event_refs`) — sats total is a local SQL read, recomputes on the engagement tick |

## Verified already-good (no change needed)

| Area | State |
|---|---|
| Feed list | `ListView.builder` lazy, stable keys, window cap (direction-aware), scrollCacheExtent 800 |
| Images | `memCacheWidth` only (never W+H), CDN resize (`?w=1080`), Android 96MB cache + largeHeap, UA headers |
| Chat thread | Reversed lazy `ListView.builder`, WhatsApp grouping, date separators, decrypt off-isolate (DmCryptoWorker) |
| Counts | Local SQL `event_refs` grouped count (no per-card relay queries) |
| Feed verify/parse | Off-isolate (RelayFrameProcessor, 2-4 workers) + backpressure |
| Optimistic updates | like/repost/bookmark/comment/post ingest into store (instant recount) |
| Connection | Hub relay (backend sync), good-enough EOSE, one-shot subs, 2000 max subs |

## The remaining per-card provider list (intentional, cheap)

`PostCard` watches ~10 providers — all **local/TTL-cached**, none a fresh relay query after this audit:
`profileProvider` (keepAlive TTL), `localEngagementProvider` (SQL), `userInteractionsProvider` (local), `followsProvider`/`bookmarkedIdsProvider` (keepAlive), `authStateProvider`, `sensitiveModeProvider`, `_localZapReceiptsProvider` (SQL), `repostTargetProvider` (store-first, only for reposts).

## Rules going forward

1. **Impeller stays ON** (`EnableImpeller=true`) — never re-pin Skia without a fresh A/B on the current engine.
2. **No per-card relay queries** — counts, sats, repost targets all read the local store (`event_refs`/`events` tables). A new per-card relay read is a feed-perf bug by definition.
3. **Image decode is width-only** (`memCacheWidth`), never W+H (the Android banner bug).
