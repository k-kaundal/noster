# ADR-0008 — Data & Process Architecture (Relay Fleet → Store → Projections → UI)

**Status**: COMPLETE (P0–P7) + **God-object split done** (`event_store.dart` 2,778→2,066 lines; 7 domain stores extracted to `core/db/stores/` sharing one DB + writer lane via `StoreHost`). 702 tests green, lib/ = 0 issues.

> **P7 delivered (integration-ready, not a risky native dep)**: SQLCipher is
> NOT fetchable offline (pub.dev unreachable) and its native libs (~5–10
> MB/ABI) would breach the ADR-0004 size budget — so forcing it now would be
> irresponsible. Instead: `core/db/db_encryption.dart` provides the TESTED
> parts — `DbEncryptionKeys` (256-bit key in hardware-backed secure storage,
> generate/persist/rotate/destroy) + the `DB_ENCRYPTION` build flag wired
> into `EventStore._open` + `migrationNotes` (the `sqlcipher_export` path,
> never rewrite-in-place). Flipping the flag + `flutter pub add
> sqflite_sqlcipher` (when pub.dev is reachable) activates encryption with NO
> further code changes. Tests: `db_encryption_test` (5: key gen/reuse,
> rotate, destroy, flag-off, migration notes). The 100k ops side is
> `docs/RELAY-SCALING-RUNBOOK.md` — the deployable node/LB/mesh/monitoring/
> rollout/failure-mode plan (8–16 strfry/nostrfy nodes for 800k sockets,
> media on CDN, paid relay admission-gated).
**Supersedes/extends**: ADR-0005 (event pipeline), ADR-0007 (local relay + sync window)
**Audience**: engineering. This is the target architecture + failure analysis + scale plan
for the "most advanced Nostr client" bar.

