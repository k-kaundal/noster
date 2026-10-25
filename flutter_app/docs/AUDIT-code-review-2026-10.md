# Flutter App Code Audit — October 2026

Scope: state management (Riverpod), providers/notifiers, data layer/local
storage, UI/logic best practices across `lib/` (227 files, ~71.5k lines).
Method: three parallel deep-dives (providers, storage, UI) + targeted fixes.

## Fixed in this pass

| # | Severity | Fix |
|---|----------|-----|
| 1 | HIGH | `localEngagementProvider` → `.autoDispose`. Every PostCard watches its own family entry and every entry re-fired on each 500ms engagement tick — for every post ever seen, forever. |
| 2 | HIGH | `userInteractionsProvider` family key `List<String>` → single `String` event id. Lists have identity equality: every `[id]` literal was a new cache key, so `ref.invalidate` silently missed and entries multiplied. All 5 call sites updated. |
| 3 | HIGH | `.autoDispose` added to `repliesProvider`, `reactionsProvider`, `repostsProvider`, `zapReceiptsProvider`, `articleCommentsProvider`, `addressableEngagementProvider`, `articlesProvider`, `videosProvider`, `trendingHashtagsProvider`, `bookmarksProvider`. Unbounded per-entity caches are gone. |
| 4 | — | `bookmarkedIdsProvider` documented keepAlive (every card reads it — same trade-off as `profileProvider`, now explicit via `ref.keepAlive()` + comment). |
| 5 | MED | Dead providers deleted: `feedProvider` (divergent second feed truth), `selectedRelayProvider` (zero readers). |
| 6 | HIGH | Legacy JSON `FeedStore` no longer written on every "N new posts" pill tap (double-write with SQLite). It's read-once-then-clear per AGENTS.md. |
| 7 | HIGH | Missing `mounted` guard in `login_screen._generateKeys` (post-await setState crashed if the user navigated away mid-keygen). |
| 8 | MED | Trending rank badges: list is now filtered (hidden + non-renderable posts) BEFORE ranking — no orphan rank numbers / numbering gaps. |
| 9 | CRITICAL | Raw `http` migration DONE: `cashu_service.dart` (7 sites → shared `_get`/`_post` helpers on ApiHttpClient, CashuException preserved), `lnurl_service.dart` (2 probe sites → `tryGetJson`), `admission_service.dart` (`check` → `tryGetJson`, `mintInvoice` → new `ApiHttpClient.tryPostRaw` for the form-encoded fallback). |
| 10 | HIGH | SnackBar→AppToast DONE: 61 call sites across 21 files migrated (52 scripted with a string-aware paren balancer + 9 hand-done complex ones with Row content/custom shapes). Zero raw `ScaffoldMessenger.showSnackBar` remain outside the AppToast doc comment. |
| 11 | HIGH | DM caches bounded: `_decrypted`/`_liveEvents`/`_arrivalTs`/`_undecryptable` now LRU-capped at 500 (`_cachePut`); a miss just re-decrypts. `_persistOutbox` + `_lastRead` writes debounced 500ms (was full-JSON write per mutation/read-mark); `_lastRead` capped at 200 peers. |
| 12 | MED | `_houseReconnect` timer assigned (house-socket backoff is now cancellable in dispose/resync — no more stacked reconnects after wallet churn). |
| 13 | MED | cashu_wallet dialog guards: 8 post-await `setState` sites across the 4 StatefulBuilder dialogs now guard with `ctx.mounted` (crash on mid-async dismiss). |
| 14 | MED | Quick batch: AI `_creditedHashes` capped at 200 (reconcile pages 200 payments max); NWC corrupt-secure-JSON falls back to legacy prefs before giving up (was: all connections lost); feed login-gate → shared `EmptyState`; dead `followingFeedProvider` + its no-op invalidate deleted; `notificationFilterProvider`/`searchQueryProvider` autoDispose (state no longer leaks between visits); `DmAlertBanner` auto-dismiss moved into `DmNotifier` (one Timer per alert — was a 4s `Future.delayed` per widget rebuild). |
| 15 | MED | **`NotificationCenter` → real `Notifier<NotificationCenterState>`**: mutations flow through immutable state replacement; `unreadNotificationsProvider` is now a `.select` (bell badge rebuilds only on count change, not every ingest). `notificationVersionProvider` hand-rolled poke deleted. Tests updated (`.notifier` reads). |
| 16 | MED | **`DmStore` → real `Notifier<DmStoreState>`** (same conversion): `_bump()` → `state = DmStoreState(version)`; the hand-poked `dmStoreVersionProvider` is now a shim over `.select((s) => s.version)`; all method reads moved to `.notifier` (8 files + tests). Chat flow unchanged — 504 tests green. |
| 17 | LOW | Write-debounces: relay-list `_save()` (300ms — was full-list JSON per toggle) and quick-zap `setAmount` (300ms — was a prefs round-trip per stepper tick). |

## Open findings (prioritized backlog)

### State management
- **MED — `relayStatusProvider`** (`content_providers.dart`): derived pool state duplicated into a `StateProvider`, desyncs when the pool changes while Settings is closed. Fix: `StreamProvider` off a pool status stream, or read `pool.relayStates` + a pool version counter.
- ~~**MED — `NotificationCenter` + `DmStore` hand-rolled Notifiers**~~ — BOTH FIXED (items 15, 16). The Provider+version-poke pattern is now banned in AGENTS.md.
- **MED — Own-profile data in 3 places** (`authStateProvider.profile`, `NostrService.profileCache`, `profileProvider`) can show different names/avatars simultaneously. Fix: one read model — everything reads `profileProvider(auth.pubkey!)`.
- ~~**MED — `_houseReconnect` timer unassigned**~~ — FIXED (item 12).
- ~~**LOW** — `followingFeedProvider` dead; `notificationFilterProvider`/`searchQueryProvider` leaks; `DmAlertBanner` timer-per-rebuild~~ — ALL FIXED (item 14).

### Storage
- **MED — AI `_creditedHashes` unbounded** in secure storage. Fix: cap at 200 (reconcile only pages 200 payments).
- **MED — NWC connections lost on corrupt secure-storage JSON** (`nwc_providers.dart:149`): catch swallows, no SharedPreferences-legacy retry.
- **LOW** — Blocked words/authors uncapped; Cashu proofs grow per mint (consolidate). ~~relay-list `_save()` + quick-zap writes~~ — FIXED (item 17).
- ✓ Verified OK: AI chat store 300-message cap is real; EventStore prune budget is real.

### UI
- **MED — `PostCard.build` ≈ 460 lines** — extract `_PostHeader`/`_PostBody`/`_ActionRow` (AGENTS.md: widgets >100 lines get extracted). Same for articles_screen (323), compose_screen (319), settings_screen (297), cashu_wallet (246), nwc_screen (242), live_room (204).
- ~~**MED — `cashu_wallet_screen` dialog `setState` after `await`**~~ — FIXED (item 13, 8 sites).
- **MED — feed login-gate empty state hand-rolled** (`feed_screen.dart`) instead of shared `EmptyState`.
- **LOW** — 33 bare full-screen `CircularProgressIndicator`s (should be Skeleton*); invoice QR outer container hardcoded white; `nostr.publish` failures silent (consider `publishWithAck` for user-initiated posts).

## Rules added to AGENTS.md (this pass)
- Family provider keys must have VALUE equality (never `List`).
- Screen-watched FutureProviders are `.autoDispose`; keepAlive needs a comment.
- No second feed provider — feeds live on the Notifiers.
