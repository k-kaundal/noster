# ADR-0007: In-App Local Relay — Deep Research & Design

Status: **research (2026-10-25)** — supersedes the notes in
`docs/IN_APP_RELAY_CACHE_RESEARCH.md`. Security model + background-process
constraints live in `docs/LOCAL_RELAY_SECURITY_BACKGROUND.md` (its six
decisions are normative for phases 3–5 below: token-auth ws server,
Android-15-compliant FGS, keyless relay isolate, privacy-broadened upstream
syncs).

Question answered here: how do we run a **real Nostr relay inside the
Flutter app** (background, low memory) so NostrFeed no longer depends on a
Primal-style central cache — and what is the **correct event model + filter
engine** (the current one is partial)?

Everything below is verified against primary sources:

| Source | What it gave us |
|---|---|
| **NIP-01** (`nips/01.md`) | Event wire format, id/signature rules, tag indexing contract, kind ranges, filter semantics (`&&` inside a filter, `||` across filters, `limit:0` semantics, empty-list = match nothing), relay→client messages (`OK`/`EOSE`/`CLOSED`/`NOTICE` + machine-readable prefixes). |
| **NIP-77** (`nips/77.md`) | Negentropy set-reconciliation: `NEG-OPEN`/`NEG-MSG`/`NEG-ERR`/`NEG-CLOSE` wire messages + full binary Range/Bound/Fingerprint spec (protocol v1 = `0x61`). Bandwidth ∝ set *difference*, not set size. |
| **strfry** (`hoytech/strfry`, `docs/architecture.md`) | The production reference: indices clustered with `created_at`; single writer thread; compiled filters with sorted lookup tables (binary search, no linear scans); initial-query (`DBScan`) vs live-monitor (`ActiveMonitors` inverted index) split; pausable queries with time budgets; fuzz-tested against a "dumb filter" oracle. |
| **Citrine** (`greenart7c3/Citrine`, AGENTS.md + source layout) | Proof it works on a phone: Kotlin + Room (SQLite) — **3 entities: `EventEntity`, `TagEntity`, `EventFTS`**; foreground service hosting the ws server (`CustomWebSocketService.server`, port 4869); NIP-01 lifecycle rules enforced server-side (ephemeral 20000–29999 deleted after 1 min, replaceable 0/3/10000–19999 newest-per-(pubkey,kind), addressable 30000–39999 newest-per-(pubkey,kind,d), kind-5 deletes same-author refs, optional NIP-42 auth); bench-tested via `scripts/relay_bench.py` over `adb forward tcp:4869`. |

---

## 1. What we build (and what we don't)

**Build:** a *personal* relay. It stores the user's world (own events,
follows, feeds, engagement), answers NIP-01 REQs over localhost WebSocket,
syncs with upstream relays, and lives in a background isolate (Android:
foreground service; iOS: foreground-only + BGTaskScheduler catch-up).

**Don't build:** a Primal cache. Mirroring the whole network is
datacenter-scale. The phone stores a *bounded, scoped* slice (see §7
retention).

