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

## Open findings (prioritized backlog)

### State management
- **MED — `relayStatusProvider`** (`content_providers.dart`): derived pool state duplicated into a `StateProvider`, desyncs when the pool changes while Settings is closed. Fix: `StreamProvider` off a pool status stream, or read `pool.relayStates` + a pool version counter.
- **MED — `NotificationCenter` / `DmStore` are hand-rolled Notifiers**: mutable state in plain `Provider`s + manual version-counter pokes (`notificationVersionProvider`, `dmStoreVersionProvider`). Works, but every mutation rebuilds ALL watchers and the poke is easy to forget on a new path. Fix: convert to `Notifier<…State>` with immutable state (unread becomes a `.select`).
- **MED — Own-profile data in 3 places** (`authStateProvider.profile`, `NostrService.profileCache`, `profileProvider`) can show different names/avatars simultaneously. Fix: one read model — everything reads `profileProvider(auth.pubkey!)`.
- **MED — `_houseReconnect` timer unassigned** (`lnbits_live_providers.dart:139`): house-socket reconnect Timer isn't stored, so dispose/resync can't cancel it. Fix: `_houseReconnect = Timer(...)`.
- **LOW** — `followingFeedProvider` dead (unwatched, invalidated only); `notificationFilterProvider`/`searchQueryProvider` leak between visits (should autoDispose); `DmAlertBanner` schedules a 4s timer per rebuild (move auto-dismiss into `DmNotifier`).

### Storage
- **CRITICAL — ~10 raw `http.get/post` + `jsonDecode` blocks** bypass `ApiHttpClient`: `cashu_service.dart` (7), `lnurl_service.dart` (2), `admission_service.dart` (2). Fix: route through `ApiHttpClient.getJson/postJson`.
- **HIGH — DM in-memory caches unbounded** (`dm_store.dart:106-123`): `_decrypted`, `_liveEvents`, `_arrivalTs`, `_undecryptable` grow for the whole session. Fix: LRU cap ~500.
- **MED — `_persistOutbox()` writes the ENTIRE outbox JSON on every DM mutation** (7 call sites). Fix: 500ms debounce.
- **MED — AI `_creditedHashes` unbounded** in secure storage. Fix: cap at 200 (reconcile only pages 200 payments).
- **MED — NWC connections lost on corrupt secure-storage JSON** (`nwc_providers.dart:149`): catch swallows, no SharedPreferences-legacy retry.
- **MED — DM `_lastRead` watermarks grow per peer forever + full-map write per read.** Fix: debounce + cap 200 peers.
- **LOW** — Blocked words/authors uncapped; relay-list `_save()` per toggle (debounce); Cashu proofs grow per mint (consolidate); quick-zap amount write per tap (debounce).
- ✓ Verified OK: AI chat store 300-message cap is real; EventStore prune budget is real.

### UI
- **HIGH — 65 raw `ScaffoldMessenger.showSnackBar`** call sites (must be `AppToast.*`): worst files — post_card (8), identity_screen (7), lnbits_screen (6), nwc_screen (5), edit_profile/profile_screen (4+4), cashu_wallet_screen (4).
- **MED — `PostCard.build` ≈ 460 lines** — extract `_PostHeader`/`_PostBody`/`_ActionRow` (AGENTS.md: widgets >100 lines get extracted). Same for articles_screen (323), compose_screen (319), settings_screen (297), cashu_wallet (246), nwc_screen (242), live_room (204).
- **MED — `cashu_wallet_screen` dialog `setState` after `await` without mounted** (4 sites: ~431, ~436, ~476, ~693). Fix: guard with `ctx.mounted`.
- **MED — feed login-gate empty state hand-rolled** (`feed_screen.dart`) instead of shared `EmptyState`.
- **LOW** — 33 bare full-screen `CircularProgressIndicator`s (should be Skeleton*); invoice QR outer container hardcoded white; `nostr.publish` failures silent (consider `publishWithAck` for user-initiated posts).

## Rules added to AGENTS.md (this pass)
- Family provider keys must have VALUE equality (never `List`).
- Screen-watched FutureProviders are `.autoDispose`; keepAlive needs a comment.
- No second feed provider — feeds live on the Notifiers.
