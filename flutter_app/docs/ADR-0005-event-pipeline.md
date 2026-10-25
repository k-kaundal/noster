# ADR-0005: Unified Event Pipeline (Relays → Dispatch → Processors → Store → Projections)

**Status:** Accepted (design). Implementation phased below.
**Date:** 2026-10-25
**Supersedes:** the ad-hoc per-feature subscription model.
**Research:** `docs/FEED_SCROLL_ARCHITECTURE_DIGEST.md`, `docs/primal-android-research-digest.md`, and the pipeline research digest (Damus #2041, Gossip `process_new_event`, Amethyst/quartz, rx-nostr).

---

## 1. Context

Every feature currently opens its own raw relay subscription and keeps its
own copy of the data:

| Subscription | Filter | Consumer | Data kept |
|---|---|---|---|
| Global feed live tail | kinds 1,6,16,20,30023 since now | `FeedNotifier._startLive` | in-memory list (≤400) |
| Following feed live tail | same kinds, authors=follows | `FeedNotifier._startLive` | in-memory list (≤400) |
| Social notifications | kinds 1,3,6,7,16,1111,9735 `#p`=me | `liveSocialEventsProvider` | store + banner |
| DMs | kinds 4,1059 `#p`=me | `dmLiveEventsProvider` | DmStore + banner |
| Engagement sync | one-shot batch `#e`=page ids | `FeedNotifier._syncEngagement` | SQLite event_refs |

Consequences:
- **No single ingest path** — the same kind-1 reply arriving on 2 relays is
  processed (and sig-verified) once per subscription, not once total.
- **Filtering is scattered** — the flood filter only runs inside
  FeedNotifier; a flood event reaching the store via another path is never
  judged.
- **The feed lives in memory** — bounded at 400 after ADR-0004 work, but
  still the "source" for the UI instead of the store.
- **Trending/explore can't be local** — there is no engagement relationship
  data queryable by time window, so trending is a relay fetch, not a query.
- **No lifecycle discipline** — subscriptions die/duplicate on reconnects
  and tab switches; background = nothing structured.

## 2. Decision

Adopt the **local-relay model** (Damus): the UI queries only the local
validated store; relays are untrusted ingest sources feeding ONE pipeline.

```
┌────────────────────────────────────────────────────────────────┐
│ L1 TRANSPORT — RelayPool (EXISTS, keep)                        │
│   one socket per relay, reconnect + backoff, resubscribe,      │
│   sig-verify AT THE BOUNDARY (already done), NIP-42 auth.      │
│   + NEW: SubscriptionRegistry — declarative specs keyed by     │
│     filter-set, reference-counted, last-leaver closes.         │
└───────────────────────────────┬────────────────────────────────┘
                                 ▼ verified NostrEvent
┌────────────────────────────────────────────────────────────────┐
│ L2 DISPATCH — EventBus (NEW, ~200 LOC)                         │
│   ONE broadcast stream of all events from all subscriptions.   │
│   Cheap-first gates (Gossip order):                            │
│     dedup by id (LRU set) → kind classify → route to           │
│     registered processors. Everything else drops HERE.         │
└───────────────────────────────┬────────────────────────────────┘
                                 ▼ typed envelope
┌────────────────────────────────────────────────────────────────┐
│ L3 PROCESSORS — Map<kind-group, processor> (NEW, mostly MOVES) │
│   • feedPost (1,20): flood filter → drop or pass               │
│   • threads (1): NIP-10 parse at ingest → thread_edges rows    │
│   • engagement (6,7,16,9735,1111): zap parse → event_refs      │
│   • profiles (0,3,10002): replaceable-latest reduction         │
│   • DMs (4,1059): decrypt (existing) → DmStore                 │
│   • social (#p=me kinds): notification detect (existing)       │
└───────────────────────────────┬────────────────────────────────┘
                                 ▼
┌────────────────────────────────────────────────────────────────┐
│ L4 STORE — EventStore (EXISTS, extend)                         │
│   tables now: events, event_refs, profiles                     │
│   + thread_edges(root_id, reply_id)   (instant thread opens)   │
│   + seen_on(event_id, relay_url)      (relay hints, dedup)     │
│   writes: SAME path for relay + local publish (optimistic =    │
│   insert + version bump — the Phase-2 optimistic replies way)  │
│   change bus: per-domain version counters (exist:              │
│   engagementVersionProvider; add feedVersion, threadVersion)   │
└───────────────────────────────┬────────────────────────────────┘
                                 ▼ SQL + version ticks
┌────────────────────────────────────────────────────────────────┐
│ L5 PROJECTIONS — Riverpod; UI reads ONLY the store             │
│   feed / following / explore = filtered SQL over events,       │
│     re-run on version ticks (store-first, relay backfill)      │
│   trending(24h|7d) = GROUP BY event_refs WHERE created_at>=:t  │
│     — a QUERY over stored engagement, never a refetch          │
│   thread = repliesFor(root) via thread_edges (exists, Phase 2) │
│   subscription lifetime bound to projection: autoDispose +     │
│     registry.release() after 5–30 s grace (WhileSubscribed)    │
└────────────────────────────────────────────────────────────────┘
```

### Vice versa (publish path)
User action → create/sign event → **insert into the store immediately**
(optimistic, the Phase-2 reply pattern) → publish to relays → version tick
→ every projection (feed, thread, counts) updates from the store. No
hand-managed UI lists.

## 3. Layer-by-layer migration map

**L1 (mostly exists).** Keep `RelayPool`. Add `SubscriptionRegistry`:
`acquire(SubscriptionSpec)` returns a shared stream; identical filters from
feed + thread + notifications collapse into ONE REQ per relay; released on
last leaver (autoDispose + 5 s grace for tab switches — Amethyst's
`WhileSubscribed(5000)` / 30 s lifecycle equivalents).

**L2 (new, small).** `EventBus`: a `StreamController<NostrEvent>.broadcast()`
fed by the registry's merged streams. Processors subscribe with
`.where((e) => kinds.contains(e.kind))`. Dedup: LRU id set (10k) in the bus
so a cross-relay duplicate is processed once (today it's processed per
subscription).

**L3 (mostly moves).** Move `FloodDetector` invocation out of FeedNotifier
into a `FeedPostProcessor` (runs for EVERY kind-1 entering the store, not
just feed-fetched ones). Thread-edge extraction: on kind-1 ingest, write
`(rootId ?? replyToId, id)` into `thread_edges`. DM/notification processors
stay where they are but subscribe to the bus instead of owning subs.

**L4 (extend).** Two new tables (`thread_edges`, `seen_on`), DB version
bump + `_onUpgrade`. Store-first projections already proven by Phase-2
`repliesProvider`. NIP-40-style sweep: extend `prune()` (exists).

**L5 (the payoff).**
- `feedProvider`: `SELECT … FROM events WHERE kind IN (…) AND NOT is_reply
  ORDER BY created_at DESC LIMIT :page OFFSET :page*n` — the feed becomes a
  paged SQL read; `FeedNotifier` shrinks to a fetcher/warmer.
- `trendingProvider(window)`: `SELECT target_id, COUNT(*) w, SUM(CASE WHEN
  kind=9735 THEN … END) FROM event_refs WHERE created_at >= :since GROUP BY
  target_id` — **24 h vs 7 d is a WHERE clause, not a refetch.** (Anti-
  manipulation weighting — unique engagers, zaps 1.5× — already exists in
  `features/explore/domain/feed_ranking.dart` and applies on top.)
- Projections re-run on version ticks; subscription lifetime = projection
  lifetime via the registry.

## 4. Background listeners (the "proper websockets in background" ask)

Realistic per-platform answer (research-backed):

- **Foreground (always):** full pipeline runs; subscriptions lifecycle-bound.
- **Android background (OPT-IN, default OFF):** `flutter_background_service`
  foreground service (persistent low-importance notification, Amethyst's
  `NotificationRelayService` model) keeping ONLY the DM/notification
  `#p`=me subscriptions alive; feed subs pause. Battery: ~0–1 %/day wifi
  idle, up to several %/hour cellular → websocket ping 240 s cellular /
  120 s wifi (Amethyst's measured values), no `_WAKEUP` alarms.
  Backstops: boot receiver + WorkManager 15-min catch-up + the existing
  `flutter_local_notifications` for alerts.
- **iOS:** no persistent sockets exist (OS kills them). BGTaskScheduler via
  `workmanager` (≥15-min cadence, 15–30 s runtime) for catch-up; real push
  needs a relay→APNS bridge (Damus's notepush model) — later phase, own ADR.

## 5. Phasing (each independently shippable, tests green at every step)

| Phase | Scope | Risk |
|---|---|---|
| **P0** ✅ done | bounded lists/caches, store-first replies, optimistic insert (ADR-0004 work) | — |
| **P1** ✅ done 2026-10-25 | L4 schema: `thread_edges` + `seen_on` + DB v1→v2 migration + write-at-ingest + buffered `markSeenOn` from the relay layer + `threadReplies`/`seenOnRelays` reads. 4 migration tests (sqflite_common_ffi in-memory, `source: process` hook for offline). | low |
| **P2** ✅ done 2026-10-25 | L2 EventBus + L1 spec registry: `core/nostr/event_bus.dart` (ref-counted REQ dedup by canonical filter JSON, cross-spec event dedup 10k LRU, local `matchesEvent` filtering). Migrated onto the bus: social notifications (`liveSocialEventsProvider`), DMs (`dmLiveEventsProvider`), and BOTH feed live tails (`FeedNotifier._startLive`). Provider: `eventBusProvider` (app-lifetime). 9 bus unit tests. | medium |
| **P3** ✅ done 2026-10-25 | L3 processors + unified ingest: `EventBus.addGate` (L3 gate chain — flood judgment moved out of FeedNotifier into the bus: standalone kind-1 floods drop once for every consumer; replies + other kinds pass). New `ingestPipelineProvider` (core) — every gated bus event → `EventStore.ingest` exactly once (DM kinds skipped, owned by DmStore); engagement kinds bump `engagementVersionProvider` debounced 500 ms (counts now update LIVE, not just on page fetches). `engagementVersionProvider`/`localEngagementProvider`/`floodDetectorProvider` moved to core (pipeline is core, not feed feature). FeedNotifier live tail shrank to just the pill. **BUG FOUND+FIXED:** `EventStore.db` async-singleton race (concurrent first-access opened 2 DBs, first write orphaned+lost) — now a shared `_opening` future. 4 pipeline tests. | medium |
| **P4** ✅ done 2026-10-25 | L5 projections land: `EventStore.feedPage` (SQL reply-exclusion via `NOT EXISTS thread_edges` + keyset `until` paging + future-clamp `MIN(created_at, :cap)` ordering + authors filter) — cold paths (`_init`, and the projection is ready for full paging) read the store as source of truth. `EventStore.trendingCandidates` (deduped window engagement: engagers/reactions/reposts/replies/zaps via GROUP BY) + `eventsById`. **`trendingProvider` is now local-first** — the 1h/24h/7d chips are a WHERE clause, not a refetch (relay fallback when the local window is thin). Feed refresh-merge semantics deliberately kept (no scroll-jump regression); full Paging-3-style windowing remains future work (memory already bounded at 400 in P0). 5 projection tests incl. the 1h⊂24h "vice versa" proof. | high (the big one) |
| **P5** 🟡 partial 2026-10-25 | `BackgroundSyncService` (core/services/background_sync.dart) — the periodic catch-up (reconnect + feed-tail restart + wallet resync + DM gap-fill) extracted from `app.dart`'s resume path into ONE testable unit with TWO callers: resume (wired today) and a periodic scheduler (seam ready). `backgroundSyncEnabledProvider` (AsyncNotifier, SharedPreferences, default ON) + Settings → "Background catch-up" toggle. **BLOCKED:** `workmanager`/`flutter_background_service` are not in the offline pub cache (pub.dev unreachable) — the OS-task registration is a documented ~20-line addition in `registerPeriodicSync` (exact code in the service doc) once the package is fetchable. 3 service tests. iOS: same seam maps to BGTaskScheduler. | medium |
| **P6** | push-relay bridge (notepush-style) for true background push — own ADR | high |

**P1 notes:** schema is IF-NOT-EXISTS idempotent (re-runnable migration); `_backfillThreadEdges` links pre-v2 replies; `seen_on` writes are buffered (2 s / 200-entry flush) so the relay layer never does per-frame I/O; prune drops `seen_on`/`thread_edges` with their events. Test infra: `EventStore.debugOpenOverride`/`debugReset`/`debugFlushSeenOn` + `sqflite_common_ffi` (dev dep, `source: process` — production APK build verified unaffected).

**P4 correction (user-reported, 2026-10-25):** the first cut made `trendingProvider` local-FIRST — but Trending is a discovery surface and the local store only knows already-scrolled posts, so every time chip ranked the same set ("1h/24h/7d all show the same data"). Fixed: `trendingProvider` is now a STREAM — local engagement-window query yields instantly (offline fallback), then the relay fetch per window yields the real discovery list (1h ≠ 24h ≠ 7d again), ingested back into the store. Local remains the instant paint + offline path it was designed for; the network remains the discovery truth.

## 6. Consequences

**Good:** one ingest path (dedup/verify once), filtering in exactly one
place, trending/explore become local queries (instant, offline), feed
memory bounded by the DB not by discipline, background delivery structured,
and the "vice versa" (filters as queries) falls out for free.

**Costs:** L4 migration; L5 feed rewrite is the only deep change (P4) — it
is deliberately LAST so P1–P3 de-risk it. All intermediate states are
coherent: the pipeline and the old consumers can coexist during migration
(projections go store-first one at a time).

**Rejected alternatives:**
- *Per-feature pipelines* (status quo) — the sprawl we're fixing.
- *Primal-style cache server* — we don't operate one; the local store is
  our cache server. (If we ever do, L5 projections swap SQL for cache-verbs
  with no UI change — the architecture already isolates them.)
- *Persistent socket on iOS* — impossible; rejected by the OS, not by us.

---

## ✅ C4 + DEVICE HOTFIX (2026-10-25)

**C4 (sig-verify cost) — solved the SAFE way:** instead of isolates (spawn cost > verify cost, plus event-reordering risk), added a **cross-relay verify dedup** in `RelayPool`: the same event arrives on every connected relay (50 posts × 9 relays ≈ 450 Schnorr verifies for 50 unique events), so a bounded 5k LRU `_verifiedIds` skips crypto on every copy after the first — up to ~90% of verify cost gone, zero reordering, zero isolate risk. `RelayConnection`s take an optional `verifiedMarker`; ad-hoc standalone connections keep verify-everything. 3 tests.

**Device hotfix (`unable to open database file` on `seen_on` insert, Darwin/hot-restart):**
1. **`EventStore.db` no longer caches a FAILED open** — one transient open error used to poison every later access forever (death spiral); now the failure clears `_opening` so the next access retries a fresh open.
2. **`_flushSeenOn` is failure-safe** — provenance is best-effort; a DB hiccup (locked file at hot-restart, mid-migration) drops the sightings instead of throwing unhandled through the relay pipeline (the crash-spam in the device logs).
3. **`_onUpgrade` backfill hardened** — a malformed legacy row can't brick the whole migration.

---

## ✅ LATENCY PASS (2026-10-25) — caches + concurrency + store-first

The scroll/memory work made the app smooth; this pass attacked **time-to-content**
(the "explore is slow" / "still stuck on multiple screens" reports). Rules
established (see `PERFORMANCE-ANALYSIS.md`):

- **Persistent profile cache (the big one).** The store's `profiles` table was
  WRITTEN but never READ — every cold start re-fetched every avatar/banner.
  `fetchProfile` is now read-through: memory LRU → SQLite → relays, with
  **stale-while-revalidate** (a stale stored profile renders NOW, relay refresh
  behind) and **write-through** on every fetch/prefetch (memory + SQLite).
  Cold-start avatar storm is gone across ALL screens.
- **Per-card interaction queries → local index.** Every PostCard used to fire
  its own `fetchUserInteractions` relay query for like/repost state. Now
  `userInteractionsProvider` reads `EventStore.userInteractionsFor` (grouped
  SQL on `event_refs`), relay only as a pre-pipeline fallback.
- **Browse screens never autoDispose network data.** Trending, hashtags,
  notifications, communities, articles, bookmarks are keepAlive + TTL via
  `AsyncNotifier` (state-reset on invalidate = forced refetch still works).
- **Never a serial relay waterfall.** Profile legs race concurrently
  (`_firstNonEmpty`); payloads sized for the UI (hashtags 500→250, trending
  250→150, engagement batch 8s→5s).

**Post-pass regressions fixed:** pull-to-refresh folds the pill in first;
notification taps render the freshest root event (`_freshRootProvider`);
empty hashtag results are NOT TTL-cached (retry on next visit).
