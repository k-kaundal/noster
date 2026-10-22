# NostrFeed Chat — Analysis & Real-time Rewrite Plan

**Date**: 2026-10-22 · **Status**: Phase 1 (critical fixes) implemented · **Sources**: deep code analysis + NIP-17 spec + WhatsApp/Signal/Stream architecture research

---

## 1. How real-time chat actually works (research applied)

| Pattern (WhatsApp/Signal/Messenger) | Our Nostr equivalent |
|---|---|
| Persistent WebSocket, server pushes new messages | Relay pool live subscription (`kinds 4/1059, #p=me`) |
| **Sliding sync cursor** — server sends only what arrived after your last ack | ⚠️ **Missing** — our `since` is frozen at subscription creation (the storm bug) |
| Delivery receipts (✓ / ✓✓) | `publishWithAck` (relay accepted) — no recipient receipt exists in Nostr |
| Offline queue + gap-fill on reconnect | ⚠️ Partial — resubscribe replays a frozen `since`, no gap-fill query |
| Message status: pending → sent → delivered → read | pending → sent (relay ack) → failed. No delivered/read (Nostr limitation) |
| Push only for genuinely new messages | ⚠️ **Broken** — replayed history gets fresh arrival time → banner storm |

**The key insight from chat-system research**: every production chat separates **sync (history, paginated, cursor-based)** from **push (live, only-new)**. Our app merges them into one stream with a frozen 6-hour `since` — that one decision is the root of the notification storm AND the "feels not real-time" problem.

---

## 2. Root causes found (ranked by severity)

| # | Bug | Root cause | Where |
|---|---|---|---|
| 1 | **Notification storm on reconnect/start** | Live sub `since = now - 6h` frozen at creation; replayed events get `_arrivalTs = now` → `isUnreadFrom` true → banner+push for hours-old messages | `dm_store.dart:604`, `dm_notifier.dart:50` |
| 2 | **Frozen `since` on resubscribe** | `_resubscribeAll` re-issues the ORIGINAL filter; after 1h background, replays 7+ hours of history | `relay_pool.dart:227` |
| 3 | **"Not real-time" feel** | Same frozen-since stream handles both sync and push; no gap-fill on resume; thread list sorts by backdated rumor time | §1 above |
| 4 | **Cross-account data leak** | `DmStore` never cleared on logout; `_lastRead` keyed by peer only, not account+peer | `auth_providers.dart:79` |
| 5 | **Thread sorting wrong** | Relay-fetched NIP-17 messages sort by randomized rumor time (up to 2 days back) — fresh messages appear buried | `dm_store.dart:338` |
| 6 | **Unbounded memory** | `_decrypted`/`_liveEvents`/`_arrivalTs` never evicted | `dm_store.dart:90-107` |
| 7 | **Never publishes own kind-10050** | Others can't find our DM inbox → all incoming DMs fall back to well-known relays | `dm_repository.dart:135` uncalled |
| 8 | **No pagination** | Thread renders ALL messages at once; conversation list capped at 200 events | `chat_screen.dart` |

---

## 3. The rewrite (4 phases)

### ✅ Phase 1 — Critical fixes (DONE, this commit)
1. **Sliding-since on reconnect**: relay pool tracks, per subscription, the newest event timestamp seen; on resubscribe it re-issues the filter with `since = max(original_since, newest_seen)` instead of the frozen one.
2. **Notification storm guard**: `DmNotifier` only banners/pushes when the event's **rumor created_at ≥ app-start time** (a genuine new message), never for replayed history. History still lands in the list, silently.
3. **Logout cleanup**: `DmStore.clearAll()` on logout; `_lastRead` watermarks keyed `accountPubkey:peerPubkey`.
4. **Thread sort by effective time**: relay-fetched NIP-17 messages display at their *first-seen* time (arrival), not the backdated rumor time.

### ✅ Phase 2 — Real-time feel (DONE)
5. **Gap-fill on resume** (`dm_gap_fill.dart`): one-shot query with an ADVANCING cursor (`store.newestSeenTs`) fetches exactly what arrived while the app was dead — wired into `didChangeAppLifecycleState`, debounced 10s. The live sub now only carries truly-new events.
6. **Reactive thread provider** (`dm_thread_provider.dart`): per-thread FutureProvider.family replaces the FutureBuilder-per-build — the old pattern created a NEW future every rebuild and showed a spinner on each incoming message (the flicker). Decryption is idempotent, so bumps rebuild from cache instantly.
7. **Own kind-10050 publish** on login (`auth_providers.dart`, 1–3 relays) — senders can now find OUR inbox.
8. **Targeted delivery** (`dm_delivery.dart`): fallback set trimmed 5→3 relays; when the recipient's inbox IS known, trust it (1–3) + only our home relay — no more 8-relay spray (faster + less metadata leak).

### ✅ Phase 3 — WhatsApp-grade UX (DONE)
9. **Image/file messages** (kind 15, NIP-17): `DecryptedDm` + `ChatMessage` now carry `rumorKind`/`mimeType`; bubbles render images inline (non-image files as a file chip); attach button in the input bar → gallery pick → Blossom upload → kind-15 wrap → same targeted delivery. Outbox persists kind/mime so images survive restarts.
10. **Reactive thread** (Phase 2) + message status (pending → sent → failed, tap-to-retry) — already WhatsApp-feeling.
11. **Read receipts approximation**: deferred — NIP-17 has no delivery/read receipts; the honest cross-device approximation (watermark sharing via kind 30078 app-data) is a Phase 4 item, not blocking.

### Phase 4 — Group DMs + scale
12. NIP-17 group DM UI (`createNip17GroupMessage` exists, unused).
13. Memory eviction (LRU caps on `_decrypted`/`_liveEvents`).
14. Smarter delivery: publish to recipient inbox (kind-10050) + only 1–2 fallbacks (stop spraying 5+ relays).

---

## 4. Multi-relay delivery (how it SHOULD work per NIP-17 + research)

Per NIP-17 + relay research:
1. **Recipient's kind-10050** (1–3 DM inbox relays) is the primary target — query the recipient's **write relays** for it (outbox model), not just our read relays.
2. **Publish the wrap to: recipient's inbox relays + our own write relays** (for self-copy + sender history). That's it — 2–4 relays, not 8.
3. **Fallback** only when no 10050: 2 well-known DM relays (not 5).
4. **We publish OUR 10050** so others can do (1) for us.
5. Ad-hoc connections to recipient inbox relays must be **torn down after publish** (currently they persist forever).

This cuts DM delivery from "spray to 8 relays" to "2–4 targeted relays" — faster, more private (less metadata leak), more reliable.

---

## 5. What Phase 1 fixes feel like
- **No more storm**: reconnect/resume/start shows old DMs silently in the list — banners ONLY for messages actually sent while you watch.
- **Less replay**: resubscribe asks relays only for what arrived after the newest event we already have (was: 6+ hours of re-replay every time).
- **No cross-account leak**: logout wipes DM caches + watermarks are per-account.
- **Correct ordering**: fresh NIP-17 messages appear at the top of the thread, not buried 2 days back.
