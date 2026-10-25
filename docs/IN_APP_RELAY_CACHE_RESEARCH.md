# In-App Relay Cache Server — Research (2026-10-25)

Question: instead of a Primal-style central backend (one server connects to all
relays, caches everything, serves the app), can the cache/relay live **inside**
the Flutter app, in the background, with low memory?

## Reference architectures (verified)

| Project | What it is | Stack | Notes |
|---|---|---|---|
| `PrimalHQ/primal-caching-service` (now `primal-server`) | Central backend: connects to a set of relays, collects all events in real time, stores locally, serves clients over a WebSocket API | Server (Kotlin/JVM) | Heavy: RAM + disk scale with the whole network. That's why it runs in a datacenter. |
| `greenart7c3/Citrine` | "A Nostr relay in your phone" — full local relay on Android: import/export DB, configurable port, start/stop, broadcasts queued events when back online, content resolvers | Kotlin, 135★ | Proves the concept: phone-class hardware can run a real NIP-01 relay. Used alongside Amethyst. |

Conclusion: the pattern works — but only when scoped to **one user's data**, not
the whole network. A phone cannot be Primal's cache; it can be **your own**
personal relay/cache.

## What "possible" means on each OS

- **Android** — fully possible. Foreground service (persistent notification)
  keeps the process + WebSockets alive; `flutter_background_service` (Android
  part) or a native `Service` does this. Citrine works exactly this way.
- **iOS** — NOT possible to run a real 24/7 background server. iOS suspends
  apps seconds after backgrounding. Options: `BGTaskScheduler` /
  `background_fetch` (periodic ~30 s wake-ups, OS-scheduled), push-triggered
  sync. So on iOS the "server" runs only while app is foregrounded, plus
  periodic catch-up syncs. This is an Apple platform limit, not a Dart limit.

## Proposed architecture for NostrFeed (fits existing code)

The app already has the pieces: `lib/core/db/event_store.dart` (sqflite),
`lib/core/nostr/relay/relay_pool.dart`, `relay_router.dart`. Evolution, not
rewrite:

```
┌──────────────────────── NostrFeed app ────────────────────────┐
│ UI (Riverpod)                                                 │
│      │ reads/writes                                           │
│ ┌────▼─────────────────┐                                      │
│ │ LocalRelayService    │  NIP-01 subset: EVENT/REQ/CLOSE/EOSE │
│ │ (localhost wss :4869 │  serves the UI + optionally LAN apps │
│ │  via shelf_web_socket)                                      │
│ └────┬───────────┬─────┘                                      │
│      │           │                                            │
│ ┌────▼─────┐  ┌──▼──────────┐    ┌──────────────────┐         │
│ │EventStore│  │ RelayPool   │───▶│ upstream relays   │         │
│ │ (SQLite) │  │ (outbound ws│    │ (damus, nos.lol…) │         │
│ │WAL mode  │  │  + router)  │◀───│                  │         │
│ └──────────┘  └─────────────┘    └──────────────────┘         │
│   background isolate owns both — UI talks via ports/ws        │
└───────────────────────────────────────────────────────────────┘
```

Key decisions:

1. **Everything in one background isolate.** SQLite connection, relay
   connections, and the localhost server all live in a single long-lived
   isolate → no cross-isolate DB contention, predictable memory.
2. **SQLite, not in-memory lists.** Events stay on disk; only hot indexes /
   open subscriptions in RAM. WAL mode, `PRAGMA mmap_size`, incremental
   vacuum. Target: 30–60 MB steady-state RSS.
3. **Serve the UI over localhost WebSocket** (`shelf` + `shelf_web_socket`,
   bind `127.0.0.1` only). The UI becomes just another relay client
   (`ws://127.0.0.1:4869`) — same code path as remote relays, trivially
   mockable in tests. Optional: expose on LAN so desktop/other devices can
   use the phone as their relay (Citrine's model).
4. **Negentropy (NIP-77) set reconciliation** for sync instead of
   re-downloading everything — big data/battery savings on mobile.
5. **Scope the cache:** own events, follows' events, active feed filters.
   Never mirror whole relays. TTL + count caps per kind (e.g. keep last N
   kind-1 per author, drop old kind-3/10002 replaceables — only latest).
6. **Background:** Android → `flutter_background_service` foreground service
   (or `workmanager` for periodic sync if a persistent notification is
   unacceptable). iOS → BGTaskScheduler catch-up + live sync while app open.

## Memory budget (realistic, mid-range Android)

| Component | RSS |
|---|---|
| Flutter engine + UI | already paid by app |
| Background isolate (VM heap) | ~10–20 MB |
| SQLite page cache (capped) | ~8–16 MB |
| ws connections (10–20 relays, idle) | ~1–3 MB |
| **Added total** | **~30–60 MB** |

Disk: SQLite grows with scope; cap with retention rules (e.g. 30–90 days,
~500 MB ceiling, LRU eviction). Compare: Primal's server caches *everyone* —
unbounded; personal cache is bounded by your follow graph.

## Packages to evaluate (already in pubspec: `sqflite`, `web_socket_channel`)

- `shelf` + `shelf_web_socket` — localhost relay endpoint
- `flutter_background_service` / `workmanager` — background execution
- `negentropy` Dart impl (check pub.dev; may need port of reference C++/Kotlin)
- keep `sqflite` (already battle-tested in `EventStore`)

## Risks / gotchas

- iOS background limits (above) — design sync to be incremental & resumable.
- Battery: permanent ws to 20 relays drains; batch/reconnect with backoff,
  drop to push-driven sync when screen off.
- Android 14+ foreground-service types must be declared (`dataSync`).
- Single-writer rule: only the background isolate touches SQLite.
- Publishing while offline: queue outbox in SQLite, broadcast on reconnect
  (Citrine does exactly this).
