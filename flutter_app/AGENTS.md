# NostrFeed Mobile — Agent Guide

Flutter app for NostrFeed. Riverpod 2.6 + go_router 16, feature-first architecture.

## Commands

```bash
flutter pub get
flutter analyze        # must stay at 0 issues in lib/
flutter test           # unit/widget tests (deterministic, no network)
flutter run --dart-define-from-file=.env   # debug run (needs .env — house wallet + OpenRouter keys; ./tool/run_app.sh wraps this)
```

Integration tests that hit **live relays** live in `integration_test/` — do NOT run them in CI.

Debug scripts (print-heavy, hit live services) live in `tool/`.

## Architecture

```
lib/
├── main.dart                 # entry point only
├── app/
│   ├── app.dart              # NostrFeedApp root widget
│   └── router.dart           # routerProvider (go_router) + appTransitionPage + NIP-19 loader
├── core/                     # shared, feature-agnostic
│   ├── config/env.dart       # compile-time env (--dart-define)
│   ├── models/nostr_models.dart   # NostrEvent, NostrFilter, NostrProfile, AuthState
│   ├── nostr/                # Nostr infrastructure
│   │   ├── kinds.dart        # NostrKinds — kind registry + NIP-01 classification (ADR-0002)
│   │   ├── nostr_service.dart     # facade: init, publish, event creation, delegates
│   │   ├── nostr_context.dart     # signing context shared by repositories
│   │   ├── report_types.dart      # NIP-56 report types
│   │   ├── relay/                 # relay plumbing
│   │   │   ├── relay_pool.dart    # WebSocket relay connections (NIP-42)
│   │   │   ├── relay_router.dart  # NIP-65 outbox routing (read/write relays)
│   │   │   └── dm_delivery.dart   # DM delivery routing (recipient inboxes)
│   │   ├── repositories/          # per-domain queries
│   │   │   ├── feed_repository.dart        # feed/lists/discovery queries
│   │   │   ├── engagement_repository.dart  # likes/reposts/zaps/interactions
│   │   │   ├── social_repository.dart      # profiles, follows, search, bookmarks
│   │   │   └── dm_repository.dart          # NIP-04 + NIP-17 DMs
│   │   └── usecases/              # domain operations (zap_receipts — NIP-57)
│   │       └── zap_receipts.dart  # zap receipt parse/validate/summarize
│   ├── providers/            # global providers, split by domain (ADR-0001)
│   │   ├── app_providers.dart           # BARREL: re-exports the three below
│   │   ├── nostr_service_providers.dart # NostrService singleton + init + exports
│   │   ├── auth_providers.dart          # auth state, profiles, follows, user posts
│   │   ├── content_providers.dart       # feed/trending/search/engagement/market…
│   │   ├── connectivity_providers.dart  # online/offline + reconnect watcher
│   │   └── app_info_providers.dart      # package_info (version from pubspec)
│   ├── moderation/           # content_filter (NSFW/spam) + providers
│   ├── services/             # app-level services (wallet_payment, http…)
│   ├── theme/                # app_theme, app_typography, app_shapes,
│   │                         # app_spacing, app_durations, app_motion
│   ├── utils/                # nip19, markdown, event_debugger, media, text_sanitize
│   └── widgets/              # shared UI kit: ErrorView, EmptyState, Skeleton*,
│                             # AsyncFeedList, AppSheet/AppDialog, app_shell,
│                             # profile_avatar, smart_network_image,
│                             # staggered_list_item, qr_scan_sheet, detail_scaffold
└── features/<feature>/       # one folder per feature (ADR-0001)
    ├── domain/               # models + pure logic + contracts (pure Dart)
    ├── data/                 # services/repositories impl (relay/API/storage)
    ├── application/          # feature-local Riverpod providers/notifiers
    └── presentation/         # screens + feature widgets (Flutter UI only)
```

Feature folders: articles, auth, bookmarks, bounties, calendar, chat,
communities, compose, docs, explore (explore+trending+hashtag), feed, groups,
identity, lists, live, market, memberships, notifications, p2p, premium,
profile, reels, sats_drops, search, settings, studio, wallet, zap.

> **The layout change is DONE (ADR-0001).** Every feature uses
> `domain/data/application/presentation`. Put new files in the right layer:
> models/pure logic → `domain/`, relay/API/storage calls → `data/`,
> providers/notifiers → `application/`, screens + feature widgets →
> `presentation/`.

Large screens are decomposed into feature-local `widgets/` (e.g.
`features/chat/widgets/` — message bubble, new message sheet, suggested
peers…; `features/wallet/widgets/` — payments list, address sections, sign-in
dialog…). Keep screen files focused on layout + wiring; extract any widget
over ~100 lines.

## Conventions (follow these)

- **Reconnection resilience**: relay sockets die when Android idles
  (~20min–1hr). The pool tracks persistent subscriptions and re-issues them
  on reconnect (`_resubscribeAll`); on app resume, `reconnectDead()` resets
  backoff and reconnects dead relays. Never assume a socket stays alive —
  always go through the pool's reconnect path, and never block resume on a
  single dead relay. **One-shot queries are NOT persistent**: query-style
  REQs (feed pages, engagement batches, profile lookups) pass
  `subscribeWithEose(..., oneShot: true)` so a reconnect does NOT replay
  them — replaying hundreds of stale one-shots on every reconnect was the
  REQ burst behind the hub's "too many concurrent REQs" rejections.
  **Good-enough query completion**: `_queryRemote` resolves as soon as ALL
  EOSE arrive OR every platform (T0 hub) relay answered (the hub's synced
  slice IS the complete answer) OR timeout — never blocked by the slowest
  fallback relay (divine-mobile #2669).

- **Imports**: always `package:nostrfeed_mobile/...` (never relative).
- **State**: Riverpod. All `FutureProvider`s use `.autoDispose`. All state
  notifiers use `Notifier`/`AsyncNotifier` (legacy `StateNotifier` is fully
  migrated — do not reintroduce it).
  - **Family keys must have VALUE equality** — key a `.family` on a
    `String`/record/value type, NEVER a `List` (identity equality: every
    literal is a new cache key, so invalidations silently miss and entries
    multiply — the `userInteractionsProvider([id])` bug).
  - **Per-entity families are `.autoDispose`** (replies/reactions/reposts/
    zapReceipts/articleComments/localEngagement…) — without it, entries
    accumulate for every entity seen and re-fire on every version tick.
    keepAlive is reserved for cross-screen caches every card reads
    (`profileProvider`, `bookmarkedIdsProvider`) and needs a comment.
  - **Feeds live ONLY on the Notifiers** (`globalFeedProvider`,
    `followingFeedNotifierProvider`) — never add a plain feed
    FutureProvider (it diverges from the store-backed state).
  - **Mutable app services are real Notifiers, never a Provider + manual
    version poke** (`NotificationCenter` + `DmStore` are the models: a
    `Notifier<…State>` emitting an immutable snapshot; watchers use
    `.select` for rebuild granularity). The old pattern (mutable singleton
    in a `Provider` + a `…VersionProvider` StateProvider poked after each
    mutation) is banned — every new mutation path had to remember to poke.
    `dmStoreVersionProvider` survives as a shim over
    `dmStoreProvider.select((s) => s.version)`; new code watches
    `dmStoreProvider` directly.
- **Post interactions** (like/repost/bookmark/zap refresh): go through
  `postActionsProvider` (`features/feed/providers/post_actions.dart`) — never
  inside widgets.
- **Every user action that changes a count/list MUST ingest into the store**:
  publishing to relays alone does nothing for the local SQL projections — the
  like/repost count didn't move until a relay round trip (the 2026-10 "like
  it, count stays" bug). `post_actions.toggleLike/toggleRepost` ingests the
  reaction AND the kind-5 deletion (the store lifecycle removes it from
  `event_refs`); `compose_screen` optimistically inserts new posts; replies
  already insert (the model). Counts recount instantly via the invalidation
  bus. Audit: `docs/AUDIT-pages-flows-features-2026-10-26.md`.
- **Every scrollable list of relay data MUST have pull-to-refresh** —
  including the empty + error states (a failed fetch must be retryable by
  gesture). Covered: feed/explore/trending/notifications/chat/articles/
  bookmarks/lists/communities/calendar/groups/live/reels/profile-tabs/
  memberships. Search re-queries per term (no gesture needed).
- **Swipe actions + long-press quick sheet (Threads/X muscle memory)**: a
  feed card swipes **right → bookmark, left → share** (`Dismissible` with
  `confirmDismiss` returning false — the card springs back, only the action
  fires; its controller idles between swipes like InkWell's splash, so it's
  feed-safe). Threshold 0.35 keeps vertical-scroll-vs-swipe unambiguous.
  **Long-press a card** → the quick-action sheet (`_showQuickActions` via
  `AppSheet`): Quote / Bookmark / Share / Copy text / Copy link / Mute author
  / Report — the fast path so users never hunt the 3-dot menu. Both are
  feed-only (never in `isThreadView`).
- **Post rendering** (`features/feed/widgets/note_content.dart` + friends):
  - Media URLs are classified by `MediaUtils.classify` (image/video/audio/
    other) — extensionless Blossom/media hosts default to image.
  - NIP-92 `imeta` tags are parsed by `MediaUtils.parseImeta` (dimensions,
    blurhash, alt, fallback) — portrait images keep their aspect ratio.
  - Videos render via `VideoCard` (direct files → in-app player, YouTube/
    Vimeo/etc. → branded external link).
  - Articles (kind 30023) ALWAYS render as `ArticleCard` preview → tap opens
    `ArticleReaderScreen`. Never render full markdown inline in feeds.
  - Article creation goes through `ArticleEditorScreen` (`features/articles/`)
    — NIP-23: markdown content, `d` tag identity, title/summary/image/
    published_at/t tags. The articles screen Write FAB opens it (login-gated).
  - Polls (kind 1068, NIP-88) render via `PollCard` with voting + tallied
    results (`PollResults.tally` follows NIP-88 counting rules).
  - A lone plain link in a short post gets a `LinkPreviewCard`.
- **Chat / DMs (ADR-0008 P1 — now a STORE projection)**: all DM decryption +
  conversation/thread assembly goes through `dmStoreProvider`
  (`features/chat/providers/dm_store.dart`). NIP-17 gift wraps can NOT be
  decrypted by their sender and have randomized timestamps — so sent messages
  must be shown from the store's local outbox, never by re-fetching from
  relays. `MessageBubble` is presentational only.
  **v5 rules (messaging store)**:
  - **Decryption runs OFF the UI isolate** via `DmCryptoWorker`
    (`core/nostr/dm_crypto_worker.dart`, 2 isolates) — `DmStore.prime` submits
    the batch off-thread, never `nostr.decryptDm` per-event on the frame
    thread (the "chat janky after opening" freeze).
  - **Decrypted plaintext is persisted DEVICE-ONLY** to `dm_messages` (like
    Signal's local DB — the wrap can't be re-decrypted by its sender). Every
    decrypted message → `EventStore.upsertDmMessage` (fire-and-forget on the
    writer lane). Direction = sender==me ? outgoing : incoming.
  - **`dm_threads`** = the conversation-list projection (peer, last_msg_at,
    last_read_at, unread_count). Incoming messages bump unread_count in ONE
    UPSERT; `markThreadRead` persists the watermark + resets unread. The chat
    badge = `dmTotalUnread()`. Outgoing messages never bump unread.
  - **Outgoing is durable**: `recordSent` → `dm_messages`(pending);
    `markStatus` → sent/failed (survives restart — the old SharedPreferences
    outbox aged out after 7 days). `dm_outbox` holds the signed wraps for
    failed-send retry (background sync).
  - **`clearAll` (logout) wipes `clearDmData()`** — the next account must
    never inherit the previous one's chats (cross-account plaintext leak).
  - Read methods: `dmMessagesFor(peer, until:)` (keyset-paged), `dmThreads()`,
    `dmThreadLastRead`, `dmTotalUnread`, `markDmThreadRead`, `recomputeDmUnread`,
    `enqueueDmOutbox`/`dmOutboxPending`/`updateDmOutboxState`/`removeDmOutbox`.
    Typed records in `core/db/db_models.dart` (DbMessage/DbThread/DbOutboxMessage).
- **Notification routing — deep-link to the TARGET, never the engagement**:
  a like/repost/zap/comment's thread opens the POST it happened on (the
  target `e`/`a` tag, resolved store-first → bounded relay fetch), NOT the
  engagement event itself — pushing the engagement event showed "Alice
  reposted your note" as a broken empty thread. `_NotificationTile` previews
  the TARGET's content (a like's own content is empty/wrong). Phone
  notifications + the in-app banner deep-link via `/note/<hexId>` (→
  `_EventLoader` → thread) and `/npub/<hexPk>` (→ profile; a new follower's
  profile); only unresolvable targets fall back to the author's profile
  (better than a broken thread). Background-sync notifications pass
  `targetEventId` the same way.
- **Notifications (ADR-0008 P2 — now a STORE projection)**: the bell is no
  longer a 200-entry memory list — every engagement event also persists to the
  `notifications` table (`NotificationCenter.ingest` → `upsertNotification`,
  fire-and-forget on the writer lane). The badge COUNT is an instant partial-
  index query (`WHERE read_at IS NULL`). `markAllRead` →
  `markAllNotificationsRead` (durable `read_at` stamp); `reset` →
  `clearNotifications` (no cross-account leak). Per-recipient rows
  (`recipient` col) are multi-account ready. Kinds map to `DbNotificationType`
  (7=like, 6/16=repost, 1/1111=reply, 9735=zap, 3=follow, else=mention).
  Recipient-awareness (`isNotificationForMe`) and the phone-notification
  dedup (`notified_event_ids_v1`) are UNCHANGED (separate concerns). Read
  methods: `notificationsFor(recipient, until:)`, `unreadNotificationCount`,
  `notificationWatermark`, `markAllNotificationsRead`, `markNotificationRead`,
  `clearNotifications`. Typed record `DbNotification` in `core/db/db_models.dart`.
- **Relay fleet (ADR-0008 P3 — tiered + scored + budgeted)**: relays are no
  longer a flat map broadcast-to-all. `RelayHealthTracker`
  (`core/nostr/relay/relay_health.dart`) assigns every relay a **tier**
  (T0 platform `relay.nostrfeed.com`+paid / T1 user / T2 curated / T3 ad-hoc)
  and an **EWMA score** (connect success 1.0/0.0, EOSE latency ∝ speed, events
  delivered; `score = 0.7·score + 0.3·sample`), persisted to `relay_health`
  (v7). Fleet hooks (`onConnectSuccess/Failure/onEose/onEventDelivered`) are
  connection-level callbacks wired by the pool's `_newConnection` factory —
  the connection stays transport-only. **`_queryRemote` is top-K fan-out**
  (`queryFanoutK = 4`): platform relay + top-K healthiest connected read
  relays, NOT all 9 — cuts server load + the client verify/merge flood (a slow
  relay self-demotes out of the K). **Ad-hoc (T3) pool is bounded** (≤4, LRU
  on a monotonic `_adhocSeq` — NOT wall-clock, which ties within a ms and
  evicts the wrong relay; platform/curated never evicted). **Author affinity**
  (`author_relays`): `recordAuthorRelay` on every dispatched event →
  `authorRelaysFor(pubkey)` outbox hint. Health flushes via `health.flush()`
  on backgrounding. Tests: `relay_health_test`, `relay_pool_adhoc_test`.