**Also don't build (yet):** serving *other* apps over LAN (Citrine's main
use case). Bind to `127.0.0.1` only; the single consumer is our own UI.
This removes auth, TLS, NAT, and store-review surface. LAN exposure is a
later opt-in (Citrine proves it's viable).

---

## 2. The event model — done properly

This is the part that is currently "dummy" in most naive client caches
(events dumped in a table, queries bolted on). A relay — even a tiny one —
must implement the full NIP-01 contract:

### 2.1 Wire invariants (trust boundary — already in our codebase, keep)

- `id = sha256(JSON[0, pubkey, created_at, kind, tags, content])`, UTF-8,
  no whitespace, NIP-01 escape set. Verify id **and** BIP-340 sig at
  *ingress* (our `RelayConnection._handleMessage` + `NostrEvent.isValid`
  already do this — the in-app relay inherits it for upstream events, and
  must ALSO do it for local UI publishes).
- JSON canonicalization on store: strip non-protocol fields before persisting
  (strfry does this — a relay must never store what it can't authenticate).

### 2.2 Kind lifecycle (the rules our store currently only half-implements)

Per NIP-01 ranges + Citrine's enforcement:

| Class | Kinds | Store rule |
|---|---|---|
| Regular | 1,2,4–44, 1000–9999 | keep all copies |
| Replaceable | 0, 3, 10000–19999 | keep only newest per `(pubkey, kind)`; on tie (same `created_at`) keep lowest id |
| Ephemeral | 20000–29999 | **never persist** (or persist with ~1–5 min TTL like strfry); forward to live subscribers only |
| Addressable | 30000–39999 | keep only newest per `(pubkey, kind, d-tag)`; same tie-break |

- **NIP-09 deletion (kind 5):** on ingest, delete referenced `e`/`a` targets
  *only when the deletion author == target author*. We currently don't do
  this at the store level — deleted posts linger in the cache.
- **NIP-40 expiration:** `expiration` tag → exclude from query results
  (we have `isExpired` on the model; the SQL layer ignores it).
- When answering `{"kinds":[0],"authors":[…]}` return only the **latest**
  version per author even if more are stored (NIP-01 SHOULD).

### 2.3 The tag-indexing contract (the real performance line)

NIP-01: *"all single-letter (a–z, A–Z) tag keys are expected to be indexed
by relays … only the first value in any given tag is indexed."*

This is what makes `{"#e": [...]}`, `{"#p": [...]}` queries fast and is
**the** thing a proper store must do that a naive one doesn't. One
generalized `tags` table covers every present and future tag filter — no
per-feature schema drift:

```
tags(event_id, name, value)   -- one row per (single-letter tag, first value)
INDEX (name, value, event_id)
```

Our current `event_refs` table is essentially a *hard-coded `e`-tag-only*
version of this. Generalize it (keep `event_refs` as the engagement
projection if convenient, but the relay's filter engine needs the full
single-letter index: `p`, `a`, `t`, `d`, `h`, `e`, `q`, …).

---

## 3. The filter engine — done properly

### 3.1 Semantics (NIP-01, exact)

- One filter = **AND** of its present attributes: `ids ∧ authors ∧ kinds ∧
  #tags ∧ since ≤ created_at ≤ until`.
- A `REQ` = **OR** across its filters (FilterGroup).
- List attributes (`ids`, `authors`, `kinds`, `#x`) = any-of; **empty list
  matches NOTHING** (and must not be treated as absent).
- `limit:n` applies to the initial query only → newest `n` by `created_at`
  (ties: lowest id first). `limit:0` = skip stored events, still send `EOSE`,
  keep live subscription open.
- `ids`/`authors`/`#e`/`#p` values must be exact 64-char lowercase hex.

### 3.2 Compiled filters (strfry's key idea, sized for Dart)

Today filters are evaluated ad-hoc per layer (`spec.matchesAny`, Dart-side
`_isFeedPost`, SQL in `feedPage` — three different places with three
different notions of a filter). Unify:

```dart
/// One filter, compiled ONCE at REQ time into hash sets + a matcher.
class CompiledFilter {
  final Set<String>? ids;       // null = attribute absent
  final Set<String>? authors;
  final Set<int>? kinds;
  final Map<String, Set<String>> tags; // '#e' → {…}
  final int? since, until, limit;
  bool matches(NostrEvent e) { /* O(1) hash lookups, && semantics,
                                   empty-set ⇒ false */ }
}
class FilterGroup {
  final List<CompiledFilter> filters;
  bool matches(NostrEvent e) => filters.any((f) => f.matches(e));
}
```

- Compile once per `REQ` (strfry: "the JSON filter is compiled, the original
  discarded"). Hash sets mean a 500-author Following filter matches in O(1),
  same as strfry's binary-search sets.
- **Oracle test (strfry's fuzz pattern):** property test — generate random
  events + random filter groups, compare `FilterGroup.matches` against a
  10-line dead-simple reference matcher. This catches the `&&`/`||`/empty-list
  bugs that ad-hoc filters always grow.

### 3.3 Initial query (stored events) — SQL, index-first

strfry's rule: *pick ONE best index per filter, scan it backwards, apply the
rest of the filter before sending.* Translated to SQLite:

| Filter shape | Index used |
|---|---|
| `ids` | `events.id` PK lookup |
| `authors` (+kinds) | `idx_events_author_time (pubkey, created_at DESC)` |
| `#x` tags | `tags(name,value,event_id)` → join events |
| kinds only | `idx_events_kind_time (kind, created_at DESC)` |
| nothing/since-only | `created_at` scan (bounded by `limit`) |

Choose the **most selective** shape per filter (ids > tags > authors > kinds
> time), run one query per list item with `created_at` bounds, merge-sort in
Dart (strfry scans per filter-item likewise), enforce `limit` across the
whole filter. This is a strict generalization of our existing `feedPage()`,
which is exactly the "kinds + authors + until" row.

### 3.4 Live monitor — inverted index, not per-sub scans

When a new event lands, checking every open subscription against it is
O(subs). strfry's `ActiveMonitors` inverted index is the fix, and it maps
1:1 onto what our **EventBus already does** with ref-counted specs — we
formalize it:

```
MonitorSets: authors → {subIds}, kinds → {subIds}, '#e' values → {subIds}, …
onEvent(e): candidates = union(lookup(e.pubkey), lookup(e.kind),
                               lookup(each single-letter tag value))
            for subId in candidates: full FilterGroup.matches(e) once
            remember (subId, e.id) up-to-date → never re-check, never double-send
```

Event delivery to N subscriptions carries **one** event reference (strfry:
"single copy of the event's JSON" — no per-sub copies).

---

## 4. Architecture in the app

```
┌──────────────────────────── isolate: local_relay ───────────────────────────┐
│  LocalRelayServer (shelf_web_socket, 127.0.0.1:4869, ws:// only, loopback)  │
│    │ NIP-01: EVENT / REQ / CLOSE → OK / EOSE / EVENT / CLOSED / NOTICE      │
│    ▼                                                                        │
│  SubscriptionManager ── FilterGroup compile ── MonitorSets (inverted idx)   │
│    │ initial query            ▲ live fan-out (from BOTH directions below)   │
│    ▼                          │                                             │
│  EventStore v3 (SQLite, WAL)  │   single-writer, batches writes (strfry     │
│    events / tags / profiles / │   writer-thread rule; also our single-      │
│    thread_edges / seen_on     │   isolate rule)                             │
│    ▲                          │                                             │
│    └──────── UpstreamSync ────┘   RelayPool (existing) pulls from real      │
│              │                    relays → verify → store → fan out locally │
│              └─ NEG-OPEN (NIP-77) on reconnect: reconcile id-sets, then     │
│                 REQ only the missing ids (bandwidth ∝ difference)           │
└─────────────────────────────────────────────────────────────────────────────┘
        ▲ ws://127.0.0.1:4869 (loopback, no TLS, no auth — never leaves device)
┌───────┴──────── UI isolate (existing app) ──────────────────────────────────┐
│ FeedNotifier/EventBus/repos talk to the LOCAL relay exactly like a remote   │
│ one — one client implementation for both (local first, remote fallback).    │
└─────────────────────────────────────────────────────────────────────────────┘
```

Rules:

1. **One isolate owns everything** (SQLite handle, upstream sockets, local
   server). No cross-isolate DB access — same "shared nothing" discipline as
   strfry's threads, and it sidesteps every SQLite concurrency trap.
2. **Single writer.** All ingestion (upstream events, UI publishes, deletions)
   goes through one queue in the relay isolate; writes batch (strfry amortizes
   fsync across a batch — same trick).
3. **The UI is just a relay client.** Feed = `REQ {kinds:[1,6,16,20,22,30023,
   1068], …}` to localhost. This deletes the current split-brain (SQL for
   pages, EventBus for live, Dart for filtering) — one protocol, one filter
   engine, tested once. Remote-relay fallback stays for cold caches.
4. **Pausable initial queries** (strfry's 10 ms budgets): stream SQL rows in
   chunks, yield the microtask queue between chunks — a big backfill never
   janks the isolate's ws loop.
5. **Verification at the boundary, once.** Upstream events: existing pool
   verification + 5k LRU. Local publishes: verify on `EVENT` receipt
   (self-consistency), answer with proper `OK` frames (`duplicate:`, `invalid:`
   prefixes per NIP-01).
6. **Ephemeral ≠ stored.** 20000s forward to live local subs and to upstream
   relays, never to disk (or 5-min TTL — strfry's choice; simpler: don't store).

---

## 5. Schema v3 (migration from our v2)

```sql
-- as today
events(id PK, pubkey, created_at, kind, tags TEXT, content, sig)
  INDEX (kind, created_at DESC), (pubkey, created_at DESC)
  + INDEX (created_at DESC)                      -- NEW: since/until scans

-- generalized single-letter tag index (supersedes e-only event_refs
-- for FILTERING; event_refs stays as the engagement projection)
tags(event_id, name, value, PRIMARY KEY(event_id, name, value))
  INDEX (name, value, event_id)                  -- NEW

profiles(pubkey PK, json, fetched_at)            -- as today
thread_edges(root_id, reply_id, created_at)      -- as today
seen_on(event_id, relay_url, seen_at)            -- as today
deletions(target_id, deleted_by, created_at)     -- NEW: NIP-09 audit + idempotency
```

Replaceable/addressable upserts: `INSERT … ON CONFLICT` guarded by
`created_at` comparison (keep newest; tie → lowest id). Kind-5 handling:
mark + delete same-author targets, record in `deletions` so a late-arriving
copy of the target is rejected (Citrine does this in the server; strfry in
the writer).

---

## 6. Sync: NIP-77 negentropy (the bandwidth saver)

On reconnect, today's code re-REQs windows of events and dedupes locally —
wasteful on mobile data. NIP-77 (spec quoted in full in research):

1. `["NEG-OPEN", subId, filter, initialMsgHex]` — initial message built from
   our local id-set for that filter (sorted by `(created_at, id)`).
2. Relay answers `NEG-MSG`; we iterate Range/Fingerprint/IdList rounds
   (protocol v1 byte `0x61`) → two sets: **ids relay needs** (upload via
   `EVENT`), **ids we need** (download via `REQ ids:[…]`).
3. `NEG-CLOSE`. Bandwidth ∝ |difference| — after a 12 h offline gap this is
   a few KB instead of re-pulling the whole window.

Support is growing on big relays (strfry ships it; nostr-rs-relay has
equivalents). Fallback when `NEG-ERR` → today's windowed REQ path. A pure-Dart
negentropy implementation is ~300 lines (Varint, Bound, Fingerprint = sum of
ids mod 2²⁵⁶ + count varint, sha256 → 16 bytes) — no native dep needed.

---

## 7. Memory & storage budget (the "low memory" requirement)

| Component | Budget | Mechanism |
|---|---|---|
| Relay isolate heap | 15–25 MB | no event copies (pass references); compiled filters are tiny hash sets |
| SQLite page cache | 8–16 MB | `PRAGMA cache_size`, WAL, `PRAGMA mmap_size` |
| Live subscriptions | ~1 KB each | MonitorSets entries, not per-sub buffers; pausable initial queries |
| Event body store | **bounded** | extend today's `prune()` (3000 rows / 24 MB / 1500 profiles) with per-class caps |

Retention policy (strfry cron-equivalent, run on ingest + app resume):

- kind 0/3/10002 etc.: replaceable — automatic (§2.2).
- kind 1/6/16/20/21/22/30023/1068: keep newest **N per author** (e.g. 200) +
  global byte cap (~50 MB) + age cap (90 d) — LRU eviction by `created_at`.
- Engagement (7/9735/1111): keep only events that **reference something we
  store** (join against `tags`/`event_refs`), age cap 30 d.
- Expired (NIP-40) and NIP-09-deleted: hard delete in the same pass.
- `seen_on`, `thread_edges`, `tags` rows die with their event (FK cascade or
  explicit delete).

Realistic steady state: **30–60 MB RSS added, ≤100 MB disk** — matches the
Citrine-class footprint. A Primal-style unbounded cache on a phone is the
only version that fails, and we're explicitly not building that.

## 8. Background execution (per-OS truth)

- **Android:** foreground service (`dataSync` type, declared for Android 14+)
  hosting the relay isolate; persistent notification; battery-optimization
  exemption offered in Settings. Citrine does exactly this
  (`WebSocketServerService`). Our `BackgroundSyncService.syncNow()` already
  centralizes reconnect+resync — the service just keeps the isolate alive.
- **iOS:** no true background server exists on the platform. Relay runs while
  foregrounded; `BGTaskScheduler` (via `workmanager`, already spec'd in
  `background_sync.dart`) does periodic catch-up; NIP-77 makes each wake-up
  cheap. Push (ADR-0006) becomes the live-delivery path later.

## 9. Testing strategy (strfry's playbook, adapted)

1. **Filter oracle fuzz** (§3.2) — random events × random filter groups vs
   dumb reference matcher.
2. **Lifecycle unit tests** — replaceable/addressable newest-wins, tie-break,
   kind-5 same-author rule, NIP-40 exclusion, ephemeral non-persistence.
3. **Wire-protocol tests** — spin up the local server in-test
   (`sqflite_common_ffi` in-memory, our existing pattern), drive it with a
   real ws client: REQ→EOSE→live EVENT, EVENT→OK, CLOSE→CLOSED, `limit:0`,
   empty-list-matches-nothing, multi-filter OR.
4. **Bench** — Citrine's `relay_bench.py` pattern: N stored events, measure
   initial-query latency + live fan-out latency on a real device via
   `adb forward tcp:4869`.
5. **Negentropy round-trip** — two stores with known set differences must
   reconcile to exactly those differences.

## 10. Phasing (each phase shippable)

| Phase | Deliverable | Status |
|---|---|---|
| **0. Filter correctness** | `CompiledFilter`/`CompiledFilterGroup` + oracle fuzz tests (2 500 events × 1 000 groups × 5 seeds); adopted in EventBus `matchesAny` | ✅ **DONE** — `core/nostr/filter.dart`, 16 tests, fixed empty-list/non-hex/case bugs |
| **1. Store v3** | `tags` + `deletions` tables; lifecycle: ephemeral skip, replaceable/addressable newest-wins (+tie-break), NIP-09 e/a deletes + late-copy rejection, NIP-40 exclusion; generic `queryByFilters` engine | ✅ **DONE** — migration v2→v3, 13 new tests, full suite 540 green |
| **2. Relay core in-process** | `LocalRelay`: REQ/EVENT/CLOSE in, OK/EVENT/EOSE/CLOSED/NOTICE out; initial query via `queryByFilters`; live monitor = inverted index (authors/kinds/tags + catch-all) with up-to-date dedup | ✅ **DONE** — `core/relay/relay_core.dart`, 13 wire-protocol tests |
| **3. Isolate + ws server** | `LocalRelayServer`: real NIP-01 ws on `127.0.0.1`, random port + per-boot token + request caps (per security doc); one `RelaySession` per connection | ✅ **DONE** — `core/relay/relay_server.dart`, 9 real-socket tests |
| **3b. UI wiring (live)** | `MergedRelayTransport` (local live + remote, deduped, flag-gated) feeds the EventBus; `localRelayProvider`/`relayTransportProvider`/`localRelayEnabledProvider`; ingest pipeline mirrors every stored event into the relay's live monitor | ✅ **DONE** — `core/relay/relay_transport.dart` + providers, 5 transport tests; remote pool still owns publishes/outbox; flag off = exact old behavior |
| **3c. UI wiring (queries — ALL features)** | `RelayPool.query` is now **local-first merged** (`localFirstQuery`): local store + remote relays run in parallel, deduped by id, remote events ingested back; one choke point upgrades every repository read (feed/engagement/profiles/notifications/comments/threads/articles/market/live/calendar/groups/lists/bookmarks/videos/hashtags). Per-filter NIP-01 limits (union semantics). Uppercase NIP-22 `A`/`E` scopes + `remoteOnly` markers go remote-only (the store indexes single-letter first-values only). Rollback: `localFirstEnabled=false` | ✅ **DONE** — `core/relay/local_first_query.dart` + `relay_pool.query`, 11 tests (offline works, dedup, per-filter limits, rollback, uppercase guard) |
| **4. Android background (Play-safe)** | Bounded **sync window**: workmanager expedited one-off task promoted to a `dataSync` FGS (`ForegroundServiceConfig`), 20-min bounded duration, self-rescheduling while the user toggle is on; no native code / no manifest change / no BOOT_COMPLETED (Android-15-safe); degrades to the hourly periodic catch-up under quota/Doze. Settings toggle `syncWindowEnabledProvider`, Android-only (`syncWindowSupported`) | ✅ **DONE** — `core/services/background_sync.dart`, 8 tests |
| **5. NIP-77 sync** | `Negentropy` (faithful Dart port of hoytech's reference — varint/bound/fingerprint codecs, 16-bucket split, initiator/responder, frame-size limit) + `NegentropySyncClient` (NEG-OPEN/MSG/CLOSE, download-missing, injected transport) + `NegentropySyncService` (per-relay, fallback-safe); wired into `syncNow` (NEG-unsupported relays skipped silently) | ✅ **DONE** — `core/nostr/sync/{negentropy,negentropy_sync,negentropy_transport,negentropy_sync_service}.dart`, 12 tests (incl. 1000-record 5%-divergent convergence <20 KB + full end-to-end store sync) |
| **6. (Optional) LAN relay** | bind 0.0.0.0 + NIP-42 auth + Tor (Citrine's full model) | later |

Phase 0+1 are pure wins with zero architecture risk and directly answer the
"proper filter, proper post format" complaint. Phases 2–3 turn the app into
its own backend. Phases 4–6 are operational polish.

## Consequences

- **Deletes:** the three divergent filter notions (SQL `feedPage` / EventBus
  `matchesAny` / Dart `_isFeedPost`) → one compiled-filter engine.
- **Bug fixes found during implementation (2026-10-25):**
  1. **Addressable stale-arrival data loss** — `_isStaleReplaceable` for
     addressable kinds used `tags = ?` with a LIKE *pattern* as an equality,
     which never matched, so a late OLDER version of an article/list/
     community deleted the newer stored one. Fixed with Dart-side d-tag
     comparison (`_isStaleAddressable`); regression test added.
  2. **Limit semantics** — per-filter NIP-01 union bounds (was a global
     min-then-max cap that both starved broad filters and over-returned for
     tight single filters).
  3. **Ingest concurrency & DB-lock stalls** — the FIRST fix (a global
     serialization queue) traded the race for a worse problem: one slow
     1000-event engagement sync locked the DB for 10s+ and sqflite spammed
     "database has been locked" while every read queued behind it. Final
     design: **two paths by kind** — regular kinds (~95% of volume) go
     through chunked `batch()` writes (50/transaction, lock breathes between
     chunks) with a batched one-query NIP-09 late-copy check; lifecycle
     kinds (replaceable/addressable/deletion) keep per-event transactions
     (read-modify-write). No global lock; closed-DB resilient; a malformed
     event skips itself, never the batch.
  4. **Local/remote latency** — `localFirstQuery` runs both legs in parallel
     (was sequential), and the remote leg is wrapped so even a synchronous
     throw is caught (offline never breaks the local answer).
  5. **Hashtag case (Explore → tap a tag showed no posts)** — `#t` values
     were matched case-sensitively everywhere (store SQL + compiled filter),
     but real relays answer `#nostr` for a `#Nostr` post. Now `e`/`p`/`t`
     are stored lowercased at ingest (canonical form), matched
     case-insensitively in `_scanCandidates` + `CompiledFilter`, while
     identity tags (`d`, etc.) stay case-SENSITIVE. `hashtagFeedProvider`
     became a STREAM: local tag query paints instantly (offline works), the
     relay backfill merges (never replaces the local paint with a thinner
     page), per-tag TTL, empty results not cached. 5 tests.
- **Adds:** `core/nostr/filter.dart`, `core/relay/*`, schema v3, ~300-line
  negentropy.
- **Keeps:** EventStore (evolved), RelayPool (becomes upstream-only),
  EventBus (becomes the in-process transport until phase 3).
- **Risk controls:** loopback-only binding (no attack surface), remote-relay
  fallback at every phase, oracle-tested filter semantics, bounded storage.
