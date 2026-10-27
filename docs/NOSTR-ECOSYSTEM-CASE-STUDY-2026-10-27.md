# Nostr Ecosystem Case Study — Clients, Relays, Genuine-Content Handling + Our App & Relay Audit

Status: **analysis + audit (2026-10-27)**
Related: `RELAY_HUB_SYNC_ARCHITECTURE.md`, `NOSTR_RELAY_BEST_PRACTICES.md`, `flutter_app/AGENTS.md`, `NOSTRFEED_FEATURE_MAP.md`
Scope: how the major Nostr clients (web + mobile) handle relays, genuine/spam content, post display, and filters; the known issues and fixes from each; a live audit of our own relay server (`135.181.34.164`); how NostrFeed mobile/web compares; and the concrete plan for the "valuable content" engine + the in-flight post/filter patch.

---

## 1. TL;DR

**What the ecosystem learned the hard way (and where we stand):**

| Lesson | Ecosystem answer | Our status |
|---|---|---|
| Client-side fan-out to 8–15 relays doesn't scale (battery, REQ bursts, "too many concurrent REQs") | Hub/aggregation relay (Primal cache) or disciplined outbox model (Gossip/Amethyst) | ✅ **Done** — strfry hub + router, top-K fan-out (K=4), one-shot REQs not replayed |
| Raw engagement counts are trivially botted | Rank on signals expensive to fake: unique engagers, zaps, conversation, WoT distance | ✅ Mostly done — `FeedRanking` (unique engagers, zaps ×1.5, decay, diversity cap); WoT is the gap |
| Spam is a relay problem AND a client problem | Relay write policies (rate limits, junk-kind blocks, paid admission) + client filters (terms, flood, hashtag spam) | ✅ Both layers live — write-policy.py + `content_filter.dart` + `flood_detector.dart` |
| Reports must feed back into the relay boundary | NIP-56 → relay blocklist loop | ❌ **Gap** — we publish NIP-56 but never consume reports into `/etc/strfry/blocklist.txt` (only 4 entries) |
| New users must see content on day one | Hub syncs the community slice; onboarding seeds follows | ✅ Done — but hub author list refreshes **weekly** → new users wait up to 7 days for hub sync (fix: daily) |
| For You ranking must never inflate bots | Personalization **multiplies** an anti-manipulation base score | ✅ Exactly what the current patch does — 4 bugs found & fixed (§10) |
| WebSocket VERIFY is the mobile jank source | Off-isolate parse+verify, bounded channels, backpressure | ✅ Done (ADR-0005 L2, Amethyst PR #2769 pattern) |
| Paid relay = spam-free write lane | nostr.wine / snort.social / our paid.nostrfeed.com | ✅ Live (2100 sats admission) — only 18 events so far; sell it as **write-lane + DM-lane**, not content |

**Top 5 actions (full list in §11):**
1. **Daily** router-author refresh on the relay (new users sync into the hub within 24h, not 7d).
2. Close the **report → review → relay blocklist** loop (client NIP-56 reports are currently write-only).
3. Add **Web-of-Trust distance** as a ranking signal (Vertex-style pagerank over the follow graph — the one big signal we lack).
4. Enable **NIP-50 search** on the hub (or document the fallback path — neither of our relays supports it today).
5. LMDB **hot backup** of the 14 GB strfry DB (no backup exists; single box, single copy).

---

## 2. Method

- **Live server audit** (read-only SSH, `root@135.181.34.164`, hostname `nostr-relay`): services, NIP-11 documents, nginx vhosts, strfry/nostream configs, `nostr-relay status|stats`, DB sizes, listening ports.
- **Codebase review**: `flutter_app/lib` (feed notifier, ranking, personalization, moderation, relay pool, sync), root `src/` web app, `git diff HEAD` of the uncommitted patch (17 files).
- **Public sources**: client repos/docs and engineering write-ups — Very Good Ventures × diVine ("Building on Nostr: Real Engineering Challenges", 2026-03), OpenSATS "Advancements in Nostr Clients", Primal caching service repo, Nostr WoT/Vertex, Umbrel relay app, NIPs 11/42/43/50/65/77, plus long-standing public incidents (Damus × Apple, spam waves).

---

## 3. Client case studies

### 3.1 Primal (web / iOS / Android) — the hub model we already follow

- **Architecture**: clients talk to **Primal's server-side caching service** (open-sourced 2024, `PrimalHQ/primal-caching-service`) which connects to a fixed relay set, ingests everything relevant in real time, and serves the app fast filtered views. Trending/scoring computed **server-side**; the client is thin.
- **Why it matters to us**: it is the exact pattern of our `relay.nostrfeed.com` hub + strfry router (§6). Independent validation that "one socket per client, relay syncs backend-side" is the production answer — Primal's UX speed is its main selling point.
- **Post display we borrowed**: Primal grid post card, media gallery (`MaxDisplayImages = 4`, 2×2 + "+N"), compact profile cover (140 dp + overlap), new-posts pill with avatar stack, zap preset grid (👍21 🚀420 ☕1k 🍻5k 🍷10k 👑100k), flat chat bubbles with sender tails. All mirrored in `flutter_app` (see AGENTS.md design sections).
- **Issues seen**: centralization criticism (Primal cache = single view of the network); app bars that stack >3 trailing icons read cluttered (we follow their ≤3 rule).

### 3.2 Amethyst (Android) — the outbox purist + client-side anti-spam lab

- **Relay handling**: strict NIP-65 outbox model — per-author relay routing; OpenSATS reports Amethyst can hold **~1000 relay associations** over mobile data by being lazy and disciplined about what stays open. Parallel signature verification moved off the UI thread (PR #2769 — the same fix as our `relay_frame_processor.dart`).
- **Genuine content**: layered client filters — excessive-hashtag hiding (our `-comm-anchor` rule mirrors `hasExcessiveHashtags`), new/low-effort account quieting, per-user mute lists (NIP-51), and **Web-of-Trust scores** in recent versions (distance from your follow graph decides visibility).
- **Compliance**: published Child Safety Standards (`PRIVACY.md`) — the Play-store template we follow with NIP-56 child-safety-first reporting.
- **Lesson**: outbox purity works but is a battery/REQ budget the hub model sidesteps; their *filters* are the part worth copying (§9 roadmap R2/R3).

### 3.3 Damus (iOS) — mainstream polish + two famous platform fights

- **Apple × zaps (Jun 2023)**: Apple threatened removal unless Damus stopped allowing zaps **on posts** (treated as digital-content tipping outside IAP). Damus removed note-level zaps, kept profile-level. *Lesson for us:* our zap flow is Lightning-address/NWC based and not an IAP substitute — but keep zap UI on **content as "send sats to the author"** (P2P payment framing), never "unlock content", to stay clear of the same rule on App Store review.
- **China App Store removal (Feb 2023)**: pulled two days after approval on regulator demand — decentralization is the feature AND the risk; keep web + direct-APK channels alive.
- **DM spam waves (2023–24)**: NIP-04 spam forced "DM requests" (unknown senders quarantined). NIP-17 gift wraps + requests are now the norm — we have gift wraps; a **requests-style quarantine for unknown senders** is a cheap UX win (roadmap R6).

### 3.4 Gossip (desktop, Rust) — the outbox pioneer

- Mike Dilger's client: one "minion" connection per relay actually needed, relay hints on every tag, aggressive NIP-65 hygiene, authored the `purplepag.es` **profiles-only relay** pattern (kind 0/3/10002 indexers). Gossip proves the outbox model end-to-end — and also shows its cost (complexity, connection churn). Our compromise: hub-first, outbox only as the T3 ad-hoc escape hatch (bounded ≤4).

### 3.5 Coracle (web, hodlbod) — WoT filtering + relay transparency

- Coracle productized **Web-of-Trust filtering** (show/hide by graph distance), per-relay health/provenance UI, groups, and later moved to a **local-first SQLite store with set-reconciliation sync** — i.e. our ADR-0007/ADR-0008 direction. Strong evidence our in-app-relay + negentropy roadmap is where the good web clients also ended up.

### 3.6 Nostur (iOS/macOS) — speed + WoT + "hot" feeds

- Fast native client; WoT filtering for threads/notifications, "hot" ranking tab, unread tracking across feeds. Confirms the demand for a **ranked-but-honest** tab next to chronological ones — our For You / Following / Global split matches the shape users now expect.

### 3.7 Iris, Snort, Nostrudel (web) — three reference points

- **Iris**: web-first with social-graph/WoT features and big-media cards; showed web clients can feel native.
- **Snort**: early popular React client; ran one of the first **paid relays** (snort.social) — evidence the paid-relay lane we operate has precedent and demand.
- **Nostrudel**: feature-lab client (local WASM relay experiments, deep NIP coverage) — watch it for what power users will ask for next.

### 3.8 diVine × Very Good Ventures (Flutter) — the checklist we already satisfy

Their 2026 engineering write-up lists the structural client problems and answers: dedicated connection manager (✅ our `relay_pool`), lazy connections (✅ top-K + tiers), local DB as primary source with stale-while-revalidate (✅ EventStore + store-first paint), created_at conflict resolution + upsert-on-newer (✅ NIP-01 lifecycle), publish to ≥3 relays with ack confirmation (⚠️ we publish hub-first + outbox hints — ack tracking exists via `publishWithAck` + outbox retry), key-backup prompts at natural pause points (✅ onboarding), honest "delete = request" labeling, and client-side moderation layers (✅). **The one we should steal:** their scatter-gather "render the best result after a short timeout, keep merging late responses" — already our "good-enough query completion".

### 3.9 Yakihonne / 0xchat / Vector — worth noting

- **Yakihonne**: best-in-class long-form (kind 30023) article UX + smart widgets — our `ArticleCard` + reader follows the same NIP-23 shape.
- **0xchat / Vector**: the de-facto typing-indicator convention (ephemeral kind) we implemented, and read-receipt-via-rumor patterns similar to our kind-15 empty-content receipts.

---

## 4. Relay-side case studies

### 4.1 Relay software landscape (what production operators run)

| Software | Lang | Used by | Notes |
|---|---|---|---|
| **strfry** | C++/LMDB | our free hub, many big relays | Fastest; built-in `router` + `sync` (negentropy); write-policy plugins |
| **nostream** | TS/Postgres | our paid relay | NIP-rich, payment/admission hooks, easier policy code |
| nostr-rs-relay | Rust/SQLite | small relays | Largely unmaintained today — avoid for new deploys |
| khatru | Go framework | custom relays | Best for bespoke policy logic (fiatjaf ecosystem) |
| nostr-relay (python) | Python | small/custom | Broad NIP coverage, easy policies |

Our two-relay split (strfry for the high-throughput free hub, nostream for the policy-heavy paid lane) matches what the ecosystem converged on.

### 4.2 Spam waves → the mitigations that actually worked

| Wave | Shape | What fixed it |
|---|---|---|
| "GM" reply bots (2023) | identical replies from fresh keys | client new-account filters; reply requests |
| NIP-04 DM spam (2023–24) | unsolicited DMs at scale | DM requests quarantine; **NIP-17 gift wraps**; inbox relays (kind 10050) |
| Phishing replies ("claim airdrop") | links under every popular note | link-host heuristics, WoT distance, hide-unfollowed-sender replies |
| Hashtag hijack bots (2024–25) | anchor tags planted in feeds (our `#…-comm-anchor` case) | excessive-hashtag + hashtag-only-post hiding (Amethyst; our filter) |
| Token/ecash + QR-image spam (2025) | `cashu` dumps, QR image spam hosts (our bala-offer floods) | flood/spray/rapid-fire detection (our `flood_detector`), encrypted-payload cards |
| Relay write floods | junk kinds, huge events | relay write policies: rate limits, junk-kind blocks, content caps (our write-policy.py) |
| Sybil engagement | 50-key like clusters | unique-engager ranking (our `FeedRanking`), WoT, zaps (cost signal) |

**The durable lessons:** (1) free writes will always be abused — rate-limit + junk-filter at the relay, (2) **paid admission is the strongest write-side filter** (nostr.wine, snort.social, our paid relay), (3) client filters are the last mile and must be multi-signal, (4) **zaps are the best "genuine" signal** because they cost money.

### 4.3 Indexer & special-purpose relays

- `purplepag.es` pattern: profiles-only relays (kinds 0/3/10002) — cheap to run, perfect as profile/indexer fallback. Our router already syncs kind 10002 (65,465 events) — consider a dedicated indexer leg later.
- nostr.band-style search relays: NIP-50 search + stats APIs — **note: relay.nostr.band has been offline long-term; never re-add it** (already excluded from our fleet).
- Paid relays as **membership lanes**: NIP-43 membership metadata + NIP-86 relay-management APIs are the emerging admin surface (worth tracking for our paid relay ops).

### 4.4 Negentropy reality check

Public relays (damus, nos.lol, nostr.mom) **disable NIP-77 server-side** to stop abuse — set reconciliation only works against our own strfry instances (house ↔ in-app relay). Our ops doc already records this; every new sync idea must assume public relays are REQ/EVENT-only.

---

## 5. Cross-client patterns that won (synthesis)

**Relay handling**
1. One hub socket per client + relay-side sync (Primal, us) **or** strict outbox with lazy connections (Gossip, Amethyst) — never naive fan-out.
2. Per-relay health scoring + circuit breaking + exponential backoff with jitter (our `RelayHealthTracker` EWMA, tiered T0–T3).
3. One-shot REQs are never replayed on reconnect; persistent subs are re-issued (our fix for the "too many concurrent REQs" storm).
4. Author-list chunking against relay filter caps (strfry `maxReqFilterSize = 200`; our 150-chunks).
5. Bounded in-flight work everywhere: backpressure watermarks, ingest batching, top-K fan-out.

**Genuine content (the "valuable feed" stack)**
1. Hard moderation first (hide/warn verdicts) — popularity never overrides safety (both ours and Amethyst's rule).
2. Rank on expensive-to-fake signals: **unique engagers ≫ replies > zaps (money) ≫ raw likes**; freshness decay; per-author diversity caps.
3. Personalization **re-orders, never inflates**: boosts multiply the anti-manipulation base (our patch's exact design).
4. WoT distance is the strongest ecosystem signal we don't have yet (Coracle/Nostur/Vertex/Amethyst all converged on it).
5. Zaps = value4value: weight them up (Primal's zap-centric culture; our ×1.5).

**Post display / filters**
1. Reply-hiding in main feeds (replies live in threads) — universal now; we do it at the SQL layer.
2. Quote cards, thread connectors, media galleries with aspect-preserving imeta, NIP-36 warning covers — all mirrored.
3. Empty/blank cards collapse entirely (media-only posts render media-only) — we fixed the whole family.
4. "Seen on relays" provenance UI (Amethyst) — we already store `seen_on`; surfacing it is a small, differentiating win (roadmap R5).
5. Honest timestamps (arrival time for NIP-17), future-clamping for ordering — done.

---

## 6. Our production relay audit (2026-10-27, `root@135.181.34.164`)

### 6.1 What's running

| Piece | Status | Details |
|---|---|---|
| **Free hub** `wss://relay.nostrfeed.com` | ✅ strfry 1.1.1 (systemd, 1d2h uptime, 3.1 GB RSS) | `127.0.0.1:7777`; negentropy=1; NIPs 1,2,4,9,11,17,28,29,40,42,44,45,51,57,59,65,70,77; **no NIP-50** |
| **Paid relay** `wss://paid.nostrfeed.com` | ✅ nostream 3.0.0 (Docker, 28h) | `127.0.0.1:8008`; admission 2,100 sats; NIP-42 auth; `payment_required:true`; reads open; **no NIP-50** |
| Sync | ✅ `strfry-router.service` | pulls authors+mentions from `relay.damus.io` + `nos.lol` (2000 community authors, 8×250 chunks), `pushLocal` up-stream, `pullPaid` from the paid relay |
| Protection | ✅ | write-policy.py (junk kinds, 90d reject, 100 KB/500-tag caps, 60 ev/min/pubkey + 120/min/IP), nginx `limit_conn 50`, blocklist **4 pubkeys** |
| Data | ✅ | strfry DB **14 GB** LMDB; disk 34% used (48 GB free); **90 established client connections** |
| Ops | ✅ | `nostr-relay status/stats/analytics/purge/sync/health`; cron: weekly purge, weekly router-author refresh (Sun 04:40), negentropy 6h, daily analytics |
| Geo API | ✅ | `GET relay.nostrfeed.com/api/geo` → `{"country":"IN"}` (127.0.0.1:8787, ip-api.com behind 7d LRU, 10 req/min) |
| LN stack | ✅ | LNbits :5000 (`ln.nostrfeed.com`), phoenixd :9740 + dashboard, Cashu mint :3338 (`mint.nostrfeed.com`), getzap-studio |

Event totals (hub): kind 0: **46,354** · kind 1: **124,689** · kind 3: 4,555 · kind 6: 59,071 · kind 7: **181,570** · kind 9735: 1,493 · kind 10002: 65,465 · kind 30023: 242 · 30315: 0 (blocked). Retention works (>90d counts tiny). **Paid relay: 18 events.**

### 6.2 Gaps found (ranked)

1. **Weekly author-list refresh is too slow for growth** — a user who joins Monday waits up to 7 days before the hub syncs *their* authors' content (fallbacks paper over it, but the hub is the product). → daily cron, or trigger regeneration when a new local kind-0/3 lands.
2. **No report→blocklist loop** — clients publish NIP-56 reports to relays; nothing aggregates them into `/etc/strfry/blocklist.txt` (stuck at 4 entries) or the write-policy. → nightly job: count kind-1984 reports per pubkey, auto-block past threshold with a human review queue.
3. **No NIP-50 search on either relay** — client search falls back to local FTS5 + fallback relays. Fine short-term; document it, or front the hub with a search-capable companion.
4. **Only 2 upstreams** (damus, nos.lol) in router pulls — one outage shrinks the community slice. → add 1–2 upstreams (measure before/after sync lag).
5. **No LMDB backup** — 14 GB, single copy, single box. → weekly `mdb_copy` hot backup + offsite copy; test a restore.
6. **Paid relay is an empty lane (18 events)** — expected (write-gated), but market it as *spam-free write lane + premium DM lane*, never as "more content" — and keep `pullPaid` propagating paid posts to the hub (already working).
7. **Monitoring is pull-only** (`nostr-relay analytics`) — add alerting on router stream liveness + strfry memory (peak 4.1 GB) so a dead upstream page us, not users.

---

## 7. Our Flutter app vs the ecosystem

**Already at/past ecosystem best practice** (verified in code, not just docs):
hub-model relay fleet with tiers + EWMA health + top-K fan-out · off-isolate verify + backpressure · local-first SQLite with WAL + single-writer lane · batched ingest + per-table invalidation bus · store-first paint everywhere · reply filtering in SQL · future-clamp ordering · direction-aware window cap · NIP-57 receipt validation before counting zaps · NIP-17 DMs with arrival-time honesty + durable outbox · typing indicators + read receipts (0xchat-style) · flood/spray/rapid-fire detector · multilingual content filter (30+ languages, homoglyph fold) · NIP-36/51/56 compliance · offline publish outbox · negentropy with upload half + Wi-Fi-only toggle · 27.9 MB size budget.

**Gaps vs the ecosystem leaders:**
1. **No WoT distance signal** (Coracle/Nostur/Amethyst/Vertex all have it) — the single highest-value ranking addition (§9 R2).
2. **No "seen on relays" provenance UI** — data exists (`seen_on` table), zero UI cost, builds trust (Amethyst parity).
3. **DM requests quarantine** for unknown senders (Damus/Amethyst standard) — we banner all incoming DMs.
4. **New-account quiet mode** (Amethyst: hide/limit very young or profile-less accounts in discovery surfaces) — our flood detector catches bursts, not slow sybil drips.
5. **NIP-32 label consumption** (trusted labelers → warn/hide) — the standardized version of our local term lists; our hub could also *publish* labels.
6. **Paid relay reads open but unknown** — no in-app "you're on the clean lane" indicator beyond the badge; the premium story needs the DM-lane angle (already implemented paid↔paid routing) surfaced in UI.

---

## 8. Web app (`src/`) notes

- Nostrify `NPool` + per-request routing; default relay config lives in `AppContext` with presets (Primal/Ditto/nostr.band/Damus in `README`, but **nostr.band is dead** — the preset list should drop it and add our hub first; the hub-model rewrite in `RELAY_HUB_SYNC_ARCHITECTURE.md §4` (`reqRouter`/`eventRouter` → house-only + 2 fallbacks) is the approved direction and matches what the Flutter app already does.
- `NOSTR_RELAY_BEST_PRACTICES.md` lists health tracking/circuit breakers as ⚠️ TODO — the Flutter side solved these; port the tiered/EWMA model into the web pool rather than inventing a second design.
- Paid relay mirrors: `src/lib/paidRelay.ts` ↔ `AdmissionService` (keep these two parsers in lockstep — they already are).

---

## 9. "Valuable content" strategy — how we give users a feed worth opening

**Definition (operational):** a post is valuable to a user if it is (a) *safe* (passes hard moderation), (b) *genuine* (engagement is expensive to fake), (c) *relevant* (matches the user's people/topics/language/place), and (d) *fresh* (recency with decay). Everything we rank is a proxy for those four.

**The engine we have today** (this is already ahead of most clients):
- Hard layer: `ContentFilter` verdicts (hide/warn) + flood detector — applied **before** ranking, never overridden by popularity.
- Genuine layer: `FeedRanking.trendingScore` = unique engagers ×1.0 + replies ×0.5 + capped/discounted raw + **zaps ×1.5** × HN-style decay × per-author diversity penalty.
- Relevance layer: `personalizationBoost` = followed ×2.6 · engaged-author ×1.8 · interest-tag ×1.7 · country-tag ×1.35 · readable-script ×1.5 · unreadable-script ×0.45 (rank down, never hide) — **multiplied onto the genuine score, so personalization re-orders genuine content instead of inflating bots.**
- Delivery layer: hub-synced candidate pool (3× page), local engagement index (`COUNT(DISTINCT pubkey)`), ranked store paint on cold start, 40/60 followed/discovery blend, per-author cap 3.

**Roadmap (ecosystem-benchmarked):**

| # | Addition | Why (who proved it) | Effort |
|---|---|---|---|
| R1 | **Daily router-author refresh** (+ trigger on new local kind-0/3) | hub freshness IS content value (Primal cache freshness) | S (server) |
| R2 | **WoT distance score** (pagerank over kind-3 graph from the hub; publish as signed API or kind-10032-ish snapshot; client uses distance as a multiplier + a "2+ hops" discovery filter) | Vertex, Coracle, Nostur, Amethyst | M |
| R3 | **New-account quiet mode** (age < N days + no kind-0 → hide from For You/Trending, still in Global) | Amethyst new-user filters | S |
| R4 | **Report→relay blocklist loop** (+ count reports as a negative ranking signal locally) | every relay operator; Play/Apple UGC rules | M |
| R5 | **"Seen on N relays" chip** + relay provenance in the event debug sheet | Amethyst | S |
| R6 | **DM requests** (unknown senders → requests bucket, no banner) | Damus/Amethyst | M |
| R7 | **NIP-32 labels**: consume our hub's labels (warn/hide), let trusted community labelers in later | NIP-32 ecosystem | M–L |

**Non-negotiables to keep while iterating:** multilingual content is never filtered by script alone (rank-down only); non-Latin users are first-class; personalization signals never leave the device (country via our geo endpoint only); zaps counted only after NIP-57 receipt validation.

---

## 10. The in-flight post+filter patch — analysis + fixes applied

**Patch reviewed** (uncommitted, `git diff HEAD`): 17 files, ~1,279 insertions — DM realtime receipts/typing (chat) + **For You feed changes** (the "post and filter" part):

1. `engagementFor(..., includeUniques: true)` — ranking now gets `COUNT(DISTINCT pubkey)` per candidate (one extra grouped SQL query) — **correct**: unique engagers is the anti-manipulation input the ranking was designed for.
2. Follow/unfollow → `ref.invalidate(personalizationProvider) + refresh()` on For You — **correct**: follows are a ranking input (×2.6 + the 40% mix).
3. 1.5 s init stagger for For You — **directionally correct** (three tabs initializing at once flooded the serialized sqflite queue) but see Fix 1.
4. Pill posts re-ranked with personalization before merging — **correct idea**, two bugs (Fix 2/3).

**Fixes applied in this session** (`feed_notifier.dart`):

| # | Bug in the patch | Fix |
|---|---|---|
| F1 | **Fresh-install regression**: the 1.5 s stagger ran even when the store paint was empty — a brand-new user stared at a skeleton 1.5 s longer on the default tab. The comment's assumption ("store paint is already on screen") is false on first run. | Stagger only when the store paint actually produced events (`cached.isNotEmpty`). |
| F2 | **Pill dropped posts**: `showNewPosts` reused `_rankCached`, which truncates to `_pageSize` — a full pill (up to 100 pending) silently lost up to ~80 posts from the merge (they survive in SQLite, but the tap appeared to do nothing for most of them). | `_rankCached` takes a `limit` parameter; `showNewPosts` passes `pending.length`. |
| F3 | **Async state race**: the ranked pill merge ran in `.then(...)` with no lifecycle guard — setting `state` after dispose/invalidate would throw. | Guard with `ref.mounted` before touching state. |
| F4 | Duplicated `EventCounts → EventEngagement` mapping in both ranking paths | Extracted `_engagementFromCounts` helper; both paths use it. |

**Left as-is (documented trade-offs, not bugs):** per-page ranking windows (page boundaries are rank discontinuities — X does the same); the 40/60 followed/discovery ratio (tunable later); the 1.5 s value itself (heuristic, matches the sqflite-lock incident).

---

## 11. Prioritized action checklist

**P0 (this week)**
- [ ] Server: router-author refresh → daily cron (+ regenerate on new local kind-0/3).
- [ ] Server: LMDB hot backup (`mdb_copy`) + offsite copy; document restore.
- [x] App: patch fixes F1–F4 (this session) + `flutter analyze`/`flutter test` green.

**P1 (next 2 weeks)**
- [ ] Server: report→blocklist nightly job + review queue (R4).
- [ ] App: new-account quiet mode in For You/Trending (R3).
- [ ] App: "seen on N relays" chip (R5).
- [ ] Web: drop nostr.band preset, hub-first routing, port tiered/EWMA health (§8).

**P2 (this quarter)**
- [ ] WoT distance service + client multiplier (R2).
- [ ] DM requests quarantine (R6).
- [ ] NIP-50 on the hub (or documented companion relay) (§6.2.3).
- [ ] Router upstreams +1–2 with sync-lag alerting (§6.2.4/7).
- [ ] NIP-32 label consumption, hub-published labels later (R7).

---

*Audit performed read-only over SSH; no server state was modified. Public-source claims are as of 2026-10-27 — re-verify before quoting externally.*