- **Search + media + publish outbox (ADR-0008 P4)**:
  - **FTS5 people search** (`profile_fts`, v8): `saveProfile` indexes name/
    display_name/nip05/about; `searchProfiles` uses FTS5 `MATCH` (indexed,
    prefix-aware) with a LIKE fallback on platforms without FTS5
    (`EventStore.ftsAvailable` feature-detects). Never a `json LIKE '%q%'`
    full scan — the FTS path is an indexed MATCH.
  - **Media metadata** (`media` table): `MediaUtils.persistImeta(event)` is
    called at render (note_content) after `parseImeta` — it writes dims/
    blurhash/mime so the NEXT render lays the tile out BEFORE the bytes load
    (no layout jump). Read via `mediaFor(url)` / `mediaForEvent(id)`.
  - **Publish outbox** (`publish_outbox`): `NostrService.publishWithAck` on
    failure (no relay acked) queues the signed event durably; background sync
    calls `retryPublishOutbox()` (bounded attempts, cap 10) so a failed
    post/reply/DM/zap eventually lands. Never silently lost.
  - **DM full-text search**: `EventStore.searchDmMessages(query, peer:)` —
    searches the DECRYPTED plaintext in `dm_messages` (local device copy
    only). Records: `DbMedia`/`DbPublishJob` in `core/db/db_models.dart`.
- **Per-table invalidation bus (ADR-0008 P5)** — rebuilds are SCOPED, never
  global. ONE global `engagementVersionProvider` used to bump on EVERY write
  (a DM write rebuilt feed cards). Now: per-table version counters
  (`StoreTable.events/eventRefs/profiles/dmMessages/dmThreads/notifications/
  relayHealth/media`) in `core/providers/store_invalidation.dart`.
  - **How it flows**: the writer lane's `_enqueueWrite(touches:)` declares
    WHICH tables changed → static `EventStoreHooks.onTablesChanged` (the
    Riverpod-free seam) → the bus bumps ONLY those counters (debounced 300ms
    per table — a sync burst = ONE bump). Wired at app root via
    `storeInvalidationWiringProvider` (BEFORE the ingest pipeline).
  - **How to listen**: a provider watches `tableVersionProvider(StoreTable.x)`
    — it rebuilds ONLY when THAT table's counter changes. `engagementVersionProvider`
    now DERIVES from `StoreTable.eventRefs` (same counter, sourced from the
    commit) — NEVER hand-poke a version (`…VersionProvider.notifier.state++`
    is the banned pattern); declare `touches:` on the store write instead.
  - **The result**: a like landing rebuilds ONE card's count (`eventRefs`), a
    DM landing rebuilds ONE thread (`dmMessages`), and NEITHER rebuilds the
    other — 60fps kept while writes land.
  - Tests: `store_invalidation_test` (DM≠engagement, engagement≠DM, burst =
    ONE bump, `bumpNow` immediate for user-initiated writes).
- **Negentropy sync (ADR-0008 P6)** — NIP-77 set reconciliation is now
  SYMMETRIC + PARALLEL + metered-aware (`core/nostr/sync/`):
  - **Upload half**: `_uploadMissing` publishes events WE have that the relay
    lacks (`haveIds` — it was computed then DROPPED before, one-way sync).
    Bounded by `NegentropySyncClient.uploadCap = 256` (a huge diff is a
    backfill job, not a sync). `uploadMissing:` toggle per call.
  - **Bounded-parallel**: `NegentropySyncService.syncAll` runs relays
    CONCURRENTLY via a worker pool (`parallelism = 4`) — was sequential (a
    slow relay's 40s worst case stalled the whole pass). One bad relay → null,
    never kills the others.
  - **Wi-Fi-only toggle**: `syncWifiOnlyProvider` (Settings). On metered
    (cellular) with the toggle ON, `syncNow` SKIPS the bandwidth-heavy NIP-77
    reconciliation; the light feed-refresh covers the gap. Empty/unknown
    connectivity = METERED (conservative). Background sync's other steps
    (feeds, DMs, wallet, publish-retry) always run.
  - Tests: `negentropy_p6_test` (upload delivers haveIds, uploadMissing off,
    parallel + bad-relay-tolerant, uploadCap bounds).
- **DB encryption-at-rest (ADR-0008 P7 — integration-ready, flag OFF)**:
  `core/db/db_encryption.dart`. SQLCipher is NOT vendored (offline + ADR-0004
  size budget), so this is the TESTED abstraction, not a native dep:
  `DbEncryptionKeys` (256-bit DB key in hardware-backed secure storage —
  generate/persist/rotate/destroy, never logged/backed up) + the
  `DB_ENCRYPTION` dart-define flag wired into `EventStore._open` +
  `migrationNotes` (the `sqlcipher_export` plain→encrypted path, never
  rewrite-in-place). To activate when pub.dev is reachable:
  `flutter pub add sqflite_sqlcipher`, set `DB_ENCRYPTION=true`, uncomment
  the `password:` line in `_open`. Default OFF = plain open (zero risk to
  existing installs). The 100k ops plan is `docs/RELAY-SCALING-RUNBOOK.md`.
- **NIP-17 chat kinds**: rumor kinds are 14 (chat), 15 (file), 7 (reaction) —
  `unwrapGiftWrap` accepts all three. Replies use an `e` tag to the parent
  rumor (`createNip17Dm(replyToId:)`), room names use the `subject` tag,
  disappearing messages use the `expiration` tag (NIP-40). Group DMs via
  `createNip17GroupMessage` (one wrap per member + self).
- **NIP-29 group chat**: `GroupChatScreen` (`features/groups/`) — kind 9/11/1
  messages tagged with the group's `h` id. Fetch via `fetchGroupChat`, live
  via `subscribeGroupChat`, send via `createGroupChatMessage`. Groups are
  created via `CreateGroupSheet` → `createGroup` (kind 39000 with open/closed
  + public/private flags); join via kind 9021, leave via 9022, admin actions
  via kinds 9000/9001/9005. Admin deletes are long-press on bubbles.
- **Reels (NIP-71)**: kind 22 = short-form portrait, kind 21 = landscape.
  Playable source + poster live in `imeta` tags. Fetch via `fetchVideos`
  (kind 22/21 + kind-1 video-URL fallback), play via `_ReelVideoSource`
  (imeta first, body URL fallback), upload via `ReelUploader` → Blossom +
  `createVideoEvent` (b.nostr.build gives a free `?poster` frame).
- **Lists (NIP-51)**: follow sets are kind 30000 (addressable, `d` tag
  identity — same `d` replaces). Model: `features/lists/models/nostr_list.dart`.
  Mutations via `listControllerProvider` (create/update/addMember/removeMember/
  deleteList → `_invalidate(followSetsProvider)`). Feed via `listFeedProvider`
  (posts by member pubkeys). Delete via `deleteFollowSet` (NIP-09 kind 5).
- **Calendar (NIP-52)**: events are kind 31922 (date-based) / 31923
  (time-based, addressable with `d` tag + `D` day-index tag). RSVPs are kind
  31925 with `a` (coordinate), `e` (event id), `status` (accepted/tentative/
  declined), `p` (organizer). Providers in `features/calendar/providers/`;
  latest RSVP per pubkey wins for counts/status.
- **Communities (NIP-72)**: definitions are kind 34550 (addressable), posts
  carry the community `a` tag, approvals are kind 4550 (full post JSON in
  content). Join/leave via kind 10004. Feed = approvals + a-tagged posts
  (deduped). Posts note "pending moderator approval".
- **Live streaming (NIP-53)**: activities are kind 30311 (addressable, `d`
  tag). Users go live via `GoLiveSheet` (kind 30311 with streaming URL, title,
  summary, cover, status=live, host p tag). Live chat is kind 1311 bound to
  the activity coordinate via `createLiveChatMessage`. Stale live events (no
  update for 1hr) render as ended. **Text sanitization**: relay data can carry malformed UTF-16 (lone
  surrogates) that crashes the text engine — `NostrEvent.fromJson` and
  `NostrProfile.fromJson` sanitize at the source, and `_extractContent` in
  `note_content.dart` sanitizes before parsing. Never render raw event
  strings without going through these paths.
  Delivery status is tracked via `MessageStatus` (pending → sent after
  `publishWithAck`, failed → tap to retry / long-press to delete). Unread
  counts use per-peer last-read watermarks (`markThreadRead`) — the chat tab
  badge shows TOTAL unread, and `dmNotifierProvider` shows an in-app banner
  for incoming DMs. Incoming DMs arrive via the real-time subscription
  (`dmLiveEventsProvider` → `dmLiveListenerProvider` → `DmStore.ingest`) —
  NIP-17 backdates created_at up to 2 days, so unread/banner decisions use
  ARRIVAL time (`arrivalTsOf`), never the event's created_at. When a thread
  is marked read, `markThreadRead` CLAMPS known live events to the watermark
  (`_clampReadEvents`) — without it the live subscription re-delivers them
  and re-fires unread counts + banners (the "opening chat re-notifies" bug).
  The DM banner only alerts on genuinely unread messages (`isUnreadFrom`).
- **First-run onboarding** (`features/auth/presentation/onboarding_screen.dart`):
  shown ONCE after a fresh install's first login (stamp
  `onboarding_completed_v1`, checked by `OnboardingScreen.needsOnboarding()` in
  the login flow's `_goPostAuth` — returning users never see it). Three
  skippable screens: **key backup** (`KeyBackupService.saveKeyFile` — the one
  thing a user can lose forever), **interest chips → seed follows** (trending
  community authors from `trendingProvider(24)`, same source as Explore's
  People-to-follow — NO hardcoded celebrity list; the hub syncs their content
  so the Following tab is alive on day one), **notifications**
  (`LocalNotificationService.init`). Always one-tap "Skip" — forced onboarding
  reads as an ad. Route: `/onboarding` (no shell).
- **Empty state → ACTION, never a dead end**: the Following tab's empty state
  offers "Discover people" (→ `/explore`) instead of a dead "no posts" message
  for a brand-new account; errors offer retry. Per NN/g empty-state guidance —
  every empty container answers "what do I do next".
- **Auth race guard**: `AuthNotifier._init` restores the session async; it
  MUST NOT overwrite state if `state != _initial` when the read resolves
  (an explicit login/logout/test-write beat it). Keep this guard. The user's
  profile is also persisted to secure storage (`saveStoredProfile`) so cold
  starts show it immediately.
- **NIP-65 outbox model**: profile/metadata fetches route through
  `relayRouter` (`core/nostr/relay_router.dart`) — query a user's WRITE
  relays for their events, publish to their READ relays for mentions/DMs.
  `fetchProfile` order: TTL cache (10 min) → default relays → user write
  relays → indexers. **Interactions** (like/repost/reply/comment/delete)
  publish via `nostr.publishEvent(event)` — it acks on our relays AND
  republishes to tagged users' read relays in the background. Never call
  `nostr.publish()` for events with p-tags.
- **Tier-aware DM delivery** (`core/nostr/relay/dm_delivery.dart`): NIP-17
  gift-wrap routing is admission-aware. **Paid↔Paid** (BOTH parties admitted
  to `paid.nostrfeed.com`, checked + sticky-cached per session) → the wrap
  goes to the PAID relay only — premium DMs never touch the free hub or
  public relays. **Everyone else** → recipient's kind-10050 inbox (1–3
  relays) or the small `fallbackDmRelays` set (primal/damus/our hub).
  Admitted users auto-connect to the paid relay at startup
  (`paidRelayAutoConnectProvider`, watched at app root) so paid-lane DMs
  arrive LIVE — the paid relay previously only connected when the Premium
  screen was opened, so incoming premium DMs waited for a manual refresh.
  A new admission invalidates the routing cache (`DmDelivery.invalidate`).
- **NIP-17 self-copy**: `signGiftWrap` seals EACH wrap to its own target
  (recipient copy → recipient, sender copy → sender). Never share one seal
  between wraps — the sender can't decrypt it (this caused "unable to decrypt").
- **DM banner**: `DmAlertBanner` lives ABOVE the router (MaterialApp.builder)
  — navigate via `ref.read(routerProvider).push(...)`, never `context.push`.
- **Phone notifications never repeat (the "again and again" fix)**:
  `LocalNotificationService.show` takes `eventId` + `collapseKey`. The
  **notified-id set** (persisted `notified_event_ids_v1`, 500-cap) means an
  event fires a phone notification EXACTLY ONCE ever — the historical-fetch
  replay after a restart can NOT re-notify old likes/zaps/follows/DMs.
  **Burst collapsing** (30s window, per type+collapseKey) replaces the
  previous notification with a count ("Alice and 5 others liked your post")
  instead of stacking 30 — Instagram-style. Callers pass
  `eventId: event.id` + `authorPubkey: event.pubkey` (see
  `notification_center.dart`); DMs pass `eventId` + `peerPubkey`. The in-app
  social banner throttles same-author bursts to 4s. Never call `show` for a
  relay-sourced event without its `eventId`. `resetNotifiedIds()` runs on
  logout/account-switch.
- **Freshness caches** (`profileCache`/`followsCache`) are instance state on
  `NostrService`, injected into `SocialRepository` — never static globals.
- **Auth & routing**: `routerProvider` redirects to `/login` when signed out
  (and away from `/login` when signed in) — never push `/login` manually as
  a substitute for signing out. Sign-out goes through the drawer confirmation
  dialog (`AppShell._confirmLogout`).
- **Key backup**: use `KeyBackupService.saveKeyFile` (auth feature) to export
  nsec as a file — offered at signup and from the Identity screen.
- **Toasts**: always `AppToast.success/error/info/warning` — never raw
  `SnackBar(content: Text(...))`. Toasts auto-replace (no stacking) and
  strip `Exception: ` prefixes.
