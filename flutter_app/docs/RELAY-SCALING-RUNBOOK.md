# Relay Scaling Runbook — `relay.nostrfeed.com` + `paid.nostrfeed.com` to 100k users

**Audience**: ops / infra. This is the deployable capacity plan for the ADR-0008 §9
scale analysis. The CLIENT side is already done (relay tiering, top-K fan-out,
backpressure, connection budget) — this runbook is the SERVER side: how to run
the two NostrFeed relays so 100,000 concurrent clients stay fast.

**Bottom line up front**: 100k concurrent users ≈ **800k concurrent WebSockets**
fleet-wide. Run **8–16 strfry/nostrfy nodes behind a WebSocket-aware load balancer
+ Geo DNS**, put media on Blossom/CDN (never through the relays), and the paid
relay on **1–2 admission-gated nodes**. The dominant cost is **egress bandwidth**,
not CPU.

---

## 1. Load model (what 100k clients actually demand)

Per-client demand (the ADR-0008 client design — tiering + connection budget):
- **≤8 persistent sockets** per client (down from ~9+ad-hoc before tiering).
- **~2–4 live REQs** per client (EventBus ref-counting dedups them).
- **~50 events per page fetch**; a few pages/hour active.
- **Top-K query fan-out (K=4)**: queries hit platform + top-3 healthiest — NOT
  all relays — so each relay sees a FRACTION of total query traffic.

Fleet-wide at 100k concurrent:

| Resource | Estimate | Basis |
|---|---|---|
| **Concurrent WebSockets** | ~800k | 100k × ≤8 sockets |
| **Idle keepalive bandwidth** | ~6.4 Gbps aggregate (~800 Mbps/node @ 8 nodes) | ~1 KB/s/conn |
| **Active feed bandwidth (peak)** | tens of Gbps at peak | 100k × ~50 KB/page × few pages/hr |
| **Event writes** | trivial | 100k × ~5 events/day |
| **Fan-out (a viral post)** | burst | nostrfy does 680k deliveries/s/node |

**The #1 cost control**: media (images/video) must NOT flow through the relays.
NostrFeed clients already load media from Blossom servers + CDNs (`MediaUtils`
rewrites to `?w=` resized variants) — keep it that way. Relay bandwidth should
carry EVENTS (small JSON), never binary media.

---

## 2. Reference capacity (measured, not guessed)

From the **nostrfy** benchmark (2 vCPU i5 / 2 GB, loopback — treat as a floor):
- **24,500 events/s accepted**, **680,000 fan-out deliveries/s**.
- **10,000 concurrent connections held at ~280 MiB RSS**.
- Per-connection memory ~90 KB (kernel + user).

From **strfry** (production LMDB relay): "hundreds of thousands of connections on
a single host" with host tuning (see §4).

**Planning rule**: budget **~10k concurrent connections per node** on modest
hardware (2–4 vCPU), or **~100k per node** on big iron with tuning. 100k users ×
8 sockets = 800k sockets → **~80 modest nodes** OR **~8–16 tuned nodes**. We
target **8–16** (big-iron strfry/nostrfy) for cost.

---

## 3. Topology

```
                        ┌─────────────┐
                        │  Geo DNS /  │
                        │  Anycast    │
                        └──────┬──────┘
                               │
                  ┌────────────┴────────────┐
                  │  WS-aware Load Balancer  │  (L4/L7, sticky-ish, permessage-deflate passthrough)
                  └──┬───┬───┬───┬───┬───┬──┘
        ┌────────────┘   │   │   │   │   └────────────┐
   ┌────▼────┐      ┌────▼─┐ ▼┐  ▼┐  ▼┐            ┌──▼─────┐
   │ relay-1 │      │relay-2│ │ │  │ │            │relay-N │
   │ strfry  │      │strfry │ …  …  …            │strfry  │
   │ (LMDB)  │      │(LMDB) │                    │(LMDB)  │
   └─────────┘      └───────┘                    └────────┘
        │                                               │
        └─────────────── negentropy mesh ───────────────┘
              (nodes reconcile with each other via NIP-77)

   paid.nostrfeed.com ──► 1–2 admission-gated nodes (NIP-42, paid users only)
```

- **N = 8 strfry/nostrfy nodes** to start (handles ~800k sockets with headroom);
  scale N horizontally as concurrency grows (nodes are near-stateless — each
  holds a full LMDB copy and they reconcile via NIP-77 negentropy mesh).
- **Geo DNS / Anycast** routes a client to its nearest node (latency + egress
  locality).
- **WS-aware LB**: terminates TLS (or passes through), honors WebSocket upgrade,
  forwards permessage-deflate, and does NOT buffer long-lived frames (no idle
  timeout < 60 s; clients ping ~55 s).

---

## 4. Node configuration (strfry, per node)

