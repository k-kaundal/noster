# Local Relay — Security Model & Background-Process Reality

Companion to `docs/ADR-0007-in-app-relay.md` (2026-10-25). This document
answers the two questions that decide *whether* the in-app relay is viable
before we design *how*: (1) what can attack it, (2) will the OS let it run.

Verified against: Android 15 behavior-changes (developer.android.com,
fetched 2026-10-25), dontkillmyapp.com OEM rankings, Citrine
(`greenart7c3/Citrine`), NIP-01/42/77.

---

## PART 1 — How background processes actually work

### 1.1 Android process states (what keeps us alive, what kills us)

| State | Meaning | Our relay |
|---|---|---|
| Foreground | UI on screen | relay fully alive |
| Cached (LRU list) | app swiped away / idle | **first to die** under memory pressure — a cached-process ws server has hours-to-minutes |
| Foreground service (FGS) | persistent notification posted | process kept alive, "active" standby bucket |

The honest baseline: **without an FGS, an Android relay is a best-effort
cache, not a server.** With an FGS it survives — subject to the three
constraints below.

### 1.2 Constraint A — Doze (API 23+)

Screen off + unplugged + stationary → system suspends **network access for
all apps**, FGS included; maintenance windows open periodically. Only a
battery-optimization exemption (`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`,
user-granted) keeps sockets open in Doze. **Consequence: upstream relay
WebSockets WILL die overnight on stock settings.** Design for daily
disconnect → NIP-77 catch-up, not for a permanent pipe.

### 1.3 Constraint B — Android 15 `dataSync` FGS timeout (verified 2026-10-25)

