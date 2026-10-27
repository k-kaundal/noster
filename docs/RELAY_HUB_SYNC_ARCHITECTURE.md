# Relay Hub Architecture — Client Connects to Our Relay Only, Relay Syncs Backend-Side

Status: **analysis + design (2026-10-26)**
Related: `ADR-0007-in-app-relay.md`, `NOSTR_RELAY_BEST_PRACTICES.md`, `src/contexts/AppContext.ts` (`HOUSE_RELAY = wss://relay.nostrfeed.com`)

---

## TL;DR — Yes, this is 100% possible and it is a standard Nostr pattern

**The question:** can our Flutter/web clients connect **only** to our own relay
(`wss://relay.nostrfeed.com`), and have **our relay** fetch/publish events
to/from the rest of the network (nos.lol, relay.damus.io, …) on the
**backend**, instead of the client fanning out to many relays itself?

**Answer: yes.** The Nostr protocol is **symmetric** — the exact same
WebSocket protocol that a client speaks to a relay, a relay can speak to
another relay. A relay that does this is called an **aggregation relay**,
**hub relay**, or **relay sync**. There is no protocol change needed, and
production-grade tools already exist (strfry router, khatru, nostr-filter).

```
┌─────────────────────────────────────────────────────────────────┐
│  BEFORE (today — client-side fan-out)                           │
│                                                                 │
│  Client ──┬── wss://relay.nostrfeed.com                         │
│           ├── wss://nos.lol                                     │
│           ├── wss://relay.damus.io                              │
│           └── wss://... (5–8 sockets per client)                │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  AFTER (hub model — relay-side sync)                            │
│                                                                 │
│  Client ──── wss://relay.nostrfeed.com   (1 socket per client)  │
│                     │                                           │
│                     │  backend sync (relay-to-relay)            │
│                     ├── wss://nos.lol          (pull + push)    │
│                     ├── wss://relay.damus.io   (pull + push)    │
│                     └── wss://relay.primal.net (pull + push)    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 1. How it works (the mechanism)

A relay is just a WebSocket endpoint that speaks NIP-01. So our relay (or a
companion daemon next to it) acts in **two directions**:

### 1.1 Inbound sync (pull) — remote relays → our relay

Our relay opens **client-style subscriptions** to the upstream relays:

```jsonc
// our relay → wss://nos.lol
["REQ", "upstream-sync", {
  "kinds": [0, 1, 3, 6, 7, 9735, 30023],
  "authors": ["<pubkeys of our users>", ...],   // ← scoped, see §3
  "since": 1761000000
}]
```

Every `EVENT` that comes back is:
1. **Verified** (signature + id — never trust upstream blindly),
2. **Deduped** by event id (same event arrives from N relays),
3. **Written into our relay's database** as if a local client had published it.

From that moment on, any client that REQs our relay gets those events from
**our** storage. Clients never talk to the upstream relays.

### 1.2 Outbound sync (push) — our relay → remote relays

When one of our clients publishes an event to `relay.nostrfeed.com`:

1. Our relay stores it + serves it to local subscribers (normal relay behavior).
2. The sync layer **re-broadcasts** it to the upstream relays:

```jsonc
// our relay → wss://relay.damus.io
["EVENT", { "id": "…", "pubkey": "…", "kind": 1, … }]
```

3. `OK` responses from upstreams are tracked so we can retry on failure and
   report "sent to 4/5 relays" health.

### 1.3 Two sync modes

| Mode | What | When |
|---|---|---|
| **Backfill** | REQ with `since`/`until` windows to fetch history | On boot, after downtime, for a newly-followed pubkey |
| **Live tail** | Open-ended REQ (no `until`) kept alive 24/7 | Continuous — this is the steady state |
| **Negentropy (NIP-77)** | Set-reconciliation: exchange only the *difference* of event-id sets | Efficient periodic re-sync; `NEG-OPEN`/`NEG-MSG` (same messages ADR-0007 already specifies for the in-app relay) |

---

## 2. Implementation options

Three realistic ways to build it, ordered by effort:

### Option A — strfry + `strfry router` (recommended, zero code)

[strfry](https://github.com/hoytech/strfry) is the fastest production relay
(used by relay.nostr.band-style operators) and ships a **built-in sync
daemon**: `strfry router`.

```js
// router.config — declarative relay-to-relay sync
{
  "relays": {
    "wss://nos.lol":          {},
    "wss://relay.damus.io":   {},
    "wss://relay.primal.net": {}
  },
  "streams": {
    // PULL: download matching events from upstreams into our DB
    "in": {
      "dir": "down",
      "filter": { "kinds": [0,1,3,6,7,9735], "since": <ts> },
      "relays": ["wss://nos.lol", "wss://relay.damus.io"]
    },
    // PUSH: upload our local events upstream
    "out": {
      "dir": "up",
      "filter": {},  // everything our users publish
      "relays": ["wss://nos.lol", "wss://relay.damus.io"]
    }
  }
}
```

```bash
strfry router --config router.config   # runs as a systemd service
```

- Battle-tested, C++, LMDB storage, handles dedup + reconnection itself.
- Also supports `strfry stream wss://nos.lol --dir both` for one-off syncs.
- **This is the fastest path to production.** The relay binary is the same
  one already documented in ADR-0007 as the reference implementation.