```conf
# /etc/strfry.conf  — tuned for ~100k connections (see §2 sizing)
db = "/var/lib/strfry/db"
dbParams { maxreaders = 1024; mapsize = 10995116277760 }   # 10 TB sparse
relay {
  maxWebsocketPayloadSize = 131072
  maxReqFilterSize = 200
  maxSubsPerConnection = 100
  maxFilterLimit = 2000
  autoPingSeconds = 55           # < any proxy/LB idle timeout
  enableTcpKeepalive = true
  queryTimesliceBudgetMicroseconds = 10000
  maxPendingOutboundBytes = 33554432   # slow-client backpressure cap
  compression { enabled = true; slidingWindow = true }   # permessage-deflate
}
```

**Host tuning** (per nostrfy ops guide):
- `ulimit -n` / `LimitNOFILE` ≥ 2× target connections (+1000).
- `net.core.somaxconn` ≥ 1024 (accept bursts).
- `net.ipv4.tcp_fin_timeout` low (~10) — reclaim TIME_WAIT faster.
- `vm.overcommit_memory = 1` or `2` — LMDB's large sparse map.

---

## 5. The paid relay (`paid.nostrfeed.com`)

- **Admission-gated** (NIP-42 kind-22242 auth) — only paying users connect.
  Load = paid users only, a small fraction of total.
- Start with **2 nodes for HA** (a paying user expects reliability). Each is a
  single beefy strfry (4–8 vCPU/16 GB) handling thousands of paid users; add
  nodes by the same sharding as the public relay when paid count grows.
- The **admission service** (`/admissions/check/{pubkey}`, `/invoices`) is a
  small stateless HTTP service — scale it behind the same LB; keep admission
  state in its own small DB (idempotent, three-valued admitted/unpaid/unknown —
  never double-charge).

---

## 6. Sync between nodes (NIP-77 mesh)

- Every node runs **negentropy** against its peers on a schedule (e.g., every
  1–5 min): `NEG-OPEN` the feed scope, exchange only the DIFFERENCE. Bandwidth
  ∝ divergence, not set size — a mesh of 8 nodes converges a new event fleet-
  wide in seconds at negligible cost.
- Client-side (already shipped, ADR-0008 P6): the app ALSO reconciles with
  whichever node Geo DNS gave it (upload + download halves), so a user who
  posts to node A and later lands on node B sees their own content converge.

---

## 7. Monitoring + alerting

Per node (strfry exposes a metrics endpoint; nostrfy similar):
- **connections.active** — alert if > 80% of the node's budget.
- **events.received / rejected / duplicate** — a spike in rejected = abuse or
  a write-policy bug.
- **buffers_dropped / maxPendingOutboundBytes hits** — slow clients forcing
  backpressure (expected under floods; a sustained rise = add nodes).
- **db_size_bytes + LMDB map free** — alert before the map fills.
- **fan-out p99 latency** — the user-visible "is it fast" signal.

Fleet:
- **Total concurrent sockets** vs plan (800k @ 100k users).
- **Egress bandwidth per node** — the dominant cost; alert at 70% NIC.
- **Negentropy mesh lag** — time for an event on node A to appear on node B.

---

## 8. Rollout plan (capacity gates)

| Users (concurrent) | Nodes | Action |
|---|---|---|
| 0–10k | 1–2 | Single strfry (+1 for HA). Paid relay co-located or 1 small node. |
| 10–50k | 2–4 | Add Geo DNS. Enable permessage-deflate everywhere. Media 100% on CDN. |
| 50–100k | 4–8 | LB in front; NIP-77 mesh on a 1-min cadence; first capacity review. |
| 100k+ | 8–16 | This runbook's target. Tune hosts (§4); alert-driven horizontal adds. |

Every gate: re-measure connections/node + egress before adding hardware. The
client's tiering + top-K means server load grows SUB-LINEARLY with users after
~50k (queries stop fanning out to every relay).

---

## 9. Failure modes + runbook responses

| Symptom | Likely cause | Response |
|---|---|---|
| Clients see stale feed on ONE node | node fell out of mesh / LB sticky to a dead node | health-check node out of LB; mesh catches up on rejoin |
| `buffers_dropped` climbing | slow/stalled clients | expected under flood; add nodes if sustained; verify `maxPendingOutboundBytes` set |
| A node OOMs | too many connections for its RAM | lower its connection budget in LB; add nodes; check `ulimit` |
| Paid users can't connect | admission service down (relay is fine) | restart admission svc; it's stateless; check its DB |
| Egress bill spike | media leaking through relays | confirm Blossom/CDN is serving media; block large frames at relay |
| NEG-ERR from a node | node lacks NIP-77 | that's fine (client falls back to windowed REQ); upgrade node to strfry/nostrfy with NEG |

---

## 10. Cost ballpark

- **8 × (4 vCPU/16 GB) nodes**: modest VPS cost each. The dominant line item is
  **egress bandwidth**, not CPU — negotiate bandwidth pricing / use a provider
  with cheap egress or peering.
- **Paid relay**: 2 × (4 vCPU/16 GB).
- **Admission service**: 1 tiny node.
- **Media**: offloaded to Blossom/CDN — cost scales with media views, NOT relay
  count, and is cached at the edge.

The architecture's leverage: the CLIENT does the heavy lifting (local store,
FTS search, top-K, backpressure), so the relays mostly move small JSON to
healthy sockets — which is why a handful of nodes serves 100k users.