Apps targeting API 35+:
- **`dataSync` FGS: 6 hours total per 24-hour period** (shared across all of
  the app's dataSync services). On expiry the system calls
  `Service.onTimeout()` → must `stopSelf()` within seconds or it crashes.
- **Timer resets only when the user brings the app to the foreground.**
- Starting another dataSync FGS after exhaustion throws
  `ForegroundServiceStartNotAllowedException` ("Time limit already
  exhausted").
- **`BOOT_COMPLETED` receivers may NOT start `dataSync` FGS** (throws) — no
  auto-start-on-boot for our type.
- Guidance straight from Google: only start as a result of user interaction,
  or use an alternative API (WorkManager).

**This kills the naive "FGS runs 24/7" plan on Android 15+.** What survives:

| Strategy | Type | Budget | Fits us |
|---|---|---|---|
| dataSync FGS | timed | 6 h / 24 h, reset on app open | **yes — primary**: covers the user's active day; nightly gap handled by NIP-77 sync on next open |
| WorkManager periodic | job | ≥ 15 min interval, Doze-deferred | **yes — fallback**: gap-fill syncs; `background_sync.dart` already has this shape |
| specialUse FGS | untimed | **Play-review justification required**; no arbitrary "keep ws alive" | maybe later ("local relay user explicitly enabled") — review risk |
| Battery-optimization exemption | setting | user opt-in via Settings deep-link | offer, don't require (Play flags apps that push it aggressively) |
| Exact alarms / high-prio FCM | — | n/a | ADR-0006 push path later |

Note the practical escape hatch: the 6 h budget **resets on every app
open** — a social app opened a few times a day effectively gets continuous
daytime coverage. The overnight Doze gap is closed by sync-on-resume, which
NIP-77 makes cheap. This is also exactly how Citrine users run it (start
the service, use it, accept it stops eventually).

### 1.4 Constraint C — OEM killers (dontkillmyapp.com, fetched 2026-10-25)

Aggressive non-AOSP killers, worst first: **Huawei, Xiaomi, OnePlus,
Samsung, Meizu, Asus, Ulefone, Oppo** (5💩), Vivo/realme/Motorola/Lenovo
(3–4💩). Pixel/AOSP clean. They kill even FGS apps via per-OEM "battery
savers" the user must whitelist manually. **Implication: the relay must be
fully resumable from death at ANY moment** (§2.4), and Settings should
deep-link the OEM whitelist screen where detectable. Never promise "always
on" in UI copy — promise "syncs when it can".

### 1.5 iOS — the real contract

| Mechanism | Runtime | Notes |
|---|---|---|
| Foreground | unlimited | relay fully alive — **primary iOS mode** |
| `beginBackgroundTask` on backgrounding | ~30 s | orderly flush/checkpoint, then suspended |
| `BGAppRefreshTask` (BGTaskScheduler) | ~30 s | system-scheduled by usage patterns; **not guaranteed**; dead after user force-quits until relaunch |
| `BGProcessingTask` | minutes | maintenance windows (often charging+night); requires external power option |
| Silent push (APNs `content-available`) | ~30 s/wake | rate-limited (~2–3/h); needs an external push server (ADR-0006) — relays don't push |
| Persistent server in background | **impossible** | platform limit — no exceptions for our category |

iOS design therefore: relay runs in-process while the app is used; a
BGTask + resume-triggered NIP-77 sync closes gaps. Functionally the user
sees "fresh when opened, catches up in <2 s" — which, with negentropy, is
honest.

### 1.6 Flutter isolate/process mechanics (the part that breaks naive ports)

- `flutter_background_service` (Android): spawns a **second Flutter engine +
  Dart isolate** inside the FGS. UI isolate ↔ service isolate share
  **nothing** — communicate via its message channel.
- **sqflite is not isolate-safe.** One database handle per isolate; two
  isolates writing one file = locks/corruption. Hence ADR-0007's rule:
  **the relay isolate is the sole owner of SQLite**; the UI isolate talks
  to it exclusively over the wire protocol (which is why "UI is just a
  relay client" isn't elegance — it's a hard requirement).
- Process death kills both isolates; FGS `START_STICKY` revives the service
  isolate only → the UI must treat the relay endpoint as *potentially
  absent* and reconnect (same reconnect logic as remote relays — reused).
- On iOS the "background isolate" doesn't persist; keep the relay in the
  main isolate and gate its lifetime on app state.
- Wake locks: a partial `WakeLock` keeps CPU, **not** Doze network — never
  hold one permanently (battery + Play policy); WorkManager holds them
  correctly per-job.

---

## PART 2 — Security model

### 2.1 Threat #1 (the one everyone misses): loopback is NOT private on Android

Binding `127.0.0.1:4869` blocks the network — but **any other app installed
on the same device can connect to it.** Loopback is one namespace shared
system-wide; there is no per-app isolation and no way to identify the
connecting peer. A malicious/curious app could:
- **read everything** the relay holds (public posts fine — but also contact
  lists, bookmarks, mute lists, DM *metadata*, wallet-history events 7375/7376);
- **inject events** (`EVENT`) into our cache → forged UI state (though not
  forged signatures — see 2.2);
- **mount DoS**: giant REQs, thousands of subscriptions, huge filters.

Mitigations (all cheap, all decided):

| Control | Decision |
|---|---|
| Per-boot auth token | 128-bit random token generated at relay start, passed to the UI isolate via the platform channel (never logged, never persisted, never in the DB). Server requires it — as `?auth=` on the ws upgrade or first-frame `["AUTH", token]`; unknown/missing → close. Token rotates every cold start. |
| Random port | bind port 0 (OS-assigned), hand port+token to UI together — kills trivial port-scanning of the well-known 4869 |
| Loopback only | `127.0.0.1`, never `0.0.0.0` (LAN mode = separate, opt-in, NIP-42-gated phase 6) |
| Request caps | max event size 64 KB, max tags 2 000, max filter authors 1 000, max filters/REQ 10, max subs/connection 20, max connections 4 — a compromised local client can't OOM the isolate |
| No keys in relay isolate | §2.3 — the relay literally cannot sign for the user |

(iOS note: same hardening — cheap, and covers jailbreak/multi-user edge cases.)

### 2.2 Threat #2 — forged/tampered events (relay as untrusted data sink)

Already solved at the pool boundary (`NostrEvent.isValid`: id-commitment +
BIP-340). The local relay inherits the rule **on both directions**:
- upstream → relay: existing verification + 5k-id dedup LRU;
- UI → relay (local `EVENT` publishes): verify before store/forward, answer
  with proper NIP-01 `OK` frames (`invalid:`, `duplicate:` prefixes);
- defense-in-depth: even if a local attacker bypasses our UI (stolen token),
  injected events still can't carry valid signatures for other pubkeys —
  worst case is junk under attacker keys, which retention evicts.

### 2.3 Key security — signing never enters the relay isolate

- nsec stays where it is: `flutter_secure_storage`, hardware-backed,
  UI-isolate only. The relay isolate **never receives it** — it stores and
  forwards *already-signed* events. Blast radius of a relay-isolate
  compromise ≈ cache content, not identity.
- NIP-42 AUTH (needed for our paid relay upstream, and for LAN phase 6):
  the kind-22242 auth event is **signed in the UI isolate** and passed over
  as a finished event. No private key material crosses the channel ever.
- NIP-46 bunker stays the upgrade path for not holding keys on-device at
  all (Premium feature — unchanged).

### 2.4 Storage & integrity under sudden death

- **SQLite WAL**: atomic commit per ingest batch; process kill mid-write =
  rolled back, never half-stored event. `PRAGMA synchronous=NORMAL` (WAL)
  is the durability/perf sweet spot on mobile flash.
- **Idempotent ingest** (`INSERT OR REPLACE` by id) + `deletions` table →
  crash-resume is replay-safe; sync watermarks (`since` per relay) persist
  in DB, so resume continues, never restarts.
- **Encryption at rest — deliberately NOT added**: public posts are public;
  DMs are NIP-17 gift-wraps (already end-to-end encrypted at the event
  layer); device sandbox + OS file protection is the boundary. SQLCipher
  would add a second key-management problem (key must live in the same
  secure storage an attacker with sandbox escape would read anyway) and
  costs ~10-20% query perf + native lib size (ADR-0004 budget). Optional
  later hardening, off by default.
- Backup hygiene: DB lives in app-private dir, excluded from cloud backup
  (`android:allowBackup` rules / iOS `.isExcludedFromBackup`) — a restored
  cache on a new device is useless-but-sensitive metadata; fresh sync is
  correct behavior anyway.

### 2.5 Network & privacy

- Upstream: `wss://` only (already enforced in `normalizeRelayUrl`); TLS
  ≥1.2 (Android 15 disallows 1.0/1.1 for targetSdk 35+ — aligned).
- **Privacy is the local relay's biggest win**, state it precisely:
  today every UI screen's filters (`#p` you, authors you follow, kinds you
  read) go straight to shared relays = reading-habit graph. With the local
  relay, upstream syncs are **broadened and batched** (wider windows, fewer
  identifying filters, spread across relays), and all fine-grained queries
  stay on-device. REQ-fingerprinting collapses.
- Tor (Citrine ships kmp-tor): deferred — native size blows the ADR-0004
  35 MB budget; Orbot-style external-Tor opt-in later.

### 2.6 Store-policy compliance (security review surface)

- **Play**: FGS type declaration (`dataSync`) in manifest +
  `FOREGROUND_SERVICE_DATA_SYNC` permission; Play Console requires a
  justification video/description for FGS use — "syncing the user's Nostr
  feed/DMs" is a standard accepted use. No bg-start tricks (Android 15
  kills them anyway). Don't nag for battery exemption (policy-sensitive) —
  deep-link once from Settings with honest copy.
- **Apple**: BGTask identifiers in Info.plist; no VoIP/background-audio
  abuse (instant reject + ban risk); the 30-second flush pattern is the
  sanctioned one.
- Notification content: FGS notification = generic "Feed sync active" —
  never event content (lock-screen leak).

### 2.7 Rate/flood gates inherited

EventBus flood gate + `flood_detector` stay upstream of the relay's store
(spam never reaches disk). The relay adds *protocol-level* caps (2.1) so
its own parser can't be DoS'd by a local peer — two different layers, both
needed.

---

## Decisions folded back into ADR-0007 (phase adjustments)

1. **Phase 3 ws server**: token auth + random port + request caps are part
   of the initial server, not optional extras.
2. **Phase 4 Android**: `dataSync` FGS **started on app open / user toggle
   only** (never from `BOOT_COMPLETED` — Android 15 throws), implement
   `onTimeout()` → graceful stop + watermark persist; WorkManager periodic
   fallback sync; Settings copy honest about OEM killers.
3. **iOS**: in-process relay (main isolate), `beginBackgroundTask` flush on
   backgrounding, BGTaskScheduler + resume-sync via NIP-77. No background
   server promise.
4. **Key isolation**: relay isolate is keyless; NIP-42 auth events signed
   UI-side.
5. **Privacy posture**: upstream sync filters deliberately broadened/batched;
   fine-grained queries never leave the device.
6. **Testing additions**: token-auth wire test; cap-enforcement tests;
   `adb` Doze/timeout simulation (`am compat enable
   FGS_INTRODUCE_TIME_LIMITS`, `device_config … data_sync_fgs_timeout_duration`,
   `dumpsys deviceidle force-idle`) as a manual QA script in `tool/`.