### Option B — custom Dart sync daemon (fits our stack)

Since our Flutter app already uses `nostr_nips`, we can write the sync
daemon in Dart with the same package. Run it next to any dumb relay
(nostream, strfry, nostr-rs-relay) that just stores what it's given:

```dart
// relay_sync daemon — Dart, runs on our server
import 'package:nostr_nips/nostr_nips.dart';

Future<void> main() async {
  // 1. Connect upstreams (pull side)
  final upstream = RelayPool([
    'wss://nos.lol',
    'wss://relay.damus.io',
    'wss://relay.primal.net',
  ]);
  await upstream.connectAll();

  // 2. Connect our own relay (push side) with auto-reconnect
  final home = ReconnectingRelay('wss://relay.nostrfeed.com');
  await home.connect();

  // 3. PULL: upstream events → write into our relay
  upstream.messages.listen((msg) {
    if (msg.message case EventMessage(:final event)) {
      if (verifyEvent(event)) home.sendEvent(event);  // dedupe happens relay-side
    }
  });

  // Scoped subscription — only our community's traffic (see §3)
  upstream.subscribe([
    Filter(kinds: [0, 1, 3, 6, 7, 9735], authors: communityPubkeys),
    Filter(kinds: [1, 6, 7], p: communityPubkeys),   // replies/mentions
  ]);

  // 4. PUSH: our users' new events → broadcast upstream
  home.subscribe([Filter(since: DateTime.now().millisecondsSinceEpoch ~/ 1000)]);
  home.messages.listen((msg) {
    if (msg.message case EventMessage(:final event)) {
      upstream.sendEvent(event);
    }
  });
}
```

- `ReconnectingRelay` gives exponential backoff + **subscription replay** on
  reconnect for free; `RelayPool` handles multi-upstream fan-out + dedupe.
- Deploy as a `systemd` unit / Docker container next to the relay.
- Full control over scoping rules, metrics, and which events get mirrored.

### Option C — proxying relay (khatru / nostr-filter)

- **khatru** (Go): a relay framework with ready-made proxy/aggregation
  examples — queries that miss local storage are fetched from upstream
  relays on demand ("just-in-time" sync).
- **nostr-filter**: a filtering reverse proxy that sits in front of a real
  relay.
- More moving parts; only worth it if we need on-demand (unscoped) fetching.

### Comparison

| | A: strfry router | B: Dart daemon | C: khatru proxy |
|---|---|---|---|
| Code to write | none (config) | ~150 lines Dart | Go service |
| Maturity | production | our code | production |
| Custom scoping logic | filter JSON only | full freedom | full freedom |
| Fits Flutter/Dart stack | no | **yes** | no |
| Negentropy (NIP-77) | yes | manual | partial |
| JIT/on-demand fetch | no | possible | yes |

**Recommendation: start with A** (strfry router) to get the hub live this
week; keep B as the evolution path when we need app-aware scoping
(e.g. "sync the follow-graph 2 hops deep", per-user filters).

---

## 3. The critical design decision: what to sync (scoping)

Mirroring *all* of Nostr is datacenter-scale (TBs, millions of events/day) —
ADR-0007 already says "don't build a Primal cache". The hub must sync a
**bounded slice**:

| Scope rule | Why |
|---|---|
| `authors`: our registered users | Their notes reach each other and the world |
| `p`-tags mentioning our users | Replies, mentions, zaps *to* our users arrive back |
| `e`-tags of our users' events | Thread context |
| kinds: 0, 1, 3, 6, 7, 9735, 30023 (+ app kinds) | Profiles, notes, follows, reposts, reactions, zaps, long-form |
| Follow-graph of our users (NIP-02 crawl, 1–2 hops) | Their feeds render without touching upstream |
| NIP-65 relay lists of our users | Know where *their* followers actually read |

Anything outside the slice can be fetched **on demand** (client REQs our
relay → relay doesn't have it → relay queries upstream once → caches →
answers). This "cache-miss fetch" keeps the DB small while staying a full
view of the network.

---

## 4. Client-side changes (small)

Today the client fans out to 5–8 relays (`NOSTR_RELAY_BEST_PRACTICES.md`).
In the hub model:

```typescript
// src/contexts/AppContext.ts
const pool = new NPool({
  open: (url) => new NRelay1(url, { reconnectTimeout: 5000, maxReconnectTime: 60000 }),
  reqRouter: (filters) => new Map([[HOUSE_RELAY, filters]]),   // read: house only
  eventRouter: (event) => [HOUSE_RELAY],                        // write: house only
});
```

- Keep **2 public fallback relays** (nos.lol, relay.damus.io) used *only* if
  the house relay is unreachable — graceful degradation, same principle as
  the existing health-monitor docs.
- Everything else in the best-practices doc (exponential backoff, circuit
  breaker) still applies — it just runs against one endpoint.

### What clients gain

| Benefit | Why |
|---|---|
| 1 socket instead of 8 | Battery + bandwidth on mobile (ADR-0007's core motivation) |
| Warm data | Relay already has the slice → instant feed loads, no EOSE roulette |
| Consistent view | One deduped timeline instead of N partial ones |
| Privacy | Client IP only ever seen by our relay |
| Moderation point | We can filter spam/illegal content at our relay boundary (NIP-32 labels) |
| Paid-relay ready | `VITE_PAID_RELAY` hooks in `.env.example` become natural — the house relay *is* the product |

### Honest trade-offs

| Cost | Mitigation |
|---|---|
| House relay = single point of failure | Fallback relays on client; run relay HA (2 nodes + negentropy between them) |
| Server bandwidth/storage bill | Scoping (§3) + retention policy; still ~100× cheaper than Primal-scale mirroring |
| Write propagation latency (client → house → upstream) | Async push with `OK` tracking; show "published ✓" on house OK, "reached network ✓" later |
| If our scoping misses an event, user doesn't see it | Cache-miss on-demand fetch (§3) closes the gap |
| We become responsible for relay ops 24/7 | Monitoring: upstream connection health, sync lag, storage, `OK` rates |

---

## 5. Relationship to ADR-0007 (in-app relay)

These are **complementary, not competing**:

- **Hub relay (this doc)** — server-side, always-on, holds the community
  slice, clients connect over WAN.
- **In-app relay (ADR-0007)** — on-device, holds the *personal* slice,
  serves the local UI even offline, syncs upstream.

The natural end-state: **the in-app relay syncs against our hub relay
only** (one upstream, NIP-77 negentropy between them), and the hub relay
syncs against the public network. Two layers, each with a bounded job:

```
public relays ⇄ hub relay (relay.nostrfeed.com) ⇄ in-app relay ⇄ Flutter UI
   (Option A/B)        (NIP-77, one connection)      (ADR-0007)
```

---

## 6. Rollout plan

1. **Phase 1 — pull-only hub** (this week, Option A): strfry + router,
   `dir: down` streams for our user pubkeys. Clients keep current multi-relay
   behavior but get house-relay priority (already implemented via
   `withPrimaryFirst`). Verify sync lag + dedup.
2. **Phase 2 — push path**: add `dir: up` stream; client writes stay
   multi-relay but house-first; monitor upstream `OK` rates.
3. **Phase 3 — client cutover**: `reqRouter`/`eventRouter` → house-only +
   2 fallbacks. Measure: socket count, feed load time, publish latency.
4. **Phase 4 — cache-miss fetch + negentropy**: on-demand upstream queries
   for out-of-scope events; NIP-77 re-sync to heal after downtime.
5. **Phase 5 (later)** — replace strfry router with the Dart daemon
   (Option B) if/when we need app-aware scoping; hook into ADR-0007 in-app
   relay as its single upstream.

---

## 7. DEPLOYED (2026-10-26) — current production state

Implemented on `root@135.181.34.164` (hostname `nostr-relay`). This section is
the living record of what is actually running.

### House relay `relay.nostrfeed.com` (strfry 1.1.1)

| Piece | Where | What it does |
|---|---|---|
| Write-policy plugin | `/usr/local/lib/strfry/write-policy.py` | Blocks junk kinds (30315), rejects >90d events, caps content 100KB / 500 tags, **rate-limits 20 ev/60s per pubkey + 120 ev/60s per IP** (client writes only; router/sync exempt), pubkey blocklist hot-reload |
| Pubkey blocklist | `/etc/strfry/blocklist.txt` | One hex pubkey per line, reloaded every 60s, no restart |
| Retention | `/etc/strfry.conf` `rejectEventsOlderThanSeconds = 7776000` | 90-day write-time retention |
| Relay-to-relay sync | `strfry-router.service` → `/etc/strfry-router.conf` | Scoped sync: **2000 active community authors** (8 chunks ×250) + their `#p` mentions, `pushLocal` up-stream to damus/nos.lol, `pullPaid` from paid relay |
| Negentropy (NIP-77) | enabled (`negentropy:1` in NIP-11) | Works house ↔ in-app relay (ADR-0007, both strfry). NOTE: damus/nos.lol/nostr.mom return "negentropy disabled" — public-relay catch-up is via the router, not negentropy |

### Paid relay `paid.nostrfeed.com` (nostream, Docker)

- Admission: 2100 sats via LNbits, NIP-05 restricted to `getzap.me`/`ln.nostrfeed.com`
- Writes payment-gated; **reads open** (`nip42.authRequired:false`, DMs kinds 4/1059 still restricted)
- Kind blacklist: 30315, 1984, 10009 (junk kept out of the paid DB)
- `pullPaid` router stream propagates paid users' public posts → house → public network

### Protection

- nginx `limit_conn relayconn 50` per IP on both relay vhosts (429 on excess)
- strfry write-policy rate limits (above)

### Management & analytics

| Command | Purpose |
|---|---|
| `nostr-relay status` | services, disk, DB size, connections, paid events |
| `nostr-relay stats` | event counts by kind (total / >90d) |
| `nostr-relay analytics` | daily snapshots table (events, active authors 24h/7d, DB GB, paid) + top kinds + sync runs |
| `nostr-relay purge` | run retention purge now |
| `nostr-relay sync` | regenerate router authors + restart router |
| `nostr-relay health` | NIP-11 both relays |

Cron (`/etc/cron.d/nostr-relay`): weekly purge (Sun 04:10), weekly router-author
refresh (Sun 04:40), negentropy reconcile every 6h, daily analytics snapshot (05:00).
Analytics DB: `/var/lib/nostr-analytics/analytics.sqlite`.

### Ops note — sync kind coverage + write rate limit (2026-10-26b)

**Kind coverage**: the router sync filter now covers every kind the NostrFeed
app renders (validated against the repositories):
`0,1,3,4,6,7,14,15,16,1059,1068,1111,1311,4550,30023,30311,31922,31923,31925,34550,39002,9735`
— posts/profiles/contacts/reposts/reactions/long-form/zaps + DMs + polls +
communities + calendar + live + group chat. Without this, high-kind features
(live streams, polls, communities) only loaded from the 2 fallback relays.
`pushLocal` (up-stream) widened to match so app-kind events publish upstream.

**Write rate limit**: per-pubkey raised 20 → 60 events/60s. 20/min was
spam-tight but caught legitimate app interaction bursts (post + like +
repost + comment + zap + profile update in one session). IP limit stays 120.
Spam protection unchanged: junk kinds still blocked, 90-day retention,
content/tag caps.

### Ops note — subscription cap (2026-10-26)

The hub model multiplexes an entire app session's subscriptions (feed,
engagement, profiles, notifications, DMs, threads) onto **one** socket where
they were previously spread across ~9 relay sockets. strfry's default
`maxSubsPerConnection = 200` rejected new REQs with a CLOSED error once a
busy session crossed 200 concurrent REQs ("could not fetch" on screen).
Raised to **2000** in `/etc/strfry.conf` (this hub serves our own app; the
value is per-connection, not global). The app also stopped registering
one-shot queries as reconnect-replayed persistent subs (the burst source).