> **P0 shipped** (`event_store.dart` v3→v4): WAL/busy_timeout/synchronous/
> journal-limit pragmas, single-writer lane (`_enqueueWrite`), `order_ts`
> (sargable feed ordering — replaces non-sargable `MIN(created_at,?)`),
> `expires_at` (NIP-40 as a column, deleted at read+prune),
> `idx_refs_pubkey_kind` + `idx_events_pubkey_kind_time` (full-scan fixes),
> tags-orphan prune fix, expired-row deletion, PASSIVE WAL checkpoint off
> the write lane, idempotent migration (`_addColumnIfMissing`). Canonical
> storage records in `lib/core/db/db_models.dart`. Tests pin order_ts,
> NIP-40 deletion, orphan-leak fix, and the index query-plan (EXPLAIN).
>
> **P1 shipped** (`event_store.dart` v5 + `dm_crypto_worker.dart` +
> `dm_store.dart`): messaging (kinds 4/1059) is now a **store projection**
> (`dm_messages`/`dm_threads`/`dm_outbox`) instead of memory-only. Decrypted
> plaintext is stored DEVICE-ONLY (like Signal's local DB — the NIP-17 wrap
> can't be re-decrypted by its sender). **All DM decrypt moved OFF the UI
> isolate** to the `DmCryptoWorker` pool (2 isolates) — the last big cold-
> start UI-isolate CPU block. `DmStore.prime` decrypts off-thread + persists
> each message; `recordSent`/`markStatus` persist to `dm_messages` (pending
> → sent/failed, durable across restart); `markThreadRead` persists the
> watermark to `dm_threads` (+ `recomputeDmUnread`); `clearAll` wipes
> `clearDmData` (no cross-account leak). Outbox retries are durable
> (`dm_outbox`). Tests: `dm_crypto_worker_test` (NIP-04/NIP-17/self-copy/
> tamper/kind-15/off-isolate batch), `dm_store_projection_test` (11 store
> tests: thread rows, unread watermark, keyset paging, outbox, clear).
>
> **P2 shipped** (`event_store.dart` v6 + `notification_center.dart`):
> notifications are now a **store projection** (`notifications` table) instead
> of a 200-entry memory list. The bell badge COUNT is an **instant partial
> index query** (`WHERE read_at IS NULL`) — never scans read rows. Cold start
> shows history from the store (was an empty relay-first list). Wiring is
> behavior-preserving: `ingest` → `upsertNotification` (fire-and-forget,
> recipient-aware via `isNotificationForMe` — unchanged); `markAllRead` →
> `markAllNotificationsRead` (durable `read_at` stamp); `reset` →
> `clearNotifications` (no cross-account leak). Per-recipient isolation ready
> for multi-account. Tests: `notification_store_test` (9: paging, batch,
> partial-index count, mark-all/one read, watermark boundary, isolation,
> clear, idempotent). The phone-notification dedup (`notified_event_ids_v1`)
> is untouched — a separate exactly-once concern.
>
> **P3 shipped** (`relay_health.dart` + `relay_pool.dart` + `event_store.dart`
> v7): the relay fleet is now **tiered + scored + budgeted** (was a flat map,
> queries broadcast to ALL 9 relays — the event flood on server AND client).
> - **Tiers** (`RelayHealthTracker.tierOf`): T0 platform (`relay.nostrfeed.com`
>   + paid, always connect first, never demote), T1 user (NIP-65/managed),
>   T2 curated public (health-scored, auto-demote/promote), T3 ad-hoc outbox
>   (bounded, unscored).
> - **EWMA health score** (persisted `relay_health`): connect success (1.0/0.0),
>   EOSE latency (∝ speed, 0 at 4s+), events delivered. `score = 0.7·score +
>   0.3·sample` — recent dominates, one bad probe never tanks a good relay.
>   Hooks are connection-level callbacks (`onConnectSuccess/Failure/onEose/
>   onEventDelivered`) so the connection stays transport-only.
> - **Top-K query fan-out** (`queryFanoutK = 4`): `_queryRemote` now hits the
>   platform relay + top-K healthiest connected read relays — NOT all 9. Cuts
>   server load (≤8 sockets → ~5 queried) AND the client verify/merge flood.
> - **T3 bounded pool** (≤4, LRU eviction on a **monotonic sequence** — not
>   wall-clock, which tied within one ms and evicted the wrong relay in
>   tests). Platform/curated relays are never evicted.
> - **Author→relay affinity** (`author_relays` + `recordAuthorRelay` on every
>   dispatched event): outbox routing hint (publish where an author's content
>   actually lives). Tests: `relay_health_test` (13: tiers/EWMA/topK/persist/
>   affinity), `relay_pool_adhoc_test` (3: LRU evict/refresh/platform-safe).
>
> **P4 shipped** (`event_store.dart` v8 + `media.dart` + `nostr_service.dart`
> + `background_sync.dart`): three durable capabilities —
> - **FTS5 people search** (`profile_fts`): `saveProfile` indexes name/
>   display_name/nip05/about; `searchProfiles` uses FTS5 `MATCH` (indexed,
>   prefix-aware) with a LIKE fallback (feature-detected `_ftsAvailable`).
>   Backfilled for existing installs. Was a `json LIKE '%q%'` full scan +
>   per-row jsonDecode.
> - **Media metadata** (`media` table): `MediaUtils.persistImeta` writes
>   parsed NIP-92 imeta (dims/blurhash/mime) at render → the NEXT render
>   lays the tile out BEFORE the bytes load (no layout jump). `mediaFor(url)`,
>   `mediaForEvent(id)`, batch upsert.
> - **Publish outbox** (`publish_outbox`): `NostrService.publishWithAck` on
>   failure queues the signed event durably; `retryPublishOutbox` (wired into
>   background sync) re-publishes pending jobs with bounded attempts (cap 10).
>   A failed post/reply/DM/zap now lands eventually, never silently lost.
> - **DM full-text search** (`searchDmMessages`): searches the DECRYPTED
>   plaintext in `dm_messages` (local device copy only, Signal's trust
>   boundary), global or scoped to a peer's thread.
> Tests: `p4_features_test` (13: FTS name/display/nip05/about/prefix/
> re-index/empty, media dims/gallery/idempotent, outbox transitions/retry,
> DM search global/scoped/empty).
>
> **P5 shipped** (`store_invalidation.dart` + `event_store.dart` +
> `content_providers.dart` + `ingest_pipeline_providers.dart` + `app.dart`):
> the **per-table invalidation bus** — the UI-smoothness keystone. ONE global
> `engagementVersionProvider` used to bump on EVERY write (a DM write rebuilt
> feed cards). Now: per-table version counters (`StoreTable.events/eventRefs/
> profiles/dmMessages/dmThreads/notifications/relayHealth/media`). The
> writer lane reports WHICH tables changed after each commit (`_enqueueWrite`
> `touches:` → static `EventStoreHooks.onTablesChanged` → the bus — the store
> stays Riverpod-free, no import cycle). Providers `.select` on exactly their
> slice via `tableVersionProvider(table)`: a like landing rebuilds ONE card's
> count (`eventRefs`), a DM landing rebuilds ONE thread (`dmMessages`), and
> NEITHER rebuilds the other. `engagementVersionProvider` now DERIVES from
> `StoreTable.eventRefs` (same counter semantics, sourced from the commit) —
> the pipeline's + feed_notifier's manual pokes are GONE (one source of truth).
> Wired at app root (`storeInvalidationWiringProvider`) before the ingest
> pipeline. Tests: `store_invalidation_test` (5: DM≠engagement, engagement≠DM,
> notifications isolated, burst debounces to ONE bump, bumpNow immediate) +
> the pipeline tests re-wired to the bus.
>
> **P6 shipped** (`negentropy_sync.dart` + `negentropy_sync_service.dart` +
> `background_sync.dart`): NIP-77 negentropy hardening —
> - **Upload half**: `haveIds` was computed then DROPPED (relays never
>   received events they lacked — the protocol's bandwidth savings ran one
>   way). Now `_uploadMissing` publishes the events WE have that the relay
>   lacks, bounded by `uploadCap = 256` (a huge diff is a backfill job, not a
>   sync). `uploadedCount` on the result. `uploadMissing:` toggle.
> - **Bounded-parallel**: `syncAll` was SEQUENTIAL (each relay's up-to-40s
>   worst case serialized — a slow relay stalled the whole pass). Now a
>   bounded worker pool (`parallelism = 4`) reconciles relays concurrently;
>   one bad relay never kills the others.
> - **Wi-Fi-only toggle**: `syncWifiOnlyProvider` + gate in `syncNow` — on a
>   metered (cellular) connection with the toggle ON, SKIP the bandwidth-heavy
>   NIP-77 reconciliation (download/upload move the most bytes of any sync
>   step); the light feed-refresh path covers the gap. Empty/unknown
>   connectivity defaults to METERED (conservative for a user who opted in to
>   save data).
> Tests: `negentropy_p6_test` (4: upload half delivers haveIds, uploadMissing
> disables, parallel + bad-relay-tolerant, uploadCap bounds).

---

## 1. North Star

> **The UI reads ONLY the local store. The network writes ONLY through one
> pipeline. Everything expensive happens on background isolates. The store is
> bounded, indexed, and answers every feature's read in <16 ms.**

Three non-negotiables:

1. **Single write path.** Every event from every source (live socket, page
   fetch, negentropy sync, DM gap-fill, local relay) enters the store through
   ONE batched, backpressured ingest pipeline. No feature writes directly.
2. **Single read model.** Every screen is a **projection** over the local
   store (SQL or in-memory derived). Nothing renders a raw relay response.
3. **Zero heavy work on the UI isolate.** Parse, verify, decrypt, and write
   are all off-thread. The UI isolate only builds widgets and diffs lists.

---

## 2. Layer model (what exists vs what's missing)

```
L1  TRANSPORT     relay sockets, TLS, backpressure          [EXISTS, good]
L2  PROCESS       frame parse + Schnorr verify (worker pool) [EXISTS, ADR-0005 L2]
L3  STORE         SQLite, schema, lifecycle, prune           [PARTIAL — v4 needed]
L4  PROJECTIONS   feed/notifications/DMs/search/trending     [PARTIAL — gaps]
L5  UI            Riverpod .select on projections            [EXISTS]
L6  SYNC          negentropy, background sync, outbox        [PARTIAL — half]
```

The current system's **biggest architectural inconsistency**: feed,
engagement, threads, profiles are true store projections (L4), but **DMs and
the notification center bypass the store entirely** (memory-only), and
notifications/search are relay-first. ADR-0008 fixes this by making
EVERYTHING a projection.

---

## 3. L1 — Relay Fleet Management (NEW: tiered, scored, budgeted)

### 3.1 The problem today

Relays are a flat `Map<String, RelayConnection>`. The only per-relay signal
is `RelayState`. **No priority, no latency tracking, no success rate, no
trusted-vs-untrusted distinction.** `relay.nostrfeed.com` is "first" in a list
but gets NO query priority. The paid relay is "just another socket" after
admission. `seen_on` provenance is recorded but never consumed for routing.

### 3.2 Relay tiers (design)

Every relay is assigned a **tier** that drives connection priority, query
routing, and trust weight:

| Tier | Relays | Connection policy | Trust |
|---|---|---|---|
| **T0 — Platform** | `relay.nostrfeed.com` | Always connect FIRST, never drop, priority queries | Highest — our own infra, DM self-history pin, first indexer |
| **T0 — Paid** | `paid.nostrfeed.com` | Connect after admission; premium queries route preferentially | High — paid users, NIP-42 authed |
| **T1 — User** | User's NIP-65 kind-10002 + managed list (read/write toggles) | Connect per toggle; respect read/write intent | Medium |
| **T2 — Curated public** | damus, nos.lol, primal, snort, … | Connect, health-scored, auto-demotion on failure | Medium-low |
| **T3 — Ad-hoc/outbox** | Per-user NIP-65 write/read relays (discovery) | Connect **on demand, bounded pool, auto-disconnect when idle** | Low — untrusted transport |

### 3.3 Relay health scoring (NEW)

Track per relay, persisted (`relay_health` table):

```
relay_url PK, tier, last_connected_at, last_eose_ms, eose_samples,
success_count, failure_count, events_delivered, score REAL, updated_at
```

- **score** = EWMA of (connect success, EOSE latency, events/min delivered).
- **Demote**: score < threshold → move T2 relay to "probation" (connect less
  often, lower query priority). **Promote** on recovery.
- **Query routing**: a query fans out to (T0 always) + (top-K T1/T2 by score,
  K≈4) instead of ALL read relays. Cuts relay traffic AND the verify/merge
  flood on the client — this is the single biggest "too many events at once"
  lever we have.
- **Consume `seen_on`**: prefer relays that historically delivered an
  author's events (outbox hints) — record `author → relay` affinity.

### 3.4 Connection budget (NEW)

Hard caps so a phone never holds 30 sockets:

- **Persistent**: T0 (2) + T1/T2 top-scored (≤6) = **≤8 persistent sockets**.
- **Ad-hoc (T3)**: a bounded pool (≤4), each with an **idle timer (60 s)** —
  disconnect when unused. Today ad-hoc connections live forever.
- **Subscriptions**: EventBus ref-counting already dedups REQs; add a global
  cap (≤20 live REQs/socket, mirroring strfry `maxSubsPerConnection`) with
  lowest-priority eviction.

---

## 4. L3 — Store schema v4 (the heart of ADR-0008)

### 4.1 Durability & engine pragmas (Android/iOS standard, per Android docs + PowerSync)

Set on open, every connection:

```sql
PRAGMA journal_mode = WAL;          -- readers don't block the writer
PRAGMA synchronous = NORMAL;        -- no per-commit fsync (30ms → <1ms)
PRAGMA busy_timeout = 5000;         -- never SQLITE_BUSY-fail under contention
PRAGMA foreign_keys = ON;
PRAGMA wal_autocheckpoint = 1000;   -- default; run a periodic manual
                                    -- PASSIVE checkpoint off the write lane
```

**Single-writer rule** (the SQLite law): ONE serialized ingest queue owns ALL
writes (the ingest pipeline already batches 150 ms — formalize it as the
store's write lane, `BEGIN IMMEDIATE`). Readers get their own connections and
never block on the writer (WAL). This removes every "database is locked"
risk class. (ZeroExp benchmark: busy_timeout 5000 + single writer = zero
lost writes at 100k+ rows/s; busy_timeout 0 = catastrophic loss.)

### 4.2 Schema v4 — the gaps closed

Existing v3 tables stay (events, event_refs, profiles, thread_edges,
seen_on, tags, deletions). **v4 adds the missing feature stores** so DMs and
notifications become projections, and fixes the unindexed reads.

```sql
-- ── Messaging (kinds 4/1059) — was memory-only, the biggest gap ──────────
-- We CANNOT store NIP-17 gift-wraps decryptably (sender can't re-decrypt),
-- so we store the DECRYPTED plaintext locally (device-only, like Signal's
-- local DB). Raw wraps stay OUT (useless ciphertext). NIP-04 stores raw.
CREATE TABLE dm_messages (
  id            TEXT PRIMARY KEY,      -- rumor id (NIP-17) / event id (NIP-04)
  peer          TEXT NOT NULL,         -- the other party's pubkey
  direction     INTEGER NOT NULL,      -- 0 = incoming, 1 = outgoing
  content       TEXT NOT NULL,         -- DECRYPTED plaintext (never the wrap)
  created_at    INTEGER NOT NULL,      -- rumor timestamp (display order)
  raw_id        TEXT,                  -- the gift-wrap/kind-4 event id (fetch ref)
  wrap_kind     INTEGER NOT NULL,      -- 4 or 1059
  status        INTEGER NOT NULL,      -- pending/sent/failed (outgoing)
  reply_to      TEXT,
  subject       TEXT                   -- NIP-17 room name
);
CREATE INDEX idx_dm_peer_time   ON dm_messages(peer, created_at ASC);
CREATE INDEX idx_dm_time        ON dm_messages(created_at DESC);

-- Replaces the SharedPreferences dm_outbox_v1 + dm_last_read_v1 JSON blobs.
CREATE TABLE dm_threads (
  peer          TEXT PRIMARY KEY,
  last_msg_at   INTEGER NOT NULL,
  last_read_at  INTEGER NOT NULL DEFAULT 0,  -- watermark (was dm_last_read_v1)
  unread_count  INTEGER NOT NULL DEFAULT 0
);
-- Outgoing-only durable outbox (retry queue for failed sends).
CREATE TABLE dm_outbox (
  id            TEXT PRIMARY KEY,
  peer          TEXT NOT NULL,
  payload       TEXT NOT NULL,          -- the signed wraps (recipient + self)
  created_at    INTEGER NOT NULL,
  state         INTEGER NOT NULL,       -- pending/sent/failed
  attempts      INTEGER NOT NULL DEFAULT 0
);

-- ── Notifications — was a 200-entry memory list, empty on cold start ──────
CREATE TABLE notifications (
  id            TEXT PRIMARY KEY,      -- the triggering event id
  recipient     TEXT NOT NULL,          -- me (multi-account ready)
  type          INTEGER NOT NULL,       -- like/repost/reply/mention/follow/zap/dm
  actor         TEXT NOT NULL,          -- who did it
  target_id     TEXT,                   -- the post/event acted on
  event_json    TEXT NOT NULL,          -- full event for rendering
  created_at    INTEGER NOT NULL,
  read_at       INTEGER                 -- NULL = unread
);
CREATE INDEX idx_notif_recip_time ON notifications(recipient, created_at DESC);
CREATE INDEX idx_notif_recip_read ON notifications(recipient, read_at)
  WHERE read_at IS NULL;                -- partial: unread count is instant

-- ── Publish outbox (durable retry for ALL event kinds, not just DMs) ──────
CREATE TABLE publish_outbox (
  id            TEXT PRIMARY KEY,      -- event id
  event_json    TEXT NOT NULL,
  targets       TEXT NOT NULL,          -- JSON relay list (incl. outbox hints)
  created_at    INTEGER NOT NULL,
  state         INTEGER NOT NULL,       -- pending/sent/failed
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT
);
CREATE INDEX idx_outbox_state ON publish_outbox(state, created_at);

-- ── Media metadata (was re-parsed per render, memoized in RAM only) ───────
CREATE TABLE media (
  url           TEXT PRIMARY KEY,
  event_id      TEXT,
  kind          INTEGER,                -- image/video/audio
  width         INTEGER, height INTEGER,
  blurhash      TEXT, mime TEXT,
  local_path    TEXT,                   -- on-disk cache path if downloaded
  upload_state  INTEGER                 -- local/uploading/uploaded/failed
);

-- ── Relay health (L3 scoring) ─────────────────────────────────────────────
CREATE TABLE relay_health (
  url           TEXT PRIMARY KEY,
  tier          INTEGER NOT NULL,
  score         REAL NOT NULL DEFAULT 0,
  last_eose_ms  INTEGER, eose_samples INTEGER,
  success_count INTEGER, failure_count INTEGER,
  updated_at    INTEGER
);
-- Author → relay affinity (consume seen_on for outbox routing).
CREATE TABLE author_relays (
  pubkey        TEXT NOT NULL,
  relay_url     TEXT NOT NULL,
  event_count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (pubkey, relay_url)
);

-- ── Composer drafts (unsaved today) ───────────────────────────────────────
CREATE TABLE drafts (
  id            TEXT PRIMARY KEY,
  kind          INTEGER NOT NULL,
  content       TEXT NOT NULL,
  tags          TEXT NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- ── Profile search fix: FTS5 (was `json LIKE '%q%'` full scan) ────────────
CREATE VIRTUAL TABLE profile_fts USING fts5(
  pubkey UNINDEXED, name, display_name, nip05, about,
  tokenize = 'unicode61'
);
```

### 4.3 Index fixes on EXISTING tables

```sql
-- userInteractionsFor currently full-scans event_refs (no pubkey-leading idx)
CREATE INDEX idx_refs_pubkey_kind ON event_refs(pubkey, kind, target_id);

-- "Zaps I received" (studio earnings) needs author+kind on events
CREATE INDEX idx_events_pubkey_kind_time ON events(pubkey, kind, created_at DESC);

-- feedPage's ORDER BY MIN(created_at, ?) is non-sargable (temp B-tree sort).
-- Fix: store the CLAMPED timestamp at ingest (compute MIN(created_at, now+tolerance)
-- once, write it), then index it. ORDER BY becomes an index walk.
ALTER TABLE events ADD COLUMN order_ts INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_events_kind_ordertime ON events(kind, order_ts DESC);

-- Addressable d-tag: stop JSON-decoding every candidate. The d value IS in
-- the tags table — probe it (indexed) instead of _rowDTag per row.
-- (query change, no DDL: SELECT event_id FROM tags WHERE name='d' AND value=?)

-- NIP-40 expiry: multi-letter 'expiration' isn't in tags; add a column so
-- expired rows are deleted at read AND prune, not accumulated.
ALTER TABLE events ADD COLUMN expires_at INTEGER;   -- NULL = never
CREATE INDEX idx_events_expiry ON events(expires_at) WHERE expires_at IS NOT NULL;
```

### 4.4 Prune v4 (bounded, no leaks)

- **Fix the `tags` orphan leak** — `_dropOldestBeyond` deletes events/refs/
  seen_on/thread_edges but NOT `tags` (unbounded index growth). Add
  `DELETE FROM tags WHERE event_id IN (...)` to the cascade.
- **Per-table budgets**, not one global cap: events 3000 rows/24 MB (hot
  content), dm_messages 10k (people keep chats), notifications 500,
  media 2k, outbox unbounded-until-sent (tombstone after 7 days).
- **Expired rows**: delete `WHERE expires_at < now` on every prune pass
  (today they accumulate until LRU).
- **seen_on / event_refs hygiene**: refs TO evicted events are kept today
  (counts for old posts survive — correct), but bound `seen_on` by joining
  the events cap (provenance for evicted content is useless).
- Run prune on the **writer lane**, scheduled (every N ingests or M minutes),
  never on the render path (already true).

---

## 5. L4 — Projections (every feature reads the store)

The rule: **a projection is a SQL query or a derived in-memory model fed by
the store; a screen never renders a raw relay list.**

| Feature | Today | v4 projection |
|---|---|---|
| Feed (For You/Following) | ✅ `feedPage` SQL | `feedPage` on `order_ts` index |
| Engagement counts | ✅ `event_refs` group-by | same + `idx_refs_pubkey_kind` |
| Threads | ✅ `threadReplies` | same |
| Profiles | ✅ memory→SQLite→relay SWR | same + FTS5 search |
| Trending | ✅ `trendingCandidates` | same |
| **DMs** | ❌ memory-only | **`dm_messages`/`dm_threads` SQL**; decrypt on ingest (background isolate) |
| **Notifications** | ❌ memory + relay-first | **`notifications` table**; unread = partial index; cold start shows history instantly |
| Bookmarks/Lists | ⚠️ relay + write-back | store projection (bookmarked_ids table or tags probe) |
| Search | ❌ relay-only (NIP-50) | **local FTS5 first**, relay NIP-50 merges |
| Wallet/payments | ❌ live fetch | payments table (LNbits/NWC/Cashu unified) |
| Media | ⚠️ RAM memo | `media` table |
| My relay list | ⚠️ SharedPreferences + kind 10002 dual source | kind 10002 in `events` = source of truth, prefs cache |

**Change feed to the UI**: the store exposes a **fine-grained invalidation
bus** — not "rebuild everything." Each projection registers its tables of
interest; the writer lane emits `InvalidationSet(tables, ids)` after each
batch commit; Riverpod providers `.select` on exactly their slice. This is
how 60fps is kept while writes land: a like landing rebuilds ONE card's
count, not the feed. (The existing `engagementVersionProvider` debounce is
the primitive; v4 generalizes it to per-table invalidation topics.)

---

## 6. L2/L6 — Background processing (all heavy work off-UI)

| Work | Where it runs | Status |
|---|---|---|
| WebSocket frame `jsonDecode` | `RelayFrameProcessor` worker isolates (2, cap 4) | ✅ Done (ADR-0005 L2) |
| Schnorr verify | same worker pool, `VerifyLru` dedup | ✅ Done |
| Frame ordering | `FrameSequencer` per socket | ✅ Done |
| Socket backpressure | `pauseSocket`/`resumeSocket` on watermark | ✅ Done |
| **DM decrypt (NIP-44/04)** | **move to a crypto worker isolate** | ⬜ TODO — currently time-sliced on UI isolate (`DmStore.prime` yields every 4) — 100s of NIP-44 ops per cold start |
| SQLite writes | single writer lane, batched | 🟡 partial (ingest batches; DM/notif outbox to add) |
| SQLite reads | reader connections (WAL) | ✅ via sqflite pool |
| Negentropy sync | background, bounded-parallel relays | 🟡 partial (sequential today → `Future.wait`) |
| Image decode | engine I/O thread + sized decode | ✅ Done (memCache) |
| Trending/ranking | derive on write-lane commit, cache | ⬜ TODO (currently per-query) |

**Crypto worker isolate (NEW)** — the missing piece. DM decrypt on a cold
start is the last big UI-isolate CPU block. Same pattern as
`RelayFrameProcessor`: a persistent isolate, DMs queued through it, plaintext
returned → written to `dm_messages` on the writer lane. Signal/WhatsApp do
exactly this (decrypt in a background handler, store plaintext in the local
DB, UI reads the DB).

---

## 7. Messaging deep-dive (the user asked specifically)

**Current**: kind 4/1059 are EXCLUDED from ingest (memory-only). Every cold
start re-fetches from relays (7-day lookback) and re-decrypts everything on
the UI isolate. Outbox + read watermarks are SharedPreferences JSON.
History lives only as long as relays retain it.

**v4 messaging flow**:

```
Incoming wrap (L1) → frame processor verify (L2)
  → crypto worker: unwrap NIP-17 / decrypt NIP-04 (background)
  → writer lane: INSERT dm_messages (plaintext) + UPSERT dm_threads(unread++)
  → invalidation bus: dm_threads changed
  → UI: chat list & thread rebuild via .select (smooth)
  → NotificationCenter: phone notification (dedup, burst-collapse)
Outgoing: compose → sign wraps → INSERT dm_messages(direction=out, pending)
  + dm_outbox → publishWithAck → markStatus sent/failed
  → dm_outbox retries failed on reconnect/background sync (durable!)
```

- **Self-copies**: NIP-17 sender CAN'T re-decrypt, so our own sends render
  from `dm_messages(direction=out)` — never re-fetched. (Already the rule;
  v4 makes it durable across restarts instead of a 7-day SharedPrefs blob.)
- **Group DMs (NIP-17)**: one wrap per member → each member's wrap → one
  `dm_messages` row per (sender, group_id). Group = synthetic peer key.
- **Search**: `dm_messages` content is plaintext locally → FTS5 over DMs is
  trivial (opt-in, privacy toggle).
- **Retention**: per-user setting (keep 30/90/∞ days) enforced at prune.

---

## 8. Failure-mode analysis (where this design breaks, honestly)

| Failure | Mitigation in design | Residual risk |
|---|---|---|
| **Worker isolate crash/OOM** | `errorsAreFatal: false`, sync fallback, fail-closed | Low — fallback = old behavior |
| **SQLite write contention** | Single writer lane + busy_timeout 5000 + WAL | Very low (ZeroExp: 0 lost writes) |
| **WAL grows unbounded** | Periodic PASSIVE checkpoint off write lane | Low — read perf degrades if missed |
| **Backpressure stalls feed** (relay flood > workers) | Pause socket → relay buffers → drain; watermarks tuned (768/192) | Medium — flood = delayed, never lost (TCP) |
| **dm_messages plaintext on device** | Device-only DB (like Signal); optional SQLCipher later; never backed up to cloud | Medium — device compromise = readable chats (same as every messenger) |
| **notifications table bloat** | 500-row budget + partial unread index | Low |
| **Relay score gaming / bad T0** | T0 pinned by us (trusted); score only demotes T2 | Low |
| **Schema migration v3→v4 fails mid-upgrade** | Migrations in one txn; backfill lazily; `db` getter never caches failed open (already) | Low — worst case = wipe + re-sync (offline-first rebuilds) |
| **Ad-hoc relay pool exhaustion** | Bounded T3 pool (4) + 60 s idle disconnect + queue | Low |
| **100k users hammer OUR relays** | See §9 — server-side concern, client mitigations | (server) |
| **Negentropy bandwidth on mobile** | Feed-scope only (24 h), bounded-parallel, skip on metered | Medium — add "Wi-Fi only" toggle |
| **FTS5 availability** | fts5 is compiled into modern iOS/Android SQLite; fall back to `LIKE` if `CREATE VIRTUAL TABLE` throws | Low — feature-detect at open |

---

## 9. Scale analysis — "100,000 users at the same time"

**Key insight**: 100k users don't hit the CLIENT — they hit the RELAYS
(ours + public). The client-side design above already handles one user's
heaviest load. So §9 splits into (a) what 100k clients do to OUR infra,
(b) how the client behaves when its relays are under that load.

### 9a. Load on `relay.nostrfeed.com` + `paid.nostrfeed.com` (capacity plan)

Reference numbers (nostrfy benchmark, 2 vCPU i5 / 2 GB, loopback):
- **24,500 events/s accepted**, **680k fan-out deliveries/s**, **10k
  connections held at ~280 MiB RSS**.
- strfry on a real host: "hundreds of thousands of connections on a single
  host"; per-connection ~90 KB (kernel+user).

Per-client demand (our design): **≤8 persistent sockets** (down from ~9+ad-hoc
today — tiering/budget REDUCES server load), ~2–4 live REQs after bus dedup,
~50 events/page.

100k concurrent users:
- **Sockets**: 100k × 8 = **800k concurrent WebSockets** across the fleet.
  At ~10k conn/host (nostrfy, 2 vCPU) → **~80 relay hosts**; at strfry's
  "100k+/host" on big iron → **~8–16 hosts**. Realistic target: shard
  `relay.nostrfeed.com` behind a load balancer to **N=8 strfry/nostrfy
  nodes** (horizontal, stateless-ish, LMDB per node) + GEO DNS.
- **Bandwidth**: idle keepalive ~1 KB/s/conn → 800k × 1 KB/s ≈ **6.4 Gbps
  aggregate** fleet-wide → ~800 Mbps/node (fine on 1–10 Gbps NICs). Active
  feed traffic dominates: 100k × ~50 KB/page × a few pages/hr ≈ tens of
  Gbps at peak → need **permessage-deflate** (strfry has it) + CDN for media
  (media must NOT flow through relays).
- **Writes**: 100k users × ~5 events/day ≈ trivial; burst (a viral post's
  engagement) is fan-out, which nostrfy does at 680k/s/node.
- **Cost ballpark**: 8 × (4 vCPU/16 GB) nodes ≈ modest; the dominant cost is
  **egress bandwidth**, not CPU. Media offloaded to Blossom/CDN is the #1
  cost control.

**Paid relay**: admission-gated (NIP-42), so its load = paid users only →
a single beefy node (or 2 for HA) handles thousands of paying users; scale
out by the same sharding when paid count grows.

**Client mitigations that cut server load directly**:
- Relay tiering + top-K query fan-out (§3.3) — clients stop broadcasting
  every query to all 9 relays.
- Sliding-since resubscribe (already) — reconnect replays only the gap.
- Negentropy (NIP-77) — set reconciliation instead of full re-fetch.
- Backpressure (already) — a slow client never forces the relay to buffer
  unboundedly (mirrors strfry `maxPendingOutboundBytes`).

### 9b. Client behavior when ITS relays are saturated

- **Health scoring demotes** a slow/overloaded T2 relay automatically →
  client shifts load to healthier relays (self-healing fleet).
- **Backpressure + bounded buffers** — the client sheds load gracefully:
  pause sockets, drop low-priority subs, never OOM.
- **Local-first everything** — a relay outage = slightly stale feed, but
  DMs/notifications/feed all still render from the store (offline-first is
  the ultimate scale mitigation: the app works even if ALL relays are down).

---

## 10. Build order (phased, each independently shippable)

| Phase | Deliverable | Risk | Depends |
|---|---|---|---|
| **P0** | SQLite pragmas (WAL/busy_timeout/synchronous), single-writer lane formalized, tags-orphan prune fix, `idx_refs_pubkey_kind`, `order_ts` column | Low | none |
| **P1** | dm_messages/dm_threads/dm_outbox tables + crypto worker isolate for decrypt; DM UI reads store | Med | P0 |
| **P2** | notifications table + projection; cold-start notification history | Low | P0 |
| **P3** | Relay tiers + health scoring + top-K query fan-out + T3 bounded pool | Med | — |
| **P4** | FTS5 profile/DM search; media table; publish_outbox durable retry | Med | P0/P1 |
| **P5** | Per-table invalidation bus (generalize engagementVersion) | Med | P1/P2 |
| **P6** | Negentropy bounded-parallel + upload half + Wi-Fi-only toggle | Low | — |
| **P7** | (Optional) SQLCipher for dm_messages; server sharding runbook for 100k | High | ops |

**Migration safety**: v3→v4 in one transaction; new tables `IF NOT EXISTS`;
`order_ts`/`expires_at` backfilled lazily (read falls back to `created_at`
when `order_ts = 0`). Worst case = wipe + re-sync (offline-first rebuilds
from relays), never a bricked install.

---

## 11. Decision requested

Approve the target architecture + pick the first phase(s) to implement.
Recommendation: **P0 (pragmas + writer lane + index/prune fixes)** and
**P1 (DM store + crypto worker)** first — they close the two biggest
correctness gaps (write contention, DMs memory-only) and the last big
UI-isolate CPU block (cold-start decrypt), with the least risk.
