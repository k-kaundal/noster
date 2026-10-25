# ADR-0006: Push Notifications (Relay → APNS/FCM Bridge)

**Status:** Accepted (design). Implementation blocked on P5b (scheduler
plugin) + server work.
**Date:** 2026-10-25
**Supersedes:** the "no background delivery" status quo.
**Context:** ADR-0005 P5 covered the *periodic catch-up* tier
(`BackgroundSyncService`). This ADR covers the *instant* tier.

---

## 1. Context

Mobile Nostr clients cannot keep sockets alive in the background (iOS kills
them; Android Doze throttles them; cellular battery cost ~several %/hour
measured by ntfy). The two proven answers in production:

- **Damus (iOS):** `notepush` — a high-performance Nostr relay that watches
  for events p-tagging registered users and pushes APNS. Device tokens are
  registered with NIP-98 auth; newer work encrypts tokens with ECDH for
  privacy.
- **Amethyst (Android):** an opt-in foreground service keeping only
  inbox/DM relays alive (persistent low-importance notification) +
  WorkManager catch-up + FCM/UnifiedPush as the force-stop backstop.

NostrFeed today has: local notifications (`flutter_local_notifications`),
gap-fill on resume, and the ADR-0005 ingest pipeline. There is **no
background delivery** once the OS suspends the app.

## 2. Decision (three tiers, ship in order)

### Tier 1 — Periodic catch-up (ADR-0005 P5) — code-complete, scheduler pending
`BackgroundSyncService.syncNow()` runs reconnect + feed restart + wallet
resync + DM gap-fill (which fires local notifications for new arrivals).
The only missing piece is the OS scheduler: `workmanager` (Android
WorkManager / iOS BGTaskScheduler), a ~20-line registration once pub.dev is
reachable. Battery-cheap; latency = OS schedule (≥15 min).

### Tier 2 — Android foreground service (opt-in, default OFF)
Amethyst's model: `flutter_background_service` in `isForegroundMode: true`
(persistent low-importance notification "Connected to N inbox relays")
keeping ONLY the DM/notification `#p`=me subscriptions alive; feed subs
pause. Ping 240s cellular / 120s wifi (Amethyst's measured values); no
`_WAKEUP` alarms; WorkManager + boot receiver as restart backstops. Battery
honesty in Settings copy; users who want instant DMs opt in knowingly.

### Tier 3 — Push-relay bridge (the real fix, esp. iOS)
A small relay-side service (Damus's `notepush` model):

```
Nostr relays → [bridge: watches kind 4/1059 #p=registeredUsers]
             → APNS (iOS) / FCM (Android)
             → silent push → app wakes → gap-fill → local notification
```

- **Registration:** the app publishes its push token to the bridge with
  NIP-98 auth (the same pattern as our Blossom upload auth, kind 24242).
- **Privacy:** the bridge learns "this pubkey gets pushes" — unavoidable
  for relay-side push (Damus accepts it; MIP-05 ECDH-encrypted tokens are
  the follow-up). Opt-in, default OFF, documented in Settings.
- **Server:** a ~200-line Rust/Go service watching our own relay
  (`wss://relay.nostrfeed.com`) first — we operate that relay, so no third
  party is needed for the v1. Multi-relay watch later.
- **Client:** `onNotificationTap` already deep-links via the router; the
  silent-push handler runs the SAME `BackgroundSyncService.syncNow()`.

## 3. Why not a persistent socket everywhere

Rejected (research-backed): iOS kills long sockets by design; Android
cellular sockets cost real battery; every production client that tried
(early Signal, ntfy #687) moved to push or periodic sync. The foreground
service is the *opt-in exception*, not the default.

## 4. Phasing

| Step | Scope | Blocker |
|---|---|---|
| **T1** | workmanager registration for `BackgroundSyncService` | pub.dev network (code written, in `registerPeriodicSync`) |
| **T2** | Android foreground service (opt-in) | `flutter_background_service` package + on-device testing |
| **T3a** | Push-bridge server on relay.nostrfeed.com (watch #p, send APNS/FCM) | server work (not app code) |
| **T3b** | Client token registration (NIP-98) + silent-push handler | T3a + APNS/FCM credentials |

## 5. Consequences

- **Good:** instant DMs/mentions/zaps without killing battery; iOS gets a
  real answer (push, not sockets); the architecture (ingest pipeline +
  background sync) needs no changes — push is just another trigger into
  `syncNow()`.
- **Costs:** Tier 2 adds a persistent notification (product decision, opt-in);
  Tier 3 is server work + a privacy tradeoff to document honestly.
- **Rejected:** persistent sockets (OS-banned/battery); PushKit (VoIP-scoped,
  App Store rejects for messaging); doing T3 before T1/T2 (the bridge is
  wasted if the app can't wake-and-sync cleanly — that's what T1 proves).