### Geo endpoint (2026-10-27) — country detection for the For You tab

`GET https://relay.nostrfeed.com/api/geo` → `{"country":"IN"}` (ISO 3166-1
alpha-2, or null). Country-level ONLY — never city/lat-lon (personalization
needs a country, not a location; no GPS permission ever requested).

- Service: `geoip-endpoint.service` → `/usr/local/bin/geoip-endpoint.py`
  (tiny Python http server on `127.0.0.1:8787`).
- Upstream: `ip-api.com` (free, 45 req/min) behind a 7-day in-process LRU
  (50k entries) so repeat lookups never hit the upstream.
- nginx: `location = /api/geo` on the relay vhost, `limit_req zone=geo`
  10 req/min per IP (`limit_req_zone` lives in `nginx.conf` http block).
- The relay sees the client's IP anyway (it terminates the websocket) —
  answering "what country is this connection from" adds no new data exposure.

### Key finding — negentropy on public relays

Public relays (damus, nos.lol, nostr.mom) **disable NIP-77** server-side to
prevent abuse, so `strfry sync` negentropy only works against our own strfry
instances (house ↔ future in-app relay). For public relays the **scoped router
streams are the sync mechanism**. This is the correct, working design.

---

## 8. Bottom line

| Question | Answer |
|---|---|
| Is relay-side sync possible? | **Yes** — the protocol is symmetric; relays can be clients of other relays |
| Do clients then only connect to our relay? | **Yes** — reads and writes both work; fallbacks optional |
| Do we need to write a relay from scratch? | **No** — strfry router does it with a config file; a ~150-line Dart daemon with `nostr_nips` is the custom path |
| Is this a known pattern? | **Yes** — aggregation/hub relays, paid relays (nostr.wine), community relays, and Primal's cache all work this way |
| What's the one thing to get right? | **Scoping** (§3) — sync your community's slice, not the whole network |