- **Navigation architecture (v2.2 — the drawer is GONE)**: bottom nav =
  **Home · Explore · Create (center) · Chat (badge) · Wallet**. The center
  CREATE button opens a create sheet. **Explore is tab 2.** The **top bar is
  clean**: logo+name … search, bell, **avatar → /you**. There is **NO
  hamburger and NO 3-dot** — the drawer was removed entirely, and the 3-dot
  was replaced by the avatar.
  **Where everything lives (one home each, no duplicates)**:
  - **Tabs**: Home, Explore, Create, Chat, Wallet.
  - **/you** (avatar, the single account hub): profile header, quick stats,
    soft-update banner, Studio, Premium, Memberships, Bookmarks, Lists,
    Switch account, Appearance (theme sheet), Identity, Settings, Docs,
    Sign out.
  - **Explore "Browse" chip row**: Trending, Articles, Calendar, Communities,
    Groups, Live (the drawer's old Discover/Communities items — the drawer is
    dead, these moved to the discovery tab).
  - **Wallet "Earn" tab**: Drops, Bounties, Goals, Market, P2P, Names +
    creator shortcuts (Studio/Memberships/Premium).
  - **Theme switcher**: /you → Appearance (was the 3-dot's only job).
  The old `_ShellOverflowMenu`, `ModernDrawer`, `_DrawerHeader`, `_DrawerItem`
  and friends were deleted from `app_shell.dart`.
  **Refined nav (v2.1)**: the bar is FLAT — a 56 dp row on `surface` with a
  0.5 dp `outlineVariant` hairline top border (NO floating pill, NO shadow).
  The active tab shows a small 18×3 top accent tick in `primary`
  (`AnimatedContainer`, `AppMotion.fast`). Icons are the Refined stroke SVG
  set via `AppIcon` (see below). The Create slot is an OUTLINED capsule
  (1.5 dp `onSurfaceVariant` border, `radiusFull`, a `plus` AppIcon) — it's an
  action, not a destination, so it never gets the tick. **Long-press the
  Create capsule → the command palette** (`showCommandPalette`). The
  shell AppBar + bottom nav are **hidden on immersive routes** (chat threads,
  reels player) which render their own headers. Drawer is grouped by intent
  (Discover / People / Money / You) — never a flat 20+ item list. Detail
  routes use `DetailScaffold` (back button + title). Never hand-roll a drawer
  button inside a screen (it resolves to the inner drawer-less Scaffold).
  **Layout refinements (v2.1)**: (1) the **create sheet** leads with the two
  80% actions (Ask AI + Post as full rows) and compresses Article/Reel/Live/
  Group into a 4-icon grid (`_CreateGridButton`); (2) the **"You" surface**
  (`/you`, `features/profile/presentation/you_screen.dart`) is the profile hub
  behind the feed-tab-row avatar — profile summary + quick stats + grouped
  rows (Create & earn / Library / Account), the contextual alternative to
  spelunking the drawer; (3) the **wallet quick-rails** (`_QuickRail` in
  `wallet_screen.dart`'s Wallets tab) surface Earn (Drops/Bounties/Goals),
  Creator (Studio/Memberships/Premium) and Trade (Market/P2P/Names) as
  horizontal nav cards so the money features stop hiding in the drawer.
  (4) the **command palette** (`core/widgets/command_palette.dart`,
  `showCommandPalette`) is the ⌘K-style universal launcher — LONG-PRESS the
  center Create capsule to open it from any screen: search field (submits to
  `/search`), Nova AI lead (gated on `aiAvailableProvider`), Create rows
  (Post/Article/Reel/Live/Group), and Navigate rows (tab destinations use
  `context.go`, detail routes `context.push`).
  **Home top bar (v2.1)**: the shell AppBar leading is a custom stroke `menu`
  AppIcon (NOT the default Material hamburger) that opens the drawer; the
  feed tab-row AI shortcut is a stroke `sparkle` AppIcon (NOT
  `auto_awesome_rounded`). **The drawer uses AppIcon throughout** —
  `_DrawerItem` and `_HeaderChip` take a `String` stroke-icon asset name
  (converted from `IconData`), so every drawer row renders the Refined SVG
  set.
  **Explore tab (v2.1)**: as a tab, `ExploreScreen` renders NO internal
  AppBar (the shell owns it). Its sections use the shared `_SectionHeader`
  (uppercase accent label), the AI card is a QUIET hairline card with an
  accent icon tile (NO gradient — discovery, not an ad), and People-to-follow
  cards are hairline-bordered (`surfaceContainerLowest` + `outlineVariant`
  border), not filled `surfaceContainerHighest`.
  **Gradient discipline (v2.1)**: NO `LinearGradient` except the logo mark.
  Sweep done across chat (AI tile avatar + send button → flat accent
  circles), wallet (LNbits + NWC balance cards → quiet dark-ink
  `inverseSurface` statement cards with `tabularFigures` amounts), and
  profile (no-banner fallback → quiet `surfaceContainerHigh` tint). The
  `tertiary` role now equals the accent, so chat "mine" bubbles read as
  `#2F6BFF`/`#6B96FF` automatically (MessageBubble spec unchanged: flat
  `tertiary` mine / `surfaceContainerHighest` theirs, no gradient).
  **Wallet tabs (v2.1)**: Earn/Creator/Trade are a FIRST-CLASS **"Earn" tab**
  in the wallet's TabBar (`_earnTab`), NOT buried at the bottom of the
  wallets list. LNbits view tabs: Wallets / Earn / Activity / Settings. NWC
  view tabs: Earn / Transactions / Zaps / Settings. There is NO separate
  settings icon at the top of the Wallet screen — settings lives in the
  TabBar's "Settings" tab (the top icon read as redundant clutter).
  **Full-screen sweep (v2.1) — COMPLETE.** Every screen in `lib/features/` is
  on the Refined system: hairline cards/rows (`surfaceContainerLowest` +
  `outlineVariant` border, NOT filled containers or elevation), ZERO
  `LinearGradient` except the logo mark, dense `textTheme` type (section
  headers = uppercase accent `labelSmall`), `AppShapes`/`AppSpacing` radii +
  spacing, stroke `AppIcon`s everywhere, zap = muted amber (`zapFor` for AA),
  status pills = `AppStatusColors`, amounts = `tabularFigures`. Covered:
  notifications (icon-coded grouped rows + unread tint), articles + editor
  (hairline cards, read-time overlay), communities + detail + groups +
  group-chat (flat-accent bubbles), live + room + go-live (status-first
  cards, ended dimmed), settings + relays (swatch appearance picker, icon
  tiles), identity + login (flat hero mark, trust note, npub/nsec cards),
  docs, premium (dark-ink hero + pillar cards), studio (bar chart, stat
  cards), memberships + tier cards (popular = primary border), market,
  p2p (escrow note), bounties, sats-drops, lists + detail, calendar
  (date-block rows), bookmarks, search (pill field), compose, reels,
  ai-chat (credit cost in zap amber). Bare `icon: Icons.x` IconData-params
  (EmptyState/ErrorView/FilledButton.icon/menu helpers) intentionally stay
  Material.
- **AI Assistant visibility** (gated on `aiAvailableProvider` so keyless
  builds never tease it): the create sheet leads with "Ask AI", and the
  Home feed's tab row has a compact ✨ shortcut button next to the avatar
  (the shell AppBar stays at 3 actions — search, notifications bell,
  overflow — Primal's app bars never stack 4+ trailing icons). Drawer entry
  lives under
  Discover → AI Assistant; the guide is in Docs (route `/ai`). The AI chat
  itself is a detail route outside the shell. **No in-feed promo card** —
  an `_AiPromoCard` used to be injected into the For You feed; it was
  removed (read as an ad). Don't re-add promo cards to the feed.
  NOTE: never make AI a third home Tab — the TabController's length is fixed
  at init while AI availability resolves async (recreating it mid-build
  crashes `SingleTickerProviderStateMixin`).
  **Detail routes** (everything outside the 4 tabs: lists, calendar,
  communities, profiles, settings, etc.) are OUTSIDE the shell — they get
  NO AppShell, so they MUST use `DetailScaffold` (`core/widgets/
  detail_scaffold.dart`) which provides a working back button + title +
  actions. Never leave a detail screen without an AppBar.
- **Profile tabs**: Likes = posts the USER liked via `userLikedPostsProvider`
  (their kind-7 targets — never filter their own feed for kind 7, that's
  always empty). Followers/Following stats are tappable → `UserListScreen`.
  Communities tab shows joined (kind 10004) + created (kind 34550).
- **Nostr access**: go through `nostrServiceProvider` (facade). Repositories
  are also exposed as `nostr.feed`, `nostr.engagement`, `nostr.social`,
  `nostr.dms` — prefer those for new code.
- **Shared UI — never copy-paste these again**:
  - Errors → `ErrorView` / `ErrorView.fromError`
  - Empty states → `EmptyState(icon:, title:, subtitle:)`
  - Loading → `SkeletonList` / `SkeletonBox`/`SkeletonLine`/`SkeletonCircle`
    (never hardcoded white containers — dark mode)
  - Feed-style async lists → `AsyncFeedList<T>`
  - Bottom sheets → `AppSheet.show`; confirms/alerts → `AppDialog.confirm/info`
  - Buttons → `AppButton.primary/secondary/outline/destructive/ghost`
    (supports `loading:` spinner + `expand:` full-width)
  - Content cards → `AppCard` (flat, `surfaceContainerLowest`, radiusLg,
    optional `onTap` ink)
  - Count badges (nav/bell/unread) → `AppBadge.count` (auto "99+" cap)
  - Status pills (live/ended/active/expired) → `StatusBadge.error/info/
    success/warning` (driven by `AppStatusColors`)
  - Brand lockup (AppBar, login hero, splash) → `BrandLogo` (gradient bolt
    tile + two-tone "nostr"+"feed" wordmark; `compact:` for tile-only)
- **Token guardrail**: `tool/token_guard.sh` fails CI when raw
  `Colors.*`/`BorderRadius.circular`/`TextStyle(` counts in `lib/features/`
  GROW beyond the recorded baseline (`tool/.token_guard_baseline`) — run it
  before committing UI changes; migrate DOWN with each screen touch. Rare
  deliberate escapes (QR white backgrounds, video scrims) take an inline
  `// token-guard: allow` comment. **The grep EXCLUDES
  `AppActionColors.*`/`AppStatusColors.*`** (those ARE the tokens — the
  naive `Colors\.[a-zA-Z]` regex used to count them as violations and
  punished token migrations; tightened 2026-10). Re-baseline DOWN only.
- **Studio earnings hero (M3E emphasized type)**: the Studio earnings screen
  leads with `_EarningsHero` — the sats total as `displaySmall` (the number
  the screen exists for is the biggest thing on it) with a **count-up
  animation** on window change (`TweenAnimationBuilder`, implicit — no
  per-screen controller), zap-amber, trend delta in success/error. Money
  moments get display type; the chart + stat row stay quiet hairlines.
- **Design tokens**: spacing → `AppSpacing`; timeouts → `AppDurations`;
  status colors → `AppStatusColors`; engagement action accents (zap amber,
  like rose, repost green, bookmark blue — the MUTED Refined palette) →
  `AppActionColors` (zap is brightness-aware via `zapFor(brightness)` for AA;
  the `zap` const is the dark fallback for `const Icon` sites); brand
  gradient → `AppTheme.brandGradient`;
  typography → `Theme.of(context).textTheme.*` (the `AppTypography` ramp —
  never a raw `TextStyle(fontSize:)` in new code); corner radii →
  `AppShapes` (xs 4 / sm 8 / md 12 / lg 16 / xl 20 / pill 28 — never a new
  hardcoded `BorderRadius.circular(N)`).
  **The shared UI kit is 100% token-based** (`core/widgets/*` — shell,
  sheets, toasts, skeletons, empty/error views, dialogs, avatar, safe
  image). Feature screens still have legacy hardcoded radii/fontSizes —
  migrate them to `AppShapes`/`textTheme` opportunistically whenever you
  touch a screen (map to the NEAREST token; keep deliberate micro-styles
  like badge text).
- **PostCard layout (Primal grid)**: avatar in a fixed LEFT column; header,
  content and the action row in ONE column indented right (avatar width +
  10); the repost notice aligns with the content column. Card padding is a
  tight 12h/10v. **Post body text is the Refined reading style — 13.5px with
  a 1.5 line-height** (`note_content.dart`'s `defaultStyle`; the M3 ramp's
  bodyMedium stays 14 for sheets/cards). The action row uses `AppIcon` stroke
  SVGs (comment/repost/heart[zap]bookmark/share) with `AppIconSize.md`;
  action colors come from `AppActionColors` — inactive stays muted grey,
  active gets the per-action accent; zap keeps its signature amber as an
  invite (`zapFor(brightness)`). Don't move content back under the avatar —
  the indent IS the look.
- **Thread connector lines (Primal chain)**: `PostCard.drawLineAboveAvatar` /
  `drawLineBelowAvatar` paint a 2 dp chain segment behind the avatar column
  (`_ThreadConnectorPainter`, stops at the avatar edge, never crosses it).
  The thread screen sets them by index adjacency — header connects down to
  the first reply, every reply connects up, all but the last connect down.
  Replies keep `isThreadView: false` (stay tappable, no per-card fade).
- **Profile cover (Primal ProfileTopCoverBar)**: compact 140 dp cover +
  40 dp avatar overlap (NOT X's tall banner — the cover is a backdrop, not
  the content). Collapse scrim fades to black-70% over the cover, and the
  profile name fades into the collapsed title slot only when
  `innerBoxIsScrolled`. Geometry lives in `_ProfileScreenState` constants
  (`bannerHeight`/`avatarRadius`/`avatarOverlap`) — the skeleton loader
  uses the same constants so it never drifts.
- **Media gallery (Primal attachment layouts)**: `_ImageGallery` in
  `note_content.dart` lays out by count — 1 image keeps its aspect (imeta
  dims), 2 = two squares, 3 = one 2:1 banner + two squares, 4+ = a 2×2 grid
  with a "+N" overlay on the last cell (Primal's `MaxDisplayImages = 4`).
  2 dp gaps; tiles fill their `AspectRatio` cells via `SizedBox.expand`
  (a `CachedNetworkImage` with no height collapses to intrinsic size).
- **"N new posts" pill (Primal NewPostsButton)**: the pill carries up to 3
  stacked author avatars (`FeedState.newPostAuthors` — distinct, newest
  first, capped 3) + a count capped at "20+". The avatar stack resolves
  pictures from the shared `profileProvider` cache (no extra fetches — the
  live tail's authors were prefetched with their page).
- **Zap sheet preset grid (Primal ZapBottomSheet)**: `_ZapPresetCell` — a
  3-column grid of square emoji+amount cells with Primal's exact presets
  (👍21 🚀420 ☕1k 🍻5k 🍷10k 👑100k). Selected = surface bg + 1 dp
  `tertiary` border; unselected = `surfaceContainerHighest`. The emoji IS
  the amount's identity in Nostr culture — keep them paired.
- **Chat bubbles (Primal ChatMessageListItem)**: `MessageBubble` is 8 dp
  with a 2 dp "tail" corner nearest the sender — tail on the BOTTOM for the
  first message of a same-sender run, on the TOP for continuations
  (`isGroupContinuation`, computed from the NEXT item in the reversed
  list). Mine = flat `colorScheme.tertiary` (Primal `#0C7DD8`, white text);
  theirs = `surfaceContainerHighest`. NO gradient on the bubble — flat is
  what makes Primal's chat read native.
- **Brand color = Refined accent** (`core/theme/app_theme.dart`) — one
  confident blue, used sparingly (Refined direction v2.1). The schemes are
  HAND-SPECIFIED (never `ColorScheme.fromSeed` — M3's seed algorithm skews
  violet→blue and picks murky surfaces, the original "bluish-muddy"
  complaint). Light mode: `#2F6BFF` primary on a whisper-grey `#F7F8FA` page
  (so pure-white cards lift with hairlines); dark mode: `#6B96FF` on
  warm-neutral space `#0E0F13`. Surfaces are NEUTRAL (de-blued) — content
  carries the color, chrome stays quiet. All text pairs pass WCAG AA. Change
  the brand by editing `_brand`/`_brandDark` only — the app uses
  `colorScheme.*` tokens throughout, so it re-themes at once. (History:
  violet seed → Lightning amber → ice blue `#0A66C2` → **Refined `#2F6BFF`
  on neutral surfaces**; the earlier three were reverted on review.)
  **AppIcon icon system**: UI chrome uses the Refined stroke SVG set —
  `AppIcon('name')` (`core/widgets/app_icon.dart`, assets in
  `assets/icons/*.svg`, 24-viewBox, 1.75 stroke, recolored via
  `BlendMode.srcIn`). Sizes via `AppIconSize` tokens (xs 13 / sm 16 / md 18 /
  lg 21 / xl 24). **Migration COMPLETE**: the shell (nav + AppBar), PostCard
  engagement row, and every feature screen (feed/thread/compose, chat + DM
  widgets, zap, wallet + all wallet sub-screens & dialogs, profile + edit +
  user-list, settings + relays, articles + editor, premium + bunker/nwc
  cards, identity + nip5 tiles, login, ai-chat + model picker, search,
  calendar, market, bounties, reels + uploader + video card, live + go-live +
  room, communities, groups, memberships + tier cards, p2p, sats-drops,
  lists, boost, studio + zap-goal cards, notifications) use `AppIcon` for
  display icons. **Emoji survive ONLY in the zap preset grid** (cultural
  shorthand for amounts) and as user CONTENT — never as UI icons.
  **IconData-typed params stay Material**: `EmptyState`, `ErrorView`,
  `AppButton.icon`, `AppToast`, `PopupMenuItem` helpers and feature-local
  `IconData` helpers (e.g. wallet's `_walletCard`) still take `Icons.x` —
  convert a display `Icon(Icons.x)` or a Widget-param `icon: Icon(Icons.x)`
  to `AppIcon`, never a bare `icon: Icons.x` param.
  **The `surfaceContainer*` ladder is hand-specified too** (lowest →
  highest) in all three schemes — left unspecified, Flutter computes them
  with its own tint and the murk comes back. Light: lowest is pure white
  (cards pop above the ice-white base). Dark/OLED: lowest steps DOWN to
  near-black, highest = `#222B34` (the pill/chat-bubble tone). Monotonicity
  + AA contrast are pinned by `test/core/theme/app_theme_test.dart` — run
  it after ANY scheme edit.
- **Three appearances**: System / Light / Dark / **OLED Black** (true-black
  AMOLED variant of dark — opt-in only, some panels smear on pure-black
  scroll). The user's choice PERSISTS via `appAppearanceProvider`
  (`core/providers/theme_providers.dart`, SharedPreferences-backed — the
  old in-memory provider reset to System every cold start). OLED swaps the
  dark THEME in `app.dart` (`darkTheme: AppTheme.oledTheme`); the resolved
  `ThemeMode` stays `dark`.
- **Motion (ADR-0003)**: every animation uses `AppMotion` tokens (durations,
  curves, stagger) — never magic numbers. This includes scroll-to
  animations (`animateTo`/`ensureVisible`), `AnimatedContainer`/`AnimatedPositioned`
  durations, image fade-ins (OctoImage `fadeInDuration` too), and list
  stagger formulas. **The sweep is 100% DONE — zero non-token UI animation
  durations remain in lib/** (`Future.delayed`/`Timer` network debounces,
  toast display durations, and connect waits are NOT animations and stay
  as-is). Cheap approaches first: Hero +
  implicit animations + go_router `appTransitionPage` (0 KB);
  `flutter_animate` for staggered entrances (`StaggeredListItem` for list
  rows; `PostCard` fades in ONLY in thread view — never in a feed, see the
  feed-performance rule below); feed images Hero-fly to fullscreen (SVGs
  excluded). Rive is deferred (≤2 signature moments, NDK pinned) — do NOT
  add it without an ADR change.
- **Engagement micro-animations (2026 micro-delight)**: like / repost / zap
  play an **activation burst** on the tap that ACTIVATES them — an icon pop
  (emphasis overshoot) + a thin ring pulse in the action's accent (like rose,
  repost green, zap amber). `core/widgets/engagement_burst.dart`
  (`EngagementBurst`) wraps each action icon via `_ActionButton.burstKey`.
  **The burst is an EVENT, not a state** — the card bumps a counter ONLY on a
  user tap that activates (never on un-like, never on a rebuild that merely
  shows an already-liked post), so a feed of pre-liked posts does NOT replay
  15 bursts on every scroll. Zap bursts fire on a completed payment
  (`showZapDialog` returns `true` when an in-app wallet pays) and on
  quick-zap `sent`. Feed-perf rule kept: **no per-card AnimationController**
  — each burst is a self-disposing `TweenAnimationBuilder` that mounts, plays
  ~450 ms, disposes (zero idle tickers). Un-activate taps stay quiet (X's
  exact rule).
- **Feed performance (scroll jank)**: a feed `PostCard` rebuilds on EVERY
  provider fan-out (engagement, zaps, profiles landing as pages arrive), so
  anything expensive per-build must be memoized per event or it re-runs
  constantly as the feed grows. Memoized already: the content regex parse +
  media split + imeta (`_NoteParseCache` in `note_content.dart`), the repost
  embedded-event JSON decode (`_RepostCache` in `post_card.dart`), the
  timeago label (`_TimeAgoCache`), and the content-filter verdict
  (`_VerdictCache` keyed on `filterConfigVersionProvider` — a config change
  re-filters, an engagement landing does not). Never put a per-card
  `AnimationController` or an unmemoized `jsonDecode`/regex/`normalize` in a
  feed card's `build`. The feed `ListView` also uses stable `ValueKey`s +
  `scrollCacheExtent` so Flutter reuses elements as the list grows.
- **Avatars crossfade, never flicker** (`core/widgets/safe_image.dart`):
  `SafeAvatar` uses `OctoImage` so the photo FADES IN OVER the initial
  letter — the old `CachedNetworkImage(placeholder: fallback)` hard-swapped
  letter→photo every load (the "shows a small K then the image" flicker).
  Errors still fall back to the initial; never remove the error boundary.
- **Media-only / kind-20 posts render their media** (`note_content.dart`):
  NIP-68/NIP-92 media can live ONLY in `imeta` tags with empty `content`
  (picture-first clients). `splitForRender` merges imeta media URLs into the
  gallery, `_ParsedNote` falls back to the `title` tag as caption, and the
  card only collapses when there's genuinely nothing (no text AND no
  media). Returning `SizedBox.shrink()` on empty content alone was the
  "post shows a name, no content" bug.
- **The WHOLE card collapses when there's nothing to show**
  (`NoteContent.hasRenderableContent`): a card with author + action bar but
  no body reads as a bug ("name, no post"), so PostCard returns
  `SizedBox.shrink()` for non-article kinds when there's no text, no media,
  AND no quote. Articles (30023) render via ArticleCard and are exempt.
  Multilingual content (CJK/Arabic/Hindi/emoji) is NOT stripped —
  `sanitizeText` only drops lone UTF-16 surrogates, and the content
  filter's homoglyph fold does NOT false-positive genuine non-Latin text
  (verified). Never add ASCII-only filtering — it's the
  "non-English posts vanish" trap.
- **Thread context** (`thread_screen.dart`): opening a reply shows an
  "In reply to @name" banner (`_ReplyContextBanner`, parent resolved
  store-first) above the post, and replies attach to the thread ROOT.
- **Encrypted/token payloads render as CARDS, never base64 walls**
  (`core/utils/encrypted_content.dart` + `ecash_token_card.dart`):
  `classifyEncrypted` returns the payload class (nip04 `?iv=`, ecash
  `cashuA/B`, colonCipher, bareBase64, schemePayload) — prose with spaces,
  URLs, and multilingual text are NEVER classified. `NoteContent` renders
  `EcashTokenCard`: Cashu `cashuA` is decoded to amount+mint (base64 JSON,
  `decodeEcash`), `cashuB` (CBOR) shows "ecash token (v4)", other ciphertext
  shows a compact "Encrypted content" card with a copy button. Nothing is
  hidden and nothing dumps base64 into the feed.
- **scheme://action/base64 app payloads decode to cards**
  (`decodeSchemePayload`): `bala://offer/<base64-JSON>` and similar
  app-specific payloads (WebRTC call offers, etc.) render a "Call offer" /
  "{scheme} {action}" card with a decoded summary (name · room · N
  connection candidates), Copy-offer + Join-call actions. Plain https URLs
  are never treated as scheme payloads. **Join = app handoff, not native**:
  the payload is a proprietary WebRTC signal (JSON offer + a `BALA`-magic
  binary blob). Joining natively would need `flutter_webrtc` + reverse-
  engineering an undocumented binary protocol — out of scope. The "Join
  call" button launches the `bala://` URI; it only joins when the owning
  app is installed, otherwise it tells the user and copies the offer
  (never a silent no-op). Don't fake native call support.
- **Three feed tabs — For You / Following / Global** (`FeedMode` enum in
  `feed_notifier.dart`, `FeedScreen` TabController length 3):
  - **For You** (`forYouFeedProvider`, FIRST tab = the default home) —
    personalized: the global candidate pool (3× page size) ranked by
    `trendingScore × personalizationBoost`, blended ~40% followed authors /
    ~60% discovery, per-author cap 3. Ranking uses the LOCAL engagement
    index (`engagementFor` — now with `COUNT(DISTINCT pubkey)` unique
    engagers), never a relay round-trip per candidate; the engagement
    batch refreshes behind via `_warmPage` as usual. Logged-out / empty
    profile → honest fallback to the global feed (nothing to personalize
    with). The store paint is ranked too (cold start is personalized), and
    the pill's pending posts are re-ranked with the boost before merging.
  - **Following** — unchanged (only followed authors; the empty-store-read
    leak + stuck-refresh skeleton bugs are fixed).
  - **Global** — the unfiltered firehose (the old "For You").
  **Personalization signals** (`features/feed/application/
  personalization_service.dart`, ALL derived WITHOUT any location
  permission): country via the chain `relay.nostrfeed.com/api/geo` (our
  endpoint — the relay sees the client IP anyway; country-only, 24h disk
  cache) → device locale region (`en_IN` → IN); languages from the device
  locales; interests mined ON-DEVICE from the store (the user's own kind
  1/6/7/16 events → hashtags + authors of the posts they actually engage
  with, targets weigh 2×). Boost factors: followed author ×2.6, engaged
  author ×1.8, interest hashtag ×1.7, country hashtag ×1.35, language
  script match ×1.5, unreadable non-Latin script ×0.45 (rank DOWN, never
  hide — the Global tab still carries those posts). Script detection
  (`core/utils/language_detect.dart`) is Unicode-script based (pure,
  testable): Devanagari/Arabic/Cyrillic/CJK/kana/Hangul/Thai/Indic scripts
  detected; Latin is the lingua-franca family. `personalizationBoost`
  multiplies onto the ANTI-MANIPULATION trending score — personalization
  re-orders genuine content, it never inflates bot clusters.
  **Never use third-party client-side geo APIs** (ip_country_lookup & co):
  they leak user IPs to unknown services (our model promises "client IP
  only ever seen by our relay"), pull dio, and violate the ApiHttpClient
  rule. The relay geo endpoint is the primary leg by design. Tests:
  `language_detect_test.dart`, `personalization_boost_test.dart`.
- **Feed window cap is DIRECTION-AWARE** (`FeedNotifier._capWindow`): the
  400-event in-memory cap drops from the correct end per operation —
  **refresh + the "N new posts" pill keep the NEWEST** (`anchoredAtTop:
  true`), **loadMore keeps the OLDEST** (`anchoredAtTop: false`, so the
  pagination cursor `events.last.createdAt` survives). The old always-drop-
  from-top rule caused the "index-0 stuck / new posts never show" bug: after
  scrolling past 400 events, a refresh merged the newest page at the top and
  the cap immediately discarded it (and the pill's posts vanished on tap).
  Dropped events stay in the SQLite store, so pagination back-fills
  seamlessly. Pinned by `test/features/feed/feed_window_cap_test.dart`.
- **Feed ordering clamps future timestamps** (`FeedNotifier._orderTs`): a
  post with a future `created_at` (clock skew or a manipulated/boosted
  post) is clamped to now+tolerance (15 min) for ORDERING — naive
  created_at sort pinned such a post at the TOP of the feed forever (the
  "one post stuck on top" bug). Applies to both the merge and pagination.
- **Storage is bounded** (`EventStore.prune`): the SQLite store has a row
  cap (3000 events), a BYTE budget (~24 MB of content), and a profile cap
  (1500) — like X/FB, least-recently-used content evicts. Runs
  fire-and-forget after ingests (never on the render path). `storeBytes()` /
  `counts()` expose diagnostics. Never let the cache grow to fill the
  user's storage.
- **Replies are NOT main-feed posts** (`FeedNotifier._isFeedPost`): a kind-1
  reply (thread parent set) is filtered from For You + Following page
  fetches, the live tail pill, and the cold-start cache — it read as a
  context-free "post". Replies still live in threads, the profile Replies
  tab, and the store. Quotes (q tag) and reposts stay (standalone content).
- **Empty-content reposts resolve their target** (`post_card.dart`): NIP-18
  allows kind-6/16 reposts with EMPTY content — the reposted event lives
  only in the `e` tag. `repostTargetProvider` fetches it (SQLite store
  first, then a bounded relay fetch, ingested back). While resolving, the
  card shows a `_RepostResolvingTile` shimmer row — NEVER a blank card. An
  unresolved/non-displayable target falls through to the repost shell
  (author + "reposted" header). A repost-heavy account rendering as ALL
  EMPTY posts was this bug. Profile tabs fetch kinds 1/6/16/20/21/22/30023
  via `userPostsProvider` (kind-1-only hid picture-first accounts).
- **Threads & quotes (NIP-10/18)** (`core/models/nostr_models.dart`):
  - `isReply` = kind 1 AND (rootId or replyToId set) — an `e`-tag
    "mention" or a `q` tag is a CITATION, never a thread ref (the old
    `eventRefs.isNotEmpty` rule hid quote posts from the Posts tab).
  - `rootId`/`replyToId` implement NIP-10 marked tags (preferred) with the
    positional fallback (deprecated): marked `root`/`reply` win; unmarked →
    first is root, last is parent. Direct reply-to-root = single `root` tag.
  - `quoteRefs`/`quoteId` read the `q` tag (NIP-18 quote reposts);
    `quoteId` only yields 64-hex event ids (a `q` can be an address).
  - Quotes render as `QuoteCard` (`quote_card.dart`) — an embedded
    X-style preview from the `q` tag AND `nostr:note1…/nevent1…` content
    refs, resolved store-first then bounded relay fetch (never a bare "🔗
    note abc…" link). A quote post is never also a link-preview post.
  - `createReply` writes NIP-10 marked tags with a real relay hint (our
    first connected relay, not `""`) and copies the parent's `p` tags +
    author so the whole thread is notified; it takes `rootId` +
    `notifyPubkeys`. `createRepost` carries the relay hint on the `e` tag
    (NIP-18 REQUIRED) and only writes the `k` tag for kind-16 (never for
    kind 6 — that implies kind 1).
  - `ThreadScreen` attaches replies to the thread ROOT (`rootId ?? id`) —
    opening a mid-thread reply shows the whole conversation.
  - **Quote POSTING** (`compose_screen.dart` + `NostrService.createQuotePost`):
    the post 3-dot menu → "Quote post" pushes `/compose` with the event; the
    composer shows the `QuoteCard` preview and publishes a kind-1 with the
    quoted `nostr:note1…` inline + the factory's `q`/`p` tags (+ hashtags).
    A quote is a NOTE, never a poll (mode switch hidden on quotes).
- **Polls (NIP-88)**: `NostrService.createPoll(question, options, multipleChoice,
  endsAt)` writes kind 1068 (`option`/`polltype`/`endsAt`/`relay` tags);
  the composer has a Post/Poll `SegmentedButton` (question + 2–4 options,
  single/multiple, duration). Voting already existed (kind 1018 → the
  poll's declared relays). The feed fetches kind 1068 so polls show inline.
- **Default relays — HUB MODEL** (`core/config/env.dart`): the app does NOT
  fan out to a fleet of public relays. Our house relay
  (`wss://relay.nostrfeed.com`) syncs the community slice with the public
  network BACKEND-SIDE (strfry router pulls from damus/nos.lol, pushes our
  users' events out — see `docs/RELAY_HUB_SYNC_ARCHITECTURE.md`). The
  default fleet is: our hub FIRST, plus nos.lol + damus as FALLBACK-ONLY
  (T2 curated, health-demoted below the T0 platform hub — they serve only
  when the hub is down/slow). The paid relay (`wss://paid.nostrfeed.com`)
  connects separately after Lightning admission
  (`connectPaidRelayProvider`), never in the default fleet. Users add their
  own relays in Settings → Relays (T1, read/write toggles + NIP-65 sync);
  NIP-65 outbox routing reaches OUT-OF-COMMUNITY users' relays ad-hoc (T3,
  bounded ≤4) — profiles/DMs of people whose events aren't synced into the
  hub. Deliberately excludes dead relays: **relay.nostr.band has been
  offline a long time** — never re-add it.
- **Image CDN optimization** (`MediaUtils.optimizedImageUrl`): media URLs on
  resize-capable FREE Nostr CDNs (nostr.build / blossom.band, `?w=` param)
  are rewritten to a resized variant before load — ~80-90% less bandwidth
  per image. Feed tiles request 1080 px; avatars 192; banners 1200. This is
  the network half of the ADR-0004 size budget (`memCacheWidth` is the
  decode half). Non-CDN hosts are left unchanged. Other free media infra:
  media.nostr.band profile-pic thumbs, Blossom servers (uploads), BUD-03
  sha256 re-hosting for dead media URLs.
- **Kind numbers (ADR-0002)**: use `NostrKinds.*` from
  `core/nostr/kinds.dart` — never a magic kind literal (`kind: 5`,
  `37001`, `kind == 9735`). New kinds go in the registry first.
- **Size budget (ADR-0004)**: ≤ 35 MB download (Android arm64 AAB slice) —
  currently **27.9 MB**. Every image decodes at display size:
  `SmartNetworkImage` and `SafeAvatar` (shared widgets) and feed tiles use
  `memCacheWidth`/`memCacheHeight`; the profile banner decodes at 200 dp;
  feed tiles cap at 1200 px. Full-res decode ONLY on detail/fullscreen
  views. New packages need a size justification; the barcode-model
  exclusion lives in `android/app/build.gradle.kts`.
- **Reporting (Play compliance)**: every post has a 3-dot menu with "Report
  post"; every profile has one with "Report profile". Both open
  `showReportDialog` (`core/widgets/report_dialog.dart`) which publishes a
  NIP-56 kind-1984 report (`NostrService.createReport`). Child safety is the
  FIRST option and maps to the `illegal` type — Google Play tests this
  during review; never remove or bury it.
- **HTTP APIs** (LNbits, Cashu, LNURL…): use `ApiHttpClient` — no raw
  `http.get + jsonDecode + statusCode` blocks.
- **Wallets**: three options — built-in LNbits (custodial, one-tap), external
  via NWC (NIP-47, `nostr+walletconnect://` URI: Alby/Zeus/WoS/Mutiny/Phoenix/
  Breez/Alby Hub), and Cashu ecash. NWC encryption auto-negotiates NIP-44 →
  NIP-04 fallback (modern wallets need NIP-44). NWC URI parsing supports
  multiple `relay` params (never use `Uri.splitQueryString` — it collapses
  duplicates).
  **Send/Receive** (`features/wallet/widgets/send_dialog.dart` /
  `receive_dialog.dart`): Send takes ANY target in one box — bolt11 invoice /
  lightning address / LNURL — parsed by `parsePaymentTarget` +
  `readInvoiceSats` (`features/wallet/utils/payment_input.dart`, port of web
  `paymentInput.ts`; bolt11 amount = BTC × unit suffix m/u/n/p, amountless =
  null). An invoice that names its amount HIDES the amount field; address/
  LNURL resolve → fetch invoice → pay, with a balance check. Receive shows the
  reusable lightning address FIRST (any amount, no invoice) and POLLS a minted
  invoice (~2 min) so "Waiting for X sats…" flips to "Received ✓" live and
  refreshes the balance — a silent QR was the "invoice not showing" bug.
  Shared pay-an-invoice UI is `core/widgets/pay_invoice_sheet.dart` (Pay
  button via `core/services/wallet_payment.dart`'s `payWithAnyWallet`:
  LNbits → NWC → Cashu, QR fallback) — used by NIP-05 purchase + paid relay.
  **Core wallet tools** (`features/wallet/services/wallet_tools_service.dart`):
  `decodePayment` (POST `/api/v1/payments/decode` — show amount+destination
  before paying), `payLnurl` (server-side LNURL/zap pay), `recheckPending`
  (`?recheck_pending=true` — stuck-invoice fix), `fiatRate`/`describeSatsAsFiat`
  (`/api/v1/rate/{currency}` → "≈ $X" next to amounts, shown in Send sheet),
  and `isExtensionInstalled(extId)` (`/api/v1/extension/all`) — the availability
  probe every optional extension gates on (never offer a feature that 404s).
  Providers in `wallet_tools_providers.dart`.
- **Premium**: three pillars — NIP-05 verified names (`nostrnip5` extension,
  `you@ln.nostrfeed.com` / `you@getzap.me`), paid relay (`wss://paid.nostrfeed.com`
  via NIP-42 kind-22242 auth — already wired in `relay_pool.authHandler`),
  and lightning addresses (`lnurlp` extension, `you@ln.nostrfeed.com`).
  Free generated names are `u` + first 12 hex (`FreeAddress.isGenerated`);
  paid names are anything else. Entitlement = has a paid (non-generated) name
  or lightning address (`premium_providers.dart`).
  **Paid relay = PAYMENT FIRST, connect after** (`connectPaidRelayProvider`):
  check `{PAID_RELAY_ADMISSION|https://paid.nostrfeed.com}/admissions/check/{pubkey}`
  → if unpaid, `POST /invoices` mints a bolt11 → pay with the first wallet
  that can (LNbits → NWC → Cashu, QR sheet fallback via `InvoiceQrView`) →
  poll invoice `status_url` + admission check together (either yes wins,
  ~1 min bounded) → only THEN `relayPool.addRelay`. Admission state is
  THREE-VALUED (`AdmissionState.admitted/unpaid/unknown`) — a failed check is
  never a refusal (that double-charges people). Parsers live in
  `AdmissionService` (`features/premium/services/admission_service.dart`,
  mirrors web `src/lib/paidRelay.ts`). Admitted profiles get a shield
  `PaidRelayMark`/`PaidRelayBadge` (`features/premium/widgets/paid_badge.dart`)
  next to the verified ✓ — only on `admitted`, never on unknown.
  **Premium-only features** (each a card on the Premium screen, gated on
  `isPremiumProvider` + the extension being installed — three honest states:
  not-installed / not-premium / ready):
  - **Nostr Bunker** (`features/premium/` `services/bunker_service.dart` +
    `providers/bunker_providers.dart` + `widgets/bunker_card.dart`, ext id
    `nostr_bunker`): remote signer as a service — store an nsec server-side,
    mint NIP-46 `bunker://` links (permissions + confirm-sign, revocable) so
    the key never lives on-device.
  - **NWC Provider** (`services/nwc_provider_service.dart` +
    `providers/nwc_provider_providers.dart` + `widgets/nwc_provider_card.dart`,
    ext id `nwcprovider`): mint `nostr+walletconnect://` URIs for the user's
    own wallet with permissions + budgets (Alby-Hub-style self-custody
    sharing). The pairing URI is shown ONCE — not recoverable after.
  **Custom names are PAID**: `LightningAddressNotifier.claim` only accepts the
  user's own free generated name (or an already-owned re-claim) — custom names
  must go through the buy-name flow (invoice first). Claiming a custom name
  via the free lnurlp claim bypasses payment.
  **Multiple domains + names**: a user can hold names/addresses on EVERY
  configured domain — `nip5Domains` (NIP-05, `id:hostname` pairs) and
  `lightningAddressDomains` (lnurlp, bare hostnames) are lists, first is the
  default. Owned NIP-05 names are LISTED (identity screen + wallet
  `BuyNameSection`, both via the shared `OwnedNip5Tile` in
  `features/identity/widgets/`) each with its own domain
  (`Nip5Address.identifier` uses its own `domainId`) and its own "Use this
  one for my ✓" publish action — only ONE can be the profile's `nip05`.
  "Buy another name" stays reachable after the first purchase (web
  `OwnedNames` pattern). Lightning claims are keyed per (username, domain):
  the same name on a different domain is a different address. Taken-checks
  use the domain's NIP-05 `/.well-known/nostr.json?name=…` (NOT the lnurlp
  well-known — that answers a different question).
  **NIP-05 name states** (`nip5Status` in `address_service.dart`, mirrors web
  `nip5State`): `active:false` = INACTIVE = RESERVED-BUT-UNPAID (invoice not
  settled — never live, NOT expired; it gets a "Pay for it" button, NOT a
  renew or publish one). Active + expiry → `expiring`(≤30d)/`expired`/`active`.
  `expires_at` is written at record CREATION so an unpaid name shows a date a
  year out — never render "rented until" for an unpaid name. **Entitlement:
  only ACTIVE non-generated names count** — an unpaid custom name granting
  premium was the bug (`isPremiumProvider`/`premiumEntitlementsProvider`
  skip `!active`). **Unpaid recovery**: the extension only writes
  `extra.payment_hash` at activation, so the claim response's hash is stored
  in `_PendingInvoiceStore` (SharedPreferences `nip5_pending_invoices`,
  mirrors web `rememberNip5Invoice`) — `Nip5Notifier.payForAddress`
  re-claims the SAME reservation (same years + promo_code, returns the
  outstanding invoice, nothing bought twice) and `OwnedNip5Tile`'s
  `PayForNameButton` opens `showPayInvoiceSheet` with it.
  **Anti-squatting**: a reservation is a name HELD OUT OF THE POOL, paid or
  not — so claims are capped at `kMaxUnpaidReservationsPerDomain` (3) UNPAID
  reservations per domain in `Nip5Notifier.claim`. Active/paid names don't
  count, and re-claiming a held reservation to PAY for it (`payForAddress`)
  always passes the cap. **Release IS possible**: the extension HAS a
  user-scoped delete route `DELETE /nostrnip5/api/v1/user/domain/{did}/address/{id}`
  (`AddressService.deleteNip5Address`) — `Nip5Notifier.releaseUnpaidAddress`
  frees an unpaid reservation back to the pool IMMEDIATELY (the
  `OwnedNip5Tile` overflow menu → "Release reservation"). Active names delete
  via `releaseActiveAddress` (confirmed hard — throws away money). Also
  available and unused-by-the-web-app: **transfer** (`getTransferCode` +
  lock/unlock/transfer routes — `OwnedNip5Tile` → "Transfer to another user")
  and **rotate** (`rotateNip5Address` — re-point a name at a different key).
  Lightning pay links delete via `DELETE /lnurlp/api/v1/links/{id}`
  (`deletePayLink`) — but the web deliberately never deletes lightning
  addresses (the next claimant would inherit the previous owner's incoming
  money), so that one is offered only with explicit caller intent.
  The UI surfaces unpaid count (`_ReservationNotice`) + expiring-soon
  (`_ExpiringNotice`, `expiringNamesProvider`) so names are renewed, not lost.
  **UTF-16 at the source**: every API/Nostr-sourced string that reaches a
  Text widget MUST be sanitized in its `fromJson` (lone surrogates crash the
  text engine). Covered: `NostrEvent`/`NostrProfile` (all fields incl.
  nip05/lud16/picture/banner), `LnbitsUser.username/email`,
  `LnbitsWallet.name`, `LnbitsPayment.memo`, `NwcInfo.alias`,
  `NwcTransaction.description`, `PayLink.description/username`,
  `Nip5Address.localPart`, `Nip5SearchResult.reason/priceReason`. Exceptions
  (`AddressException`, `LnbitsException`) sanitize in `toString()`. Use
  `sanitizeText` (or `sanitizeTextOrNull` when null-vs-empty matters).
  **Avatar initials**: NEVER `name[0]` — an emoji-leading name is a lone
  high surrogate (the avatar-initial crash). Use `firstGrapheme(name)` from
  `text_sanitize.dart` (takes the full surrogate pair) — every avatar
  fallback uses it.
- **AI — Chat vs Agent modes + feed entry bar + thread summarization**:
  the AI screen has a **Chat / Agent segmented toggle**. Chat = normal
  assistant; **Agent = a bounded tool-calling loop** (OpenRouter function
  calling, max 4 rounds) with READ-ONLY Nostr tools
  (`ai_agent_tools.dart`: `search_relay`, `fetch_thread`, `fetch_profile`,
  `fetch_hashtag_feed`) — Grok-on-X style: the model searches/reads/summarizes
  real relay data, never guesses. Steps stream LIVE into a panel
  (`liveAgentSteps`, "Searching X… ✓") and the answer keeps an expandable
  `_AgentStepsTrail`. The model NEVER sees a private key; write tools (when
  added) go through human-in-the-loop confirmation only (see
  `docs/DEEP-LINKS-AND-AI-AGENT-2026-10-26.md`). `AiFeedBar`
  (`features/feed/presentation/widgets/ai_feed_bar.dart`) is a NATIVE search-
  bar input pinned at row 0 of the For You tab ONLY (never mid-feed, never in
  Following — a feature entry point like WhatsApp's Meta AI bar, NOT a promo
  card; the old ad-style `_AiPromoCard` stays banned). Its suggestion chips
  prefill the AI composer (`/ai` with `extra: {'prompt': …}` →
  `AiChatScreen(initialPrompt:)`). The thread screen has a ✨ AppBar
  "Summarize thread" action (gated on `aiAvailableProvider`) — the prompt
  carries `nostr:note1<root>` so `AiContextService._fetchThread` pulls the
  whole conversation (root + replies) from the user's relays and the digest
  is real, not hallucinated.
- **Support page** (`features/settings/presentation/support_screen.dart`):
  donation addresses (BTC bech32 + Taproot, Solana, EVM — build-time
  constants, NEVER relay-read: a relay could redirect them) with QR codes
  (BIP-21 / Solana Pay / EIP-681 URIs) + copy buttons, and a **Lightning
  card** (`kk@getzap.me`) whose "Pay support" opens the **zap-style amount
  picker** (`_SupportAmountSheet` — Primal preset grid 👍21 🚀420 ☕1k 🍻5k
  🍷10k 👑100k + custom field) → LNURL resolve → invoice → shared
  `showPayInvoiceSheet`. Wired at `/support` + the /you row + a small
  **left-center edge shortcut on the home feed** (`_SupportSideShortcut` —
  quiet hairline tab, × hides it for the session).
- **Accessibility (a11y — store-review checks this)**:
  - **Semantics on every interactive element**: action buttons carry
    `semanticLabel` + `isActive` (`_ActionButton` in post_card) so a screen
    reader says "Like, active, 12 likes" — never a bare icon. Avatars announce
    "$name's profile"; images announce NIP-92 `alt` text (or "Photo in post")
    + `button: true` (tappable). Never ship a bare `GestureDetector`/`InkWell`
    with no `Semantics` on a new interactive element.
  - **Touch targets ≥ 44dp vertically** (Apple HIG / Material) — the VISUAL
    stays small, only the hit area grows (`padding` on the InkWell, not the
    icon). Action-row buttons: `vertical: 10` (44dp tall) but tight horizontal
    so 6 buttons still fit a 320dp screen.
  - **Dynamic type**: post body text respects `MediaQuery.textScalerOf`,
    clamped to 1.0–1.3 (a larger-text user gets a bigger feed; a 2× setting
    can't explode the dense card layout). Never hardcode a font size that
    ignores the system scaler on reading surfaces.
- **Async safety**: guard `setState`/context use after async gaps with
  `mounted`; wrap fire-and-forget futures in `unawaited()`.
- **Event signature verification (trust boundary)**: relays are UNTRUSTED
  transport — a relay can inject a forged post under anyone's pubkey. Every
  incoming EVENT is verified BEFORE it reaches a screen: `NostrEvent.isValid`
  recomputes the id (commits to the exact content) AND Schnorr-verifies the
  signature (BIP-340). Forged/tampered events are dropped silently. Never
  render an event that hasn't crossed this boundary; never verify on the
  render path (too late). Tests pin genuine-valid + forged/tampered/malformed-
  rejected. **The verify runs OFF the UI isolate** — see the relay frame
  processor entry below (ADR-0005 L2 hardening).
- **Key storage (the nsec IS the identity — no reset, no support desk)**:
  `flutter_secure_storage` (hardware-backed), iOS Keychain item is
  `KeychainAccessibility.unlocked` (device-only, NOT migrated to a new
  device or into backups — a stolen backup can't lift the key). Never log
  or display the nsec, never store it in plaintext prefs. NIP-44 for all
  new encryption (never NIP-04); gift-wrapped DMs (NIP-17). NIP-46 remote
  signing / NIP-49 ncryptsec are the upgrade path for not holding the key
  on-device (see Premium → Nostr Bunker).
- **Secrets**: never hardcode — use `--dart-define` with `Env` class. Real
  values live in the gitignored `.env` (see `.env.example`), wired in via
  `--dart-define-from-file=.env`. Two key kinds only: receive-only LNbits
  invoice keys (house wallet: mints AI-credit invoices + reads payment
  status) and zero-credit OpenRouter free keys. NEVER an LNbits admin key or
  an uncapped paid OpenRouter key. Note: all purchase features EXCEPT AI
  credits mint invoices server-side (nostrnip5/lnurlp extensions, the relay
  admission server, zap recipients) — the house wallet is only for AI
  credits + web fiat subscriptions.

## AI assistant (chat, context, entry points)

- **Entry points**: pinned FIRST row of the chat conversation list
  (`_AiChatTile` in `features/chat/presentation/chat_screen.dart` — Telegram
  "Saved Messages" pattern, visible even with zero DMs), drawer → Discover,
  Explore card, wallet AI-credits card, Home feed tab-row ✨ button, create
  sheet "Ask AI".
- **Relay access**: `AiContextService` (note/thread links, npub/nprofile,
  64-hex ids, "#hashtag" + summarize intent) fetches live context from the
  user's relays into a second system message — the model answers FROM it,
  never invents posts. Bounded (8s total, 6k chars) and never blocks a send.
- **Context window**: `trimToContextBudget` (domain, pure) fits history into
  the request budget — per-message head+tail cap (4k chars), total window cap
  (22k chars), and the system prompt + Nostr context block counted AGAINST
  the budget (a big relay fetch shrinks history instead of blowing the
  model's context window). Dropped history is counted into
  `AiChatState.contextDropped` → `_ContextNote` shows "N older messages out
  of context — clear chat to reset" (a silent trim reads as "the AI forgot").
- **Bubble actions**: long-press any bubble → Copy / Share. Failed sends
  restore their text into the composer (`AiChatState.failedText`) so a retry
  is one tap. History persisted capped at 300 messages (`AiChatStore`).

## AI credits (buy flow — payment → credits)

- **Units = AI TOKENS, not sats**: 1 token = $0.001 (`tokensPerUsd = 1000` in
  `ai_credits.dart`). Users BUY tokens with sats at the live exchange rate
  and SPEND tokens per message at dollar-pegged prices that never move with
  BTC — spending sats felt like spending money (high-value), spending tokens
  feels like points, and the prices stay stable. Sats appear ONLY at top-up.
- **Pricing (never a loss)**: token price =
  `upstream usage.cost USD × (1 + platformFee 5.5%) × profitMargin 1.5 ×
  tokensPerUsd` (+ modality uplift tokens). OpenRouter's platform fee is
  priced IN (pricing off raw `usage.cost` alone sells every message ~5%
  short); the settle is EXACT (`usage.cost`) with the top-up capped at
  reserve × 2 (`AiGatewayConfig.cappedSettleTokens`) so a runaway
  reasoning-model request can't drain a balance — and the operator's
  worst-case forgiveness is bounded too.
- **Flow**: `AiTopUpSheet` picks a TOKEN pack → its sats price is computed
  at the live rate + volatility buffer (`AiCreditPack.priceSats`, rate from
  `aiSatsPerUsdProvider`) → `AiCreditsService.createTopUpInvoice(pack,
  priceSats:)` mints a bolt11 on the house wallet (memo ALWAYS `NostrFeed AI
  credits {pack} · {pubkey12}` + optional note — losing prefix/pubkey makes
  the payment unrecoverable) → `showPayInvoiceSheet` → `creditPayment()`.
- **Confirmation = auto-poll, never one-shot**: `pay_invoice_sheet.dart`
  polls `checkPaid()` every 2s while open — actively after an in-app pay
  (bounded 2 min), passively for QR payments, and once on app resume. The
  old single-check told users to press "I've paid"; a closed sheet lost the
  credit even though sats left the wallet.
- **Reconcile (safety net)**: `AiCreditsNotifier.build` + `WalletSyncService`
  (30s/resume) + the top-up sheet's "Restore" all run `reconcile(pubkey,
  satsPerUsd: live)` — it pages `GET /api/v1/payments` on the OPERATOR
  `Env.lnbitsUrl` (HouseWallet keys live there; NOT the user-overridable
  `lnbitsUrl`), matches memos CLIENT-side (`AiPaymentTracker.isAiCreditMemo`;
  the server-side `memo` param silently returns nothing on some LNbits
  builds), and credits only SETTLED incoming payments, converting sats →
  tokens at the live rate (a recovered top-up grants its true current $ value).
- **Exactly-once**: reconcile keys idempotency on
  `AiPaymentRecord.idempotencyKey` (`hash:` → `bolt11:` → `amount:time:memo`
  fallback — a settled payment is NEVER skipped for lacking a hash).
  `markCredited` writes the same `hash:`-prefixed key. Credit is saved
  BEFORE the keys are recorded (a lost key re-grants safely; a recorded key
  with no credit loses paid sats).
- **Credits follow the key (relay backup)**: the ledger mirrors to a NIP-44
  self-encrypted kind-30078 event (d-tag `nostrfeed-ai-credits`) via
  `AiCreditsBackupService` — only the owner's key reads it. The payload is
  unit-tagged (`{unit:'tokens', ledger:…}`); a legacy sats-era backup
  converts sats → tokens on restore BEFORE merging (mixing units would
  inflate a balance ~1,200×). Build merges local + remote with
  `AiCreditsLedger.mergeWith` (union: max of the monotonic purchased/spent
  counters, balance RE-DERIVED — never max-balance, which would resurrect
  spent credits). Every credit/debit publishes a backup fire-and-forget.
- **Sats→tokens migration**: `AiCreditsService.load` converts a legacy
  sats-denominated ledger ONCE (flag `ai:credits_migrated_to_tokens_v1`) at
  `migrationSatsPerUsd`, preserving its dollar value.
- **Live exchange rate** (`AiExchangeRateService` + `aiSatsPerUsdProvider`,
  auto-refresh every 10 min): house LNbits `/api/v1/rate/USD` →
  mempool.space → disk cache → constant `kFallbackSatsPerUsd`. Used ONLY for
  top-up sats pricing + reconcile conversion — never for per-message prices
  (those are dollar-pegged tokens).
- **Ledger**: `AiCreditsLedger` (pure Dart, checksummed, `updatedAt` stamp)
  in secure storage; read-only logins skip backup/restore silently.
- **Tests**: `test/features/ai/ai_credits_flow_test.dart` pins the
  payment→credit + exactly-once + merge contracts; `ai_payment_tracker_test.dart`
  pins the memo matcher; `ai_credits_test.dart` pins ledger math + merge +
  token pricing (`estimatePriceTokens`/`settlePriceTokens`/`priceSats`).

## Realtime wallet (LNbits websocket + notifications)

- **Live channel**: `LnbitsLiveService` (`features/wallet/data/`) wraps
  `wss://{base}/api/v1/ws/{invoiceKey}` — the wallet's **inkey** is the
  subscription id (wallet *ids* were dropped in LNbits 0.12.8 as public —
  lnbits#2545). `LnbitsLivePayment.tryParse` accepts BOTH frame shapes:
  `{"type":"payment","amount":sats,…}` and `{"balance":msat,"payment":{…}}`.
- **Coordinator**: `lnbitsLiveServiceProvider` (`features/wallet/application/
  lnbits_live_providers.dart`, watched at app root in `app.dart`) runs TWO
  sockets — the active user wallet (`lnbitsUrl`, the Settings-following
  active instance) and the **house wallet** (pinned to `defaultLnbitsUrl` =
  the operator instance, same pin as `AiCreditsService`/`AiPaymentTracker` —
  never the user override). Reconnect on `onDone` with 5s→2min backoff,
  `resync()` on app resume (mirrors the relay-pool resilience rule).
- **On a user-wallet payment**: debounced (600ms) `lnbitsAuthProvider.refresh()`
  (a zap burst = ONE `/api/v1/auth` fetch) + incoming settled sats fire
  `LocalNotificationService.showZap` and set `lnbitsLiveAlertProvider` →
  `WalletPaymentBanner` (above the router, next to DM/social banners, tap →
  `/wallet`). On a house payment: `aiCreditsProvider.reconcile(pubkey)` —
  top-ups land in seconds, no "I've paid" tap.
- **Fallback**: the 30s `WalletSyncService` poll + receive-dialog 3s poll
  stay — the socket is primary, polls are the gap cover. Never remove the
  polls (proxy idle timeouts kill quiet websockets).
- **Tests**: `test/features/wallet/lnbits_live_test.dart` pins the frame
  parser for both shapes + garbage frames.

## Feed architecture (offline-first, FB/Insta-style)

- **EventStore** (`core/db/event_store.dart`): the normalized SQLite store —
  the single source of truth for feed content, like X/FB's on-device cache.
  Three tables: `events` (one row per event, id-keyed), `event_refs` (the
  engagement index — one row per event→`e`-tag target, so "who liked/
  reposted/replied to X" is a local grouped COUNT, not a relay query), and
  `profiles`. All writes are `INSERT OR REPLACE` keyed on stable ids, so the
  page fetch and the live tail can both ingest without deduping in Dart.
  `prune()` keeps it bounded. Cold start reads the feed from here (indexed,
  survives >300 events); the legacy JSON `FeedStore` is migrated into SQLite
  on first run and dropped.
- **Batched data layer** (the "~150 relay queries per feed" fix): a page of
  50 posts needs ONE relay fetch for the posts, ONE batched engagement fetch
  (`_syncEngagement` → ingested into `event_refs`), and ONE batched profile
  prefetch (`SocialRepository.prefetchProfiles` → fills the TTL cache).
  PostCards then read counts from `localEngagementProvider` (a local SQL
  grouped count, rebuilt only when `engagementVersionProvider` bumps) and
  avatars/names from the warm profile cache — instead of each card firing
  its own relay query. Both warm paths are fire-and-forget so posts render
  immediately and counts/avatars pop in as the batch lands.
- **FeedStore** (`features/feed/application/feed_store.dart`): legacy JSON
  cache in SharedPreferences. Kept only for the one-time migration into
  EventStore; new reads/writes go through SQLite.
- **FeedNotifier** (`feed_notifier.dart`): `FeedState(events, isRefreshing,
  hasMore, isLoadingMore, newCount, error, lastSyncedAt)`. Pipeline:
  disk → silent network refresh (merges, no skeleton) → persist. Live
  subscription counts new posts into `newCount` (the "N new posts" pill —
  NEVER auto-inserts, that yanks scroll position). `loadMore()` walks the
  `until` cursor for infinite scroll. Three rules that keep the feed
  FB/Insta-smooth:
  - **Merge never re-orders.** `_merge` inserts genuinely-new events by
    time into the EXISTING order — visible posts never jump (NIP-17
    backdated/clock-skewed posts used to shuffle the list mid-scroll).
  - **Follows resolve once.** The Following feed's author list is fetched
    a single time per session (`_resolveFollows`), not per page — and both
    For You + Following have a live tail (`restartLive`).
  - **`refresh()`/`loadMore()` are serialized** through `_inFlight` — a
    pull-to-refresh near the bottom can't double-fetch a page.
- **Providers**: `globalFeedProvider`, `followingFeedNotifierProvider` —
  NotifierProviders (not autoDispose). Refresh after posting goes through
  `.refresh()` (silent merge), never `ref.invalidate` (that flickered).
- **FeedScreen**: RefreshIndicator + offline banner (slim strip, feed stays
  usable) + new-posts pill + pagination spinner. Tabs keepAlive.
- **Connectivity** (`core/providers/connectivity_providers.dart`):
  `connectivity_plus` stream → `isOfflineProvider`; `connectivityWatcherProvider`
  on offline→online does THREE things: reconnect dead relays, evict failed
  image loads (`PaintingBinding.imageCache.clearLiveImages()` — offline
  failures park in CachedNetworkImage's error state and never retry alone),
  and restart the live tail + silently refresh both feeds. App RESUME does
  the same via `didChangeAppLifecycleState` (feeds + `restartLive`).
  **Android gotcha**: Android reports an EMPTY connectivity list on radio
  hand-off/VPN churn (wifi → `[]` → cellular). Empty is NOT "offline" for
  the banner (`_isOfflineResults` returns false — a transient unknown, not
  proof of being offline, so the banner never lies). But the relay sockets
  DID die in the gap, so the watcher ALSO fires the full recovery
  (reconnect relays + restart live tails + refresh feeds + evict parked
  image failures) when a route the device actually HAD is lost and regained
  (`hadRoute`/`routeWasLost`) — without it the feed stayed dead after every
  Android network blip until a manual pull (the "feed stuck on Android,
  fine on iOS" bug — iOS never emits an empty list). The watcher tracks the
  last offline state across the listener so a null/empty `previous` doesn't
  swallow the first real recovery.
- **Android image/scroll quirks**: (1) every network image sends a real
  browser `User-Agent` + `Accept` header — some CDNs/hosts 403 the default
  Dart (empty) UA on Android but serve iOS fine (a top cause of "images
  load on iOS, fail on Android"). The headers live in ONE place —
  `kImageHttpHeaders` (`core/widgets/smart_network_image.dart`) — used by
  `SmartNetworkImage`, `SafeAvatar`, and every raw `CachedNetworkImage`
  (profile banner, communities, articles, video cards, live, market).
  NEVER add a raw `CachedNetworkImage` without `httpHeaders: kImageHttpHeaders`.
  **(1b) memCache: width-ONLY, never both W+H** — every working image in
  the app (avatars, feed tiles, article/video cards) constrains decode by
  `memCacheWidth` only. Setting BOTH `memCacheWidth` AND `memCacheHeight`
  on a wide-short image (a profile banner / cover photo) distorts the
  decode on some Android codecs → "Invalid image data" → silent grey
  fallback while iOS shows fine (the "banner shows on iOS, not Android"
  bug). The profile banner uses raw `CachedNetworkImage` with width-only
  memCache + `BoxFit.cover` crops the height — never `SmartNetworkImage`
  (which sets both) for cover photos.
  (2) the feed `ListView` uses explicit `AlwaysScrollableScrollPhysics` +
  a guarded infinite-scroll trigger (`maxScrollExtent > 0`, clamped pixels).
  (3) the manifest sets `android:largeHeap="true"` (feed bitmaps up to
  ~1200 px; the default 192-256 MB heap GC-thrashed the image cache
  mid-scroll — iOS has no such cap) and **`EnableImpeller=true`** (Impeller
  on Vulkan is the default + mature on Flutter 3.47 — shaders pre-compile
  ahead-of-time, so the old first-scroll jank is gone; the previous
  `EnableImpeller=false` Skia pin was a leftover from a 2024 engine and
  forced the slower legacy renderer). Feed tiles decode at `memCacheWidth: 1200`
  (NOT `1200 * dpr` — 3600 px decodes exceeded the whole 48 MB image cache
  on one portrait photo → eviction thrash → re-decode mid-scroll, the
  Android jank iOS masked with its bigger heap). The image cache is 96 MB
  on Android / 48 MB elsewhere (`main.dart`).
- **Feed refresh never hangs** (`feed_notifier.dart`): `_refresh`/`_loadMore`
  run under a 15s `_refreshTimeout` — a hung relay fetch (dead socket,
  emulator's flaky route) resets `isRefreshing`/`isLoadingMore` instead of
  leaving it true forever (the spinner-spins-forever + retry-blocked
  "feed stuck" bug). Pull-to-refresh goes through `refreshFromPull()`, which
  clears a stuck flag from a prior hung fetch first AND drops the serialized
  `_inFlight` queue (a pull queued behind a hung 13s Android relay wait felt
  like "pull does nothing") so a user pull ALWAYS gets a fresh attempt. The
  abandoned fetch's stale merge is harmless (time-ordered, deduped).
- **Ingest pipeline is BATCHED** (`ingest_pipeline_providers.dart`): bus
  events buffer for 150 ms and land in ONE SQLite transaction (a page
  replay / reconnect resubscribe burst — much bigger on Android, which
  kills idle sockets — used to run one txn + deletion-check PER event,
  janking the UI isolate). `_ingestBatchMax` 200 splits huge replays. The
  engagement tick stays debounced (500 ms, one version bump per burst).
- **Feed images self-heal** (`_NetworkImageTile` in `note_content.dart`):
  a failed load auto-walks the NIP-92 `fallback` URLs, then shows a
  tap-to-retry tile (evicts the parked failure + re-resolves) — a flaky
  host/CDN no longer kills the tile for the session. Loading shows a
  shimmer sweep (not a bare spinner); error shows "Tap to retry".
- **Android cleartext images**: `android/app/src/main/res/xml/
  network_security_config.xml` + the manifest's
  `android:networkSecurityConfig` allow cleartext for media loads. Nostr
  images come from thousands of independent hosts, many plain-HTTP — Android
  9+ blocks cleartext by default, which is exactly why images failed "on
  Android side" while iOS showed them. Keys/signing stay local; cleartext
  only ever carries public images. Never remove this config.
- **Profiles**: `profileProvider` is keepAlive (NOT autoDispose) — the
  10-min `profileCache` handles staleness; disposing on scroll-away was
  the avatar flicker. `userPostsProvider` is also keepAlive (profile tabs
  all filter the same list; disposing per tab re-fetched it).

## App version

- `core/providers/app_info_providers.dart`: `packageInfoProvider` +
  `appVersionProvider` read the platform bundle (pubspec `version:`) via
  `package_info_plus`. The drawer footer and Settings → App Version use it
  — NEVER hardcode a version string (the old `v1.0.0` lied on day two).

## Soft update check (non-blocking)

- `features/settings/application/app_update_service.dart`: fetches a tiny
  JSON manifest (`UPDATE_MANIFEST_URL`, default
  `https://nostrfeed.com/app-version.json` — template at
  `web/app-version.json`), compares semantic version + build number, and
  exposes an `AppRelease` when the running build is older. **Direct store
  links**: Android opens `market://details?id=com.nostrfeed.nostrfeed_mobile`
  (web fallback); iOS opens `itms-apps://apps.apple.com/app/id<APPLE_ID>`
  (set the numeric App ID in `AppUpdateService._appleId` after listing).
- **NEVER force-update.** The `_UpdateAvailableBanner` sits at the top of
  the drawer (dismissible "Later" per version, persisted), and re-checks on
  app resume. Offline/failure → NO banner (never a false alarm). Publish
  the manifest on each release (bump `version`/`buildNumber`/`notes`); the
  banner appears to users on older builds without blocking them.

## QR flows (scan + share)

- **Shared scanner**: `core/widgets/qr_scan_sheet.dart` — `showQrScanSheet()`
  full-screen camera sheet (mobile_scanner), returns the scanned string.
  Used by Send (recipient) and LndHub (connect). NWC keeps its own inline
  scanner. New scan needs → use this sheet, don't grow another copy.
- **Send dialog**: recipient field has Paste + Scan; a scanned QR is
  normalized (strips `lightning:` prefix, uppercase bolt11).
- **Receive dialog**: the lightning address has a QR toggle (scannable as
  `lightning:addr`); minted invoices use `InvoiceQrView` (QR + Copy +
  Share — share emits `lightning:<bolt11>`).

## Payment decode (GetZap Decoder)

- **API**: `POST /api/v1/payments/decode` `{data}` — decodes bolt11/LNURL
  (bech32) server-side → amount, destination, description, expiry. It does
  NOT decode lightning addresses (those resolve via LNURL-pay instead).
- **Service**: `WalletToolsService.decodePayment` + `decodePaymentProvider`
  (family, keyed on the invoice string). Wired into the Send dialog as
  `_DecodedInvoiceCard` — destination/description/expiry shown before the
  sats leave, so a malformed or surprising invoice is caught in review.

## LndHub wallet (BlueWallet protocol)

- **Protocol**: `lndhub://login:password@host` QR (BlueWallet export, Zeus,
  Alby, Umbrel, BTCPay "LNDhub API"). Login+password → `POST /auth` → OAuth
  access token; then `/getbalance`, `/payinvoice`, `/addinvoice`,
  `/getuserinvoices`, `/gettxs`. Token auto-refreshes on 401 once.
- **Files**: `services/lndhub_service.dart` (credentials + API),
  `providers/lndhub_providers.dart` (state, credentials in secure storage
  `lndhub:credentials`), `lndhub_screen.dart` (scan/paste connect).
  Route `/wallet/lndhub`, card on the wallet hub.
- **Spending**: `payWithAnyWallet` tries LNbits → NWC → Cashu → LndHub;
  `WalletKind.lndhub`. `hasPayingWallet` counts a connected hub.
- **Tests**: `test/features/wallet/lndhub_test.dart` (URI parse + tx parse).

## Relay management (Settings → Relays)

- **State**: `features/settings/providers/relay_settings_providers.dart` —
  `RelaySettingsNotifier` holds `ManagedRelay(url, read, write)`, persisted
  to SharedPreferences (`settings:managed_relays_v1`, survives restarts).
- **Read/write intent actually drives behavior**: the notifier maintains the
  module-level `readRelayUrls`/`writeRelayUrls` sets, and `RelayPool.query`
  skips write-only relays while `RelayPool.publishWithAck` skips read-only
  ones (empty sets = first run, everything allowed). The old screen had
  toggles wired to nothing.
- **NIP-65 sync** (kind 10002): `publishList()` writes `r` tags
  (read/write markers), `mergeFromNetwork()` merges the user's published
  list (remote wins per-URL). The screen's cloud-sync action runs
  merge → publish so every client agrees.

## Multi-wallet LNbits accounts

- **LNbits accounts hold several wallets** (users API: create/share/delete,
  `GET/POST /users/api/v1/user/{id}/wallet`). One account = one sign-in,
  many wallets (spending vs savings).
- **Active wallet**: `LnbitsAuthState.activeWalletId` (persisted per Nostr
  pubkey in secure storage, `lnbits:active_wallet`) and
  `LnbitsAuthState.activeWallet` getter — the stored choice wins when it
  still exists, else the first wallet. NEVER read `wallets.first` directly:
  use `lnbits.activeWallet` (state) or `lnbitsActiveWalletProvider` (widget).
  `createAndActivateWallet(name)` adds a wallet and switches to it.
- **Switcher UI**: the balance card on `lnbits_screen.dart` shows
  "N wallets — tap to switch" when the account holds >1; the bottom sheet
  picks or creates. The wallet hub (`wallet_screen.dart`) names the active
  wallet on its card.
- **Multiple USERS**: already handled — session tokens are keyed per Nostr
  pubkey (`lnbits:tokens:<pubkey>`), so each Nostr account gets its own
  LNbits session + its own active-wallet choice.

## Feed author-list chunking

- **`feed_repository.fetchFeed`**: relays cap filter list size (strfry
  `maxReqFilterSize = 200`) — a Following feed with a large follow list in
  ONE authors filter is REJECTED, surfacing as "no posts / could not fetch"
  on exactly the accounts with big follows (and fresh installs whose
  follows just resolved). Author lists > 150 are chunked into parallel
  sub-queries and merged (same pattern as `prefetchProfiles`'s 40-chunks).
  Never pass an unbounded `authors:` list into a single NostrFilter.

## Content moderation (NSFW / spam filtering)

- **Library**: `core/moderation/content_filter.dart` — pure, testable
  `ContentFilter` class. `verdictForEvent` / `verdictForProfile` return a
  `FilterVerdict(FilterAction.show/hide/warn, reason)`. Term lists in
  `filter_terms.dart` (explicit-adult only, 30+ languages, trimmed from
  LDNOOBW + the documented Nostr spam dataset). Matching runs on
  `normalize()`d text: case fold, diacritic/homoglyph strip, separator
  removal, leet digit-fold via `_evasionForms`, long-term (≥6 char) token
  prefix match. Word-boundary token match — "sex" does not match "Essex".
- **Providers**: `core/moderation/moderation_providers.dart` —
  `nsfwFilterProvider` / `spamFilterProvider` (toggles, default ON,
  SharedPreferences), `blockedWordsProvider`, `blockedAuthorsProvider`
  (local-first, NIP-51 kind 10000 sync via `muteListSyncProvider`),
  `contentFilterProvider`, `filteredEventVerdict(ref, event, {authorProfile})`.
- **Hook points**: `PostCard` (hide + NIP-36 warn cover `_ContentWarningCover`),
  `ProfileScreen` (blocked/NSFW placeholder), `SearchScreen` people+posts
  tabs, `ExploreScreen` hashtag chips + People-to-follow, **ArticlesScreen**
  (`_ArticleCard` hide), **ReelsScreen** (`_ReelPage` hide — a reel is a
  video post carrying the same text/hashtag signals), **LiveScreen** (live
  list filters title/summary/hashtags), **CommunitiesScreen**
  (`_CommunityCard` hide — community detail posts render via PostCard,
  already covered). Block actions: post 3-dot menu → "Block author";
  profile 3-dot menu → "Block account"; manage lists in Settings → Content
  filters. **Every new content surface applies `filteredEventVerdict`
  before rendering — an unfiltered screen is a Play-compliance hole.**
- **Spam links**: `search.html`-class search-spam paths, known spam hosts
  (t.me spam waves, postimg QR spam), link dumps (>3 URLs or >60% link
  characters) hide outright.
- **Hashtag spam** (the `#ziwei-comm-anchor` class — bots planting tags in
  feeds, fought the same way as Amethyst's `hasExcessiveHashtags`): an
  anchor-shaped tag (`-comm-anchor`/`-anchor`/… suffixes), a hashtag-only
  post, hashtags + ≤2 camouflage words, and >5 hashtags (content + t tags)
  all hide. Author labels beat spam shape — a lone `#nsfw` warns, not hides.
- **Store compliance**: Play UGC + Apple 1.2 require hidden-by-default
  explicit content, report + block. Report dialog is NIP-56 (child safety
  first); block is local + NIP-51 mute list.
- **Anti-manipulation feed ranking** (`features/explore/domain/feed_ranking.dart`):
  Trending/Discover rank on signals that are EXPENSIVE TO FAKE, not raw
  engagement counts (a bot cluster can inflate "most liked"). The formula
  (validated by `feed_ranking_test.dart`): **unique engagers dominate**
  (deduped pubkeys — 50 fresh-key likes ≈ 1-2 real engagers), raw
  reactions/reposts are discounted + capped (bot upside bounded), **zaps
  weigh 1.5×** (they cost sats — the strongest anti-spam signal), freshness
  decays (HN-style), and a **per-author diversity cap** stops one author
  dominating. `EventEngagement.uniqueEngagers` (deduped) is the key input —
  rank on it, never on raw `score`. Safety/moderation is a HARD exclusion
  applied by the caller before ranking — popularity never overrides a
  filter verdict.
- **Sensitive-content display preference** (`sensitiveModeProvider`,
  Settings → Content filters): the blueprint's three-option user layer —
  `hide` (collapse), `blur` (tap-to-reveal `_ContentWarningCover`, the
  default), `allow` (show). Applies to NIP-36 warn verdicts (author-tagged
  OR detector-flagged). Never render the sensitive image under an overlay —
  the cover REPLACES it (thumbnails/previews must not leak it either).
- **Flood / duplicate-post filter** (`core/moderation/flood_detector.dart`):
  keeps the platform from drowning in "same post every few minutes" spam
  (the bala-offer / token-drop floods). Three signals, judged client-side in
  `FeedNotifier._applyFlood` + the live tail: **author flood** (same author,
  same normalized content ≥3× in 30 min), **spray** (same content from ≥4
  DISTINCT authors in 30 min — catches disposable-key waves), and
  **rapid-fire** (one author ≥8 posts in 5 min regardless of content).
  `contentKey` normalizes trim/whitespace/case/trailing-punct so near-
  duplicates cluster. Legit/distinct posts pass through (pinned by tests);
  kind ≠1 events are never flood-judged. Bounded in-memory LRU (no disk).

## Post rendering edge cases (the "empty post" family)

- **Media-only posts** (content was only image/video URLs) render ONLY the
  media — `NoteContent` collapses the text column when no visible segment
  remains (`hasVisibleText`). Audio/plain links count as visible.
- **Raw 64-char hex keys** in content resolve to a mention label (the
  person's name) via `_HexKeySegment` + `_MentionLabel` — never the wall of
  hex itself.
- **UTF-16 safety**: `NostrEvent.getTag`/`getTags` sanitize by default
  (lone surrogates in titles/names/descriptions were crashing the paint
  pipeline). Use `getTagRaw` only for values that never reach a Text widget
  (bolt11, JSON blobs, addresses). `nostr_models.dart` re-exports
  `text_sanitize.dart` so `sanitizeText` is available wherever models are.

## In-app documentation

- **Docs** (`features/docs/`): user-facing guides, not developer docs.
  `docs_data.dart` holds the catalogue (`AppDoc` entries with headed
  `DocSection`s); `docs_screen.dart` renders search + category chips + cards,
  and a `_DocReaderScreen` that prints the sections. A guide with a `route`
  gets an "Open it" button deep-linking to its feature screen — write the
  guide AND set the route; the card always opens the reader first.
  Developer/protocol documentation lives in the repo `docs/` folder and
  `NIP.md`, not here.

## Studio, memberships & zap goals (premium-only seller side)

- **Studio** (`features/studio/`): the creator dashboard, gated on
  `canUseStudioProvider` (= `isPremiumProvider` — a paid, ACTIVE,
  non-generated NIP-05 name or lightning address). Real earnings from
  `studioEarningsProvider` — validated NIP-57 zap receipts naming the user,
  split per-day, never hardcoded numbers. Non-premium users see the
  `_StudioGate` upsell, signed-out users a sign-in prompt.
- **Memberships** (`features/memberships/`): user-to-user subscriptions.
  Selling (creating tiers) is premium-gated (`canSellMembershipsProvider`);
  subscribing is open to anyone. **A subscription IS a zap to a tier** — the
  receipt is the proof, nothing renews on its own. Tiers are kind 37001
  (addressable, `d`-tag slug is identity — same slug replaces = edit).
  Subscribe = NIP-57 zap whose request `a`-tags the tier
  (`MembershipService.buildSubscriptionInvoice` → `showPayInvoiceSheet`);
  confirmation is the receipt appearing on relays naming the tier + payer
  (`_receiptSeen`), never a local record. Standing is computed from
  validated receipts (`tierStanding`/`standingFrom` in
  `features/studio/models/subscription.dart`, port of web
  `lib/subscription.ts`); a period is bought by ONE payment covering the
  price — underpayment is a tip, surfaced as `shortfallSats`.
- **Zap goals** (NIP-75, kind 9041): model in
  `features/studio/models/zap_goal.dart` (port of web `lib/nip75.ts`).
  `relays` + `amount` (msat) tags are REQUIRED. Progress = validated 9735
  receipts `e`-tagging the goal, tallied from the reader's relays; a goal is
  funded by zapping it, or by announcing it in a kind-1 note carrying a
  `goal` tag (`announceGoalProvider`) so zaps on the note count too. Create
  via `ZapGoalEditorSheet`, card `ZapGoalCard` (announce/retire for own).
- **Event creation**: `NostrService.createEvent(kind, content, tags)` signs
  any kind (tiers 37001, goals 9041, zap requests 9734, deletions kind 5).
- Providers: `studio/providers/studio_providers.dart` (earnings, goals,
  publish/retire/announce) and `memberships/providers/membership_providers.dart`
  (tiers, standings, subscribe invoice). All `.autoDispose` FutureProviders;
  mutations invalidate the relevant providers after publishing.

## Event pipeline (ADR-0005 — relays → dispatch → store → projections)

The layered pipeline that replaced ad-hoc per-screen subscriptions. Design +
phasing: `docs/ADR-0005-event-pipeline.md`; findings:
`docs/PERFORMANCE-ANALYSIS.md`, `docs/AUDIT-feed-profile-upload.md`;
notifications roadmap: `docs/ADR-0006-push-notifications.md`.

- **L2 dispatch — `EventBus`** (`core/nostr/event_bus.dart`): ONE hub for
  relay subscriptions. Providers register filter "specs"; identical filters
  across screens are ref-counted into a single relay REQ, and events are
  deduped across specs (`matchesEvent` is local). Social, DM and feed-tail
  subs go through it — NEVER open a raw `relayPool.subscribe` for a new
  listener without checking the bus first.
- **Flood gate**: the bus drops bursts that can't be UI-relevant before they
  reach the store (per-kind/sender rate gates), so a spammy relay can't jank
  the main thread.
- **L4 write path — `ingestPipelineProvider`** (`core/providers/
  ingest_pipeline_providers.dart`): the SINGLE path every event takes into
  `EventStore` (feed pages, live tail, social, engagement). It owns the
  debounced `engagementVersionProvider` tick (one bump per batch, not per
  event). Never write to `EventStore` from a feature directly.
- **Store structure (ADR-0008 God-object split)**: `core/db/event_store.dart`
  is the FAÇADE + the interlinked core (schema v1–v8 + migrations, NIP-01
  ingest lifecycle, feed/engagement/thread/seen-on queries). The domains with
  ZERO interaction with ingest are split into `core/db/stores/` — `MessageStore`
  (DMs+outbox+search), `NotificationStore`, `RelayStore` (fleet+affinity),
  `MediaStore`, `PublishOutboxStore`, `ProfileStore` (+FTS), `MaintenanceStore`
  (prune/clear/diagnostics). They share ONE database + ONE writer lane via
  `core/db/store_host.dart` (`StoreHost`: `db` + `enqueueWrite(touches:)` +
  `ftsAvailable`) — NO import cycle (a domain store never imports
  `event_store.dart`; `EventStore implements StoreHost` and injects itself).
  `EventStore.instance.<method>` still works (the façade delegates), and
  `EventStore.instance.messages/.notifications/.relays/.media/.publishOutbox/
  .profiles/.maintenance` expose the domain stores directly. New feature
  storage goes in a NEW store under `stores/` (never re-grow event_store.dart).
- **UI loading + cold-start paint (offline-first)**: every data screen paints
  from the STORE instantly (never a skeleton while a relay fetch runs) and
  merges the network result behind it — the same pattern as the feed.
  `conversationListProvider` and `dmThreadProvider` (chat) and
  `notificationsProvider` are **StreamProviders that yield TWICE**: (1) the
  durable store rows (decrypted DM plaintext / notification history already
  on disk), then (2) the merged relay result. Loading states use the shared
  skeleton kit (`core/widgets/skeleton.dart`: `SkeletonList`/`SkeletonBox`/
  `SkeletonLine`/`SkeletonCircle`/`SkeletonTheme`) — NEVER a bare
  `CircularProgressIndicator` on a data screen (the chat list + thread still
  show skeleton only on a genuinely empty first-ever load). Images decode at
  display size: EVERY `CachedNetworkImage` sets `memCacheWidth` (feed tiles
  1200, card covers/thumbnails 800) + `httpHeaders: kImageHttpHeaders` — a
  raw `Image.network` is banned (no cache, no headers, no decode cap; it 403s
  on Android and decodes full-res).
- **Store v4** (`core/db/event_store.dart`, ADR-0008 P0): schema v2 added
  `thread_edges` (parent→reply rows at ingest — `threadReplies(rootId)`)
  and `seen_on` (relay provenance, buffered via `markSeenOn`). v3 added
  `tags` + `deletions` (NIP-01 lifecycle). **v4 adds** `order_ts` +
  `expires_at` columns + `idx_refs_pubkey_kind` + `idx_events_pubkey_kind_time`,
  and the engine is now tuned for mobile. The `db` getter is race-free
  (shares one `_opening` future, never caches a failed open).
  `feedPage(authors: [])` is deliberately UNFILTERED — the feed layer must
  guard empty follows itself (the "Following tab leaked global" bug).
  **v4 rules (ADR-0008)**:
  - **Engine pragmas** on open: `journal_mode=WAL` (readers don't block the
    writer), `synchronous=NORMAL` (no per-commit fsync), `busy_timeout=5000`
    (never SQLITE_BUSY), `journal_size_limit≈6MB`, `foreign_keys=ON`.
  - **Single-writer lane**: ALL mutations (ingest/prune/clear/deletions/
    profile writes) serialize through `_enqueueWrite` — SQLite never sees
    two concurrent write txns. Readers bypass (WAL). Never open a second
    write path; go through the lane.
  - **feedPage ORDER BY is sargable**: `order_ts` = `MIN(created_at,
    now+15min)` computed ONCE at ingest (the future-clamp), so ORDER BY is
    an index walk on `idx_events_kind_ordertime` — NOT the old non-sargable
    `MIN(created_at,?)` per-row temp-B-tree. Pre-v4 rows (order_ts=0) fall
    back to created_at.
  - **NIP-40 as a column**: `expires_at` (the multi-letter `expiration` tag
    isn't in the single-letter `tags` table) → expired rows delete by index
    at read AND prune (they used to accumulate until LRU).
  - **Prune fixes**: deletes the `tags` rows of evicted events (the old
    ORPHAN LEAK grew the index table unboundedly), deletes expired rows, and
    runs a PASSIVE WAL checkpoint off the hot path. `clear()` now wipes ALL
    tables (tags/thread_edges/seen_on/deletions too — logout must not leak
    stale provenance into a fresh account).
  - **Migration is idempotent** (`_addColumnIfMissing` probes pragma_table_info
    — SQLite has no `IF NOT EXISTS` for columns). Tests migrate in-memory
    DBs to v4 (`debugOnUpgrade(db, 1, 4)`).
  - **Canonical storage records**: `core/db/db_models.dart` — typed
    fromRow/toRow per feature table (DbMessage/DbThread/DbNotification/
    DbPublishJob/DbMedia/DbRelayHealth/DbDraft). A schema change touches ONE
    method, not every feature. (Tables for these land in P1+.)
- **Projections over the store** (L5): trending is local candidates from
  `trendingCandidates(window)` painted first, then a relay discovery fetch
  merges in (switching 1h/24h/7d is a local re-query, not a refetch).
  `userInteractionsFor` (did-I-like/repost) and `searchProfiles` are local
  SQL — per-card relay queries and search waterfalls are banned.
- **Profile cache hierarchy** (`SocialRepository`): memory LRU → SQLite →
  relays, stale-while-revalidate, write-through on kind-0. Survives restart;
  `_refreshProfileFromRelays` races concurrent first-non-empty legs.
- **Relay frame processor (off-isolate parse+verify + backpressure)**:
  `core/nostr/relay/relay_frame_processor.dart`. Every WebSocket frame from
  EVERY relay is JSON-decoded AND Schnorr-verified on a pool of persistent
  worker isolates (default 2, cap 4), NOT on the UI isolate — the "Android
  jank" mechanism (a 50-post page × 9 relays = up to 450 `jsonDecode` +
  `bip340.verify` calls on the frame thread; iOS's fast core masked it).
  This is the standard high-throughput Nostr-client architecture (Amethyst
  PR #2769 parallel-verify + bounded ingest channel; nostrfy
  `verify_signatures_parallel`, thread-capped, fail-closed). Design:
  - `RelayFrameProcessor` — the worker pool. Frames go in as raw strings,
    come out as typed `RelayFrame`s (`Event/Eose/Ok/Auth/Closed/Ignored`)
    via a two-port handshake. Sync fallback on web / spawn failure (still
    correct, just not off-thread). Fail-closed on any error.
  - **`VerifyLru`** (per-worker, 6k ids) — the cross-relay verify dedup:
    first copy of an id pays the Schnorr, later copies skip it, but EVERY
    copy still DISPATCHES (`markSeenOn` provenance needs every relay's
    copy). (Moved here from the old pool-level `markVerified` LRU, gone.)
  - **`FrameSequencer`** (per-connection) — restores socket frame ORDER:
    the pool completes frames out of order across workers, and an
    EOSE/CLOSED/OK must never overtake the EVENTs that preceded it on the
    same socket (query() unsubscribes on EOSE — reordering would drop
    events). Reset on every reconnect.
  - **Backpressure** — pure `backpressureSignal` watermark state machine
    (saturate > highWater 768, drain ≤ lowWater 192, hysteresis gap stops
    flapping). `RelayPool` listens and `pauseSocket()`/`resumeSocket()`
    every connection — TCP flow control slows the relays at the SOURCE
    instead of our memory ballooning (Amethyst's bounded-channel pattern).
  - `RelayConnection._handleMessage` just submits to the sequencer; the
    UI-isolate `_dispatchFrame` only reassembles the already-decoded,
    already-verified event (no decode, no crypto) + routes EOSE/OK/AUTH/
    CLOSED exactly as before. Tests: `relay_frame_processor_test.dart`
    (parse/verify/fail-closed/flood/order/reset/backpressure watermarks),
    `verify_dedup_test.dart` (the LRU contract).
- **Browse screens = keepAlive + TTL AsyncNotifiers + STORE-FIRST paint**:
  trending/hashtags/notifications/communities/articles/bookmarks/lists/
  calendar/market/live/videos/hashtagFeed/dms keep their state; the TTL
  gates natural rebuilds and `ref.invalidate` still forces a refetch.
  Empty results are NOT TTL-cached (an empty fetch must be retryable).
  autoDispose stays only on per-card family providers.
  **Store-first paint (2026-10-27)**: every browse Notifier now reads the
  SQLite store BEFORE awaiting the relay — `queryByFilters` with the
  screen's kind(s) paints instantly on re-entry (and offline), the relay
  fetch merges behind via `_refreshBehind()` (fire-and-forget, updates
  state when it lands). Feature screens that used to define their own
  autoDispose relay-first providers now delegate to the core providers:
  Market/Live/Calendar/Lists screens use `marketProvider`/`liveStreamsProvider`/
  `calendarProvider`/`listsProvider` (parsing to domain models at the screen).
  Groups has its own `GroupsNotifier` (same pattern). Search is local-first:
  FTS5 profile search + local content LIKE + local tag query paint before
  the relay NIP-50 search merges. Community detail feed is store-first with
  parallel relay queries (was 2 sequential). Reels engagement reads
  `localEngagementProvider` (SQL) instead of `engagementProvider` (relay),
  and reel likes go through `postActionsProvider` (store-ingesting) instead
  of raw publish. `myGroupsProvider` batches member checks (was N sequential
  relay calls). `joinedCommunityCoordsProvider` is keepAlive + store-first.
  **Second pass (2026-10-27b)**: profile tabs (joined/created communities)
  store-first + parallel coordinate resolution (was 1+N sequential relay
  queries); Studio earnings + zap goals + membership tiers/receipts read the
  store first with relay backfill (the dashboard no longer awaits 10s relay
  legs); P2P orders store-first; Bounties delegate to the core
  `marketProvider` (same kind-30402 dataset, filtered); article comments +
  addressable engagement store-first (local tally instantly); group chat
  persists messages to the store (store-first paint on room re-open +
  optimistic send persisted + live sub ingests); profile-tab loading states
  use `SkeletonList` (never a bare spinner on a data surface); explore
  hashtag row uses skeleton chips.
- **Background catch-up — closed-app notifications (Insta/FB tier)**:
  `BackgroundSyncService.syncNow()` runs every **15 min** (the OS-enforced
  periodic minimum) and notifies for BOTH: **DMs** (`dmGapFill`) AND
  **social engagement** (zaps/replies/follows/likes/reposts/comments) via
  `_notifySocialEngagementSinceLastRead()` — fetches kind 1/3/6/7/16/1111/
  9735 `#p`=me since a SEPARATE background watermark
  (`bg_social_notified_watermark_v1`, so background notify ≠ marking the
  bell read). Dedup + burst-collapse + recipient-awareness ride the same
  `LocalNotificationService`/`NotificationCenter` paths as the foreground
  listener. iOS: `UIBackgroundModes` (fetch/processing) +
  `BGTaskSchedulerPermittedIdentifiers` in `ios/Runner/Info.plist`.
  Settings toggle `backgroundSyncEnabledProvider` (default ON). True
  INSTANT push = ADR-0006 Tier 3 (relay-side FCM/APNS bridge on
  relay.nostrfeed.com) — push is just another trigger into `syncNow()`.
  **Phase 4 sync window (ADR-0007)**: the opt-in heavier tier — Settings
  toggle `syncWindowEnabledProvider` (default OFF, Android-only via
  `syncWindowSupported`). `scheduleSyncWindow()` queues an expedited one-off
  workmanager task promoted to a `dataSync` FGS (`ForegroundServiceConfig`)
  — NO native code/manifest/BOOT_COMPLETED (Android-15-safe), and it
  self-reschedules while the toggle stays on, degrading to the hourly
  catch-up under quota/Doze. The dispatcher routes `window` inputData to a
  bounded `_runSyncWindow` (syncNow every 2 min for `windowDuration` 20 min).

- **In-app local relay (ADR-0007, phases 0–5 DONE)**: the app embeds a real
  NIP-01 relay. `core/nostr/filter.dart` = ONE oracle-tested compiled-filter
  engine (empty list = match nothing, hex case-insensitive, NIP-01 `&&`/`||`);
  `core/db/event_store.dart` v3 = `tags`/`deletions` tables + lifecycle
  (ephemeral skip, replaceable/addressable newest-wins, NIP-09 e/a deletes +
  late-copy rejection, NIP-40 exclusion) + generic `queryByFilters`;
  `core/relay/relay_core.dart` = `LocalRelay` (REQ/EVENT/CLOSE→OK/EOSE/…,
  inverted-index live monitor); `core/relay/relay_server.dart` = real ws on
  `127.0.0.1` (random port + per-boot token + request caps — loopback is
  SHARED on Android, the token is what makes it private);
  `core/relay/relay_transport.dart` = `MergedRelayTransport` feeding the
  EventBus (local live + remote, deduped) behind `localRelayEnabledProvider`
  (off = exact old behavior); the ingest pipeline mirrors every stored event
  into the relay (`localRelayProvider`). Remote pool still owns publishes +
  NIP-65 outbox. **All reads local-first (phase 3c)**: `RelayPool.query` is
  local-first merged via `core/relay/local_first_query.dart` — local store +
  remote relays in parallel, deduped, remote ingested back; ONE choke point
  covers every repository read (feed/engagement/profiles/notifications/
  comments/threads/articles/market/live/calendar/groups/lists/bookmarks/
  videos/hashtags). Per-filter NIP-01 limit union. Uppercase NIP-22 `A`/`E`
  scopes + `NostrFilter.remoteOnly` go remote-only (store indexes
  single-letter first-values only). Rollback `relayPool.localFirstEnabled=false`.
  Ingests are serialized through a queue (sqflite txns aren't re-entrant).
  **NIP-77 sync (phase 5)**: `core/nostr/sync/negentropy.dart`
  = faithful port of hoytech's reference negentropy (initiator/responder,
  varint/bound/fingerprint codecs); `negentropy_sync.dart` = NEG-OPEN/MSG/
  CLOSE client (injected transport, downloads missing, NEG-ERR→null
  fallback); `negentropy_sync_service.dart` = per-relay service called from
  `BackgroundSyncService.syncNow` (NEG-unsupported relays skipped silently);
  `negentropy_transport.dart` = the real-ws transport. Never add a second
  filter engine or a raw `feedPage`-style SQL filter — go through the
  compiled engine + `queryByFilters`.

## Testing

- Unit/widget tests in `test/` mirror the `lib/` structure
  (`test/models/`, `test/core/utils/`, `test/core/widgets/`, …).
- Tests must be deterministic — mock/avoid network. Live-relay tests belong
  in `integration_test/`.
- **EventStore tests**: use `sqflite_common_ffi` with `inMemoryDatabasePath`
  ONLY — a named path opens a real file that persists across tests and
  causes "passes alone, fails in the suite" flakes. Hooks:
  `EventStore.debugOpenOverride` / `debugReset` / `debugFlushSeenOn`.
  `flutter pub get` only works with `--offline` in this environment.

---

## Flutter AI agent rules (official)

### Proactive Flutter Hot Reload Rule

Whenever you edit or modify any `.dart` file under `lib/` in this project:

1. **When to Skip**:
   - **Files Outside `lib/`**: Only trigger hot reload or hot restart for edits under `lib/`. Do not trigger when modifying files in other directories (e.g., `test/**`, `integration_test/**`, `benchmark/**`, `test_driver/**` or `example/**`).
   - **Comments & Documentation**: Do not trigger hot reload or hot restart when changes only affect comments, docstrings, or whitespace.

2. **Discover & Connect**:
   - Discover active running application instances using the `dtd` MCP Tool (or `list_running_apps` / `vm_service`) from the Dart MCP server.

3. **Trigger Hot Reload / Hot Restart**:
   - Execute the `hot_reload` MCP tool immediately after making changes to UI widgets (including `build` methods of stateful widgets) or simple methods.
   - Execute the `hot_restart` MCP tool if fundamental logic, state initialization (e.g., `initState`), global/static state, or `main()` was modified.

### Available Flutter/Dart agent skills

The official Flutter and Dart agent skills are installed globally (`~/.agents/skills/`) and cover: widget tests, integration tests, widget previews, responsive layouts, layout-issue fixes, architecture best practices, JSON serialization, declarative routing (`go_router`), localization, the `http` package, Dart unit tests, mock generation (mockito), static analysis, coverage, pattern matching, primary constructors, FFI, path handling, documentation, and more. Invoke the matching skill before performing these tasks.
