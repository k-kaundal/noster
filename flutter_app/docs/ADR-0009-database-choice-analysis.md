# ADR-0009 — Local Database Choice: Analysis & Recommendation

**Date**: 2026-10-26
**Status**: ANALYSIS — no code changes. Companion to ADR-0008 (data architecture).
**Audience**: engineering / the agent implementing ADR-0008 phases P1–P7.
**Verdict**: **Keep sqflite (raw SQL). Do NOT migrate to Drift, Isar, ObjectBox, or any other DB.** The current choice is already the best-fit for this app. Details below.

---

## 1. What the app actually uses today (storage audit)

Three distinct storage tiers, each with a clear job:

| Tier | Tech | What lives there | Files |
|---|---|---|---|
| **Structured content** | **sqflite 2.5.14** (`nostrfeed_events.db`, schema v4) | events, event_refs (engagement index), tags, deletions, profiles, thread_edges, seen_on | `lib/core/db/event_store.dart` (1,859 lines — the ONLY sqflite import in lib/) |
| **Key-value settings & small caches** | **shared_preferences** (26 files) | theme, relay toggles, moderation lists, notified-id set, AI-credit flags, pending NIP-05 invoices, DM outbox/last-read (legacy, ADR-0008 migrates), app-version banner dismissals | settings, moderation, feed_store (legacy migration), dm_store, ai/*, identity, notifications |
| **Secrets** | **flutter_secure_storage** (6 files) | nsec (private key), LNbits session tokens, NWC credentials, LndHub credentials, AI credits ledger, active-wallet choice | auth, wallet (lnbits/nwc/lndhub), ai_credits |

**Nothing else is in the dependency tree**: no Drift, Isar, Hive, ObjectBox, Sembast, Realm, Floor, Couchbase, or PowerSync (verified in `pubspec.lock` — only `sqflite` + `sqlite3`).

Schema v4 (already shipped, ADR-0008 P0):
- Engine pragmas: WAL, `synchronous=NORMAL`, `busy_timeout=5000`, `journal_size_limit≈6MB`, FK on.
- **Single-writer lane** (`_enqueueWrite`) — SQLite never sees concurrent write txns.
- **Sargable ordering** (`order_ts` column + index) — feed ORDER BY is an index walk, not a temp-B-tree sort.
- **NIP-40 as a column** (`expires_at`) — expired rows delete by index.
- Indexes: `idx_refs_pubkey_kind`, `idx_events_pubkey_kind_time`, `idx_events_kind_ordertime`, `idx_events_expiry`.
- Idempotent migrations (`_addColumnIfMissing`).
- Bounds: 3,000 events / ~24 MB content / 1,500 profiles, LRU prune.
- Canonical typed records in `lib/core/db/db_models.dart` (DbMessage, DbThread, DbNotification, DbPublishJob, DbMedia, DbRelayHealth, DbDraft) — the storage contract for the tables landing in P1+.

Data flow (ADR-0005/0008, already the target architecture):

```
relays → RelayFrameProcessor (worker isolates: JSON decode + BIP-340 verify)
       → EventBus (dedup, ref-counted subs, flood gate)
       → ingestPipeline (150 ms batched, single write lane)
       → EventStore (SQLite)
       → projections (feedPage, engagement group-by, threadReplies, trendingCandidates)
       → Riverpod .select → UI (16 ms budget)
```

---

## 2. Candidate evaluation against THIS app's requirements

Requirements that actually matter here (in priority order):

1. **Complex relational queries** — engagement group-by counts, thread JOINs, NIP-01 filter matching (`queryByFilters` against the compiled filter engine), tag indexes, replaceable-kind "newest wins".
2. **Offline-first local read model** — every screen is a projection over local SQL; relay is write-through.
3. **Full control over engine** — WAL, busy_timeout, single-writer lane, prune budgets, EXPLAIN-pinned query plans. (ADR-0008 ships these by hand; they are load-bearing.)
4. **NIP-01 lifecycle semantics** — ephemeral/replaceable/addressable kinds, NIP-09 deletes, NIP-40 expiry — custom logic no ORM models natively.
5. **Mobile-only targets** — Android, iOS, macOS, Windows, Linux (web folder exists but the Flutter web build is not the product; the NostrFeed web app is the separate Vite/React app in repo root).
6. **App size budget** — ADR-0004: ≤35 MB download, currently 27.9 MB. Every KB counts.
7. **Team velocity** — one agent is implementing ADR-0008 phases NOW; a DB migration mid-flight is the worst possible time.
8. **Testability** — `sqflite_common_ffi` in-memory DBs already power deterministic unit tests.

| Database | Fit | Why / why not |
|---|---|---|
| **sqflite (current)** | ✅ **Best** | Raw SQL = total control over pragmas, indexes, prune, NIP-01 lifecycle, FTS5 (P4). Zero codegen. Tested via `sqflite_common_ffi`. Smallest footprint. Already 1,900 lines of tuned, load-bearing code. |
| **Drift** | ⚠️ Good, but a rewrite | Typesafe SQL, excellent API, active, MIT. But: v4's hand-tuned pragmas/writer lane/sargable columns would need re-implementation in Drift's migration + custom statement system; codegen adds build_runner friction; `queryByFilters` (dynamic SQL from the compiled filter engine) fights ORM query builders — you'd drop to `@Query`/custom selects anyway, ending at "Drift as a sqflite wrapper." Gain: type-safe rows. Cost: weeks of migration + risk on the most critical file in the app. **Not worth it now.** Revisit only if the store's table count explodes past ~15 and row-mapping bugs become a pattern (db_models.dart already gives 80% of Drift's row-safety benefit). |
| **Hive CE / Hive** | ❌ Wrong model | Key-value document store. Engagement group-bys, thread JOINs, tag indexes, and `queryByFilters` become in-Dart scans — exactly the "feels like a relay demo" jank EventStore replaced. Hive original is abandoned (2022); CE is a community lifeline. Hard no for the event store. (Could replace SharedPreferences for settings — unnecessary churn.) |
| **Isar Community** | ❌ Dying + wrong model | Bug-fixes-only maintenance, no web. NoSQL queries can't express the relational engagement/thread work. No. |
| **ObjectBox** | ❌ Wrong model + license risk | Object DB, closed-source core, mobile-only. Relations exist but the NIP-01 lifecycle + ad-hoc filter engine + FTS5 needs would fight the object model. Binary size cost. No. |
| **Couchbase Lite** | ❌ Massive overkill | Document DB built for enterprise sync (its sync server is the point — we sync via Nostr relays). Huge binary. No mobile-only justification. No. |
| **Realm** | ❌ Dead end | Dormant, Atlas Sync shut down. Object DB, wrong model anyway. No. |
| **Sembast** | ⚠️ Only if web mattered | NoSQL document store, pure-Dart so it runs on web. If the Flutter web build became a first-class target, Sembast (or Drift-WASM) is the *web* answer — but for native mobile it's a downgrade from SQLite for relational queries. Not needed today. |
| **Floor** | ❌ Inactive | Last release 2024. Dead. No. |
| **PowerSync / Electric / SQLite sync engines** | 🔍 Watch list | Not in the user's table but the honest "next big thing" candidates. They solve Postgres↔device sync — which this app doesn't have (Nostr relays ARE the sync layer, plus NIP-77 negentropy already implemented client-side). No fit. |

**The user's own comparison table supports this**: the only two Active + maintained + SQLite options are Drift and sqflite — and between them, the deciding factor is that **this store is not CRUD, it's a hand-optimized query engine with Nostr-protocol semantics baked into its schema**. Raw SQL is the right abstraction level for that.

---

## 3. Performance analysis: is sqflite fast enough for the UI?

Yes — and the evidence is already in the codebase:

- **Reads bypass the writer entirely** (WAL): feed pages, engagement counts, thread assembly never block on ingest.
- **Feed page = one indexed query**: `ORDER BY order_ts DESC LIMIT 50` on `idx_events_kind_ordertime` — an index walk, sub-millisecond on any phone.
- **Engagement = one group-by**: `SELECT target_id, kind, COUNT(*) ... GROUP BY` on `event_refs` with `idx_refs_pubkey_kind` — the "150 relay queries per feed" problem is already dead.
- **Ingest = one txn per 150 ms batch** (≤200 events), on a serialized lane, off the render path — verified by the P3 pipeline test.
- **No JSON decode on the read path**: rows map directly through `db_models.dart` `_fromRow`.
- Remaining known gaps (ADR-0008 §6) are NOT DB-engine problems: DM decrypt on the UI isolate (→ crypto worker isolate, P1), DM/notification persistence (→ new TABLES in the same SQLite DB, P1/P2), FTS5 search (→ a virtual table in the same DB, P4).

Every pending ADR-0008 phase **adds tables to the existing SQLite database** — `dm_messages`, `dm_threads`, `dm_outbox`, `notifications`, `publish_outbox`, `media`, `relay_health`, `author_relays`, `drafts`, `profile_fts`. Switching engines would invalidate the entire approved build order.

Where sqflite genuinely hurts other apps (and why it doesn't hurt this one):

| Common sqflite pain | Status here |
|---|---|
| No type-safe rows | Solved by `db_models.dart` (canonical fromRow/toRow records, one method per schema change). |
| Stringly SQL typos | Centralized in ONE file (`event_store.dart`) with tests pinning query plans (EXPLAIN). |
| Migration fragility | `_addColumnIfMissing` idempotent migrations + in-memory FFI tests migrating 1→4. |
| Concurrent write locks | Single-writer lane + WAL + busy_timeout (ADR-0008 P0, shipped). |
| No reactivity | Riverpod version providers (`engagementVersionProvider` debounce) → per-table invalidation bus in P5. |

---

## 4. Recommendation (decision)

1. **Keep sqflite as the single structured store.** Implement ADR-0008 P1–P7 as planned — all new feature tables go into the same `nostrfeed_events.db`, schema v5+.
2. **Do NOT migrate to Drift** during the ADR-0008 build-out. The only valid trigger to reconsider: after P7 ships, IF row-mapping bugs in `db_models.dart` become a recurring defect class, evaluate a *gradual* Drift adoption for NEW tables only (Drift and sqflite can share one `.db` file).
3. **Keep SharedPreferences for settings** — it's the right tool (small KV, no schema). ADR-0008 already migrates the two wrong uses out of it (DM outbox/watermarks → `dm_outbox`/`dm_threads`; notified-ids is fine as a capped KV set).
4. **Keep flutter_secure_storage for secrets** — hardware-backed keystore; no DB is a substitute. (P7 optional: SQLCipher for `dm_messages` at rest — an encryption layer on the SAME SQLite file, not an engine change.)
5. **If Flutter web ever becomes a product target**: evaluate **Drift (WASM)** or **Sembast** for that platform only, behind the existing EventStore abstraction boundary. Do not preemptively abstract — mobile is the product.
6. **Do not add Hive/Isar/ObjectBox/Realm/Floor/Couchbase to pubspec** — for any purpose. New KV needs → SharedPreferences; new structured needs → SQLite tables; new secrets → secure storage. (This also protects the ADR-0004 size budget.)

**Non-goals**: this ADR does not change the relay/sync architecture (Nostr + NIP-77 negentropy is the sync layer — no PowerSync-style engine is applicable), and does not introduce a server-side database (relay ops are out of scope, see ADR-0008 §9).

---

## 5. Quick-reference: what goes where (for the implementing agent)

| Data | Put it in | NOT in |
|---|---|---|
| Nostr events, engagement, threads, tags, profiles | `EventStore` tables (existing v4) | SharedPreferences JSON, memory-only |
| DMs (decrypted), threads, outbox | `dm_messages` / `dm_threads` / `dm_outbox` (P1) | SharedPreferences (`dm_outbox_v1`, `dm_last_read_v1` — legacy) |
| Notification history | `notifications` (P2) | memory-only 200-entry list |
| Publish retry queue | `publish_outbox` (P4) | fire-and-forget |
| Media metadata (blurhash, dims) | `media` (P4) | re-parsing imeta per render |
| Relay health/affinity | `relay_health` / `author_relays` (P3) | — |
| Composer drafts | `drafts` (P4) | unsaved |
| Profile/DM search | `profile_fts` FTS5 (P4) | `json LIKE '%q%'` scans |
| Theme, toggles, mute lists, notified-ids, small flags | SharedPreferences | SQLite (overkill) |
| nsec, wallet tokens, AI ledger | flutter_secure_storage | ANY plain DB/prefs |
