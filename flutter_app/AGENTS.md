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
│   ├── theme/                # app_theme, app_spacing, app_durations, app_motion
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
  single dead relay.

- **Imports**: always `package:nostrfeed_mobile/...` (never relative).
- **State**: Riverpod. All `FutureProvider`s use `.autoDispose`. All state
  notifiers use `Notifier`/`AsyncNotifier` (legacy `StateNotifier` is fully
  migrated — do not reintroduce it).
- **Post interactions** (like/repost/bookmark/zap refresh): go through
  `postActionsProvider` (`features/feed/providers/post_actions.dart`) — never
  inside widgets.
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
- **Chat / DMs**: all DM decryption + conversation/thread assembly goes
  through `dmStoreProvider` (`features/chat/providers/dm_store.dart`). NIP-17
  gift wraps can NOT be decrypted by their sender and have randomized
  timestamps — so sent messages must be shown from the store's local outbox,
  never by re-fetching from relays. `MessageBubble` is presentational only.
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
- **NIP-17 self-copy**: `signGiftWrap` seals EACH wrap to its own target
  (recipient copy → recipient, sender copy → sender). Never share one seal
  between wraps — the sender can't decrypt it (this caused "unable to decrypt").
- **DM banner**: `DmAlertBanner` lives ABOVE the router (MaterialApp.builder)
  — navigate via `ref.read(routerProvider).push(...)`, never `context.push`.
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
- **Navigation architecture**: bottom nav = **Home · Reels · Create (center) ·
  Chat (badge) · Wallet**. The center CREATE button opens a create sheet
  (Ask AI / post / article / reel / live / group) — Instagram pattern. The
  shell AppBar + bottom nav are **hidden on immersive routes** (chat threads,
  reels player) which render their own headers. Drawer is grouped by intent
  (Discover / People / Money / You) — never a flat 20+ item list. Detail
  routes use `DetailScaffold` (back button + title). Never hand-roll a drawer
  button inside a screen (it resolves to the inner drawer-less Scaffold).
- **AI Assistant visibility** (the flagship feature — surface it everywhere,
  gated on `aiAvailableProvider` so keyless builds never tease it): the shell
  AppBar has a ✨ button next to Search, the create sheet leads with "Ask AI",
  the Home feed's tab row has a compact ✨ shortcut button next to the avatar,
  and an `_AiPromoCard` is injected once into the For You feed at position 3
  (For You only, never Following — the ListView indices shift by one after
  it). Drawer entry lives under Discover → AI Assistant; the guide is in Docs
  (route `/ai`). The AI chat itself is a detail route outside the shell.
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
- **Design tokens**: spacing → `AppSpacing`; timeouts → `AppDurations`;
  status colors → `AppStatusColors`; brand gradient → `AppTheme.brandGradient`.
- **Motion (ADR-0003)**: every animation uses `AppMotion` tokens (durations,
  curves, stagger) — never magic numbers. Cheap approaches first: Hero +
  implicit animations + go_router `appTransitionPage` (0 KB);
  `flutter_animate` for staggered entrances (`StaggeredListItem` for list
  rows; `PostCard` fades in ONLY in thread view — never in a feed, see the
  feed-performance rule below); feed images Hero-fly to fullscreen (SVGs
  excluded). Rive is deferred (≤2 signature moments, NDK pinned) — do NOT
  add it without an ADR change.
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
- **Async safety**: guard `setState`/context use after async gaps with
  `mounted`; wrap fire-and-forget futures in `unawaited()`.
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
  Explore card, wallet AI-credits card, shell ✨ button, create sheet "Ask AI".
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

- **FeedStore** (`features/feed/providers/feed_store.dart`): bounded JSON
  cache in SharedPreferences (300 events per feed). Cold start renders the
  cache on the first frame — posts, not skeletons.
- **FeedNotifier** (`feed_notifier.dart`): `FeedState(events, isRefreshing,
  hasMore, isLoadingMore, newCount, error, lastSyncedAt)`. Pipeline:
  disk → silent network refresh (merges, no re-order, no skeleton) →
  persist. Live subscription counts new posts into `newCount` (the "N new
  posts" pill — NEVER auto-inserts, that yanks scroll position).
  `loadMore()` walks the `until` cursor for infinite scroll.
- **Providers**: `globalFeedProvider`, `followingFeedNotifierProvider` —
  NotifierProviders (not autoDispose). Refresh after posting goes through
  `.refresh()` (silent merge), never `ref.invalidate` (that flickered).
- **FeedScreen**: RefreshIndicator + offline banner (slim strip, feed stays
  usable) + new-posts pill + pagination spinner. Tabs keepAlive.
- **Connectivity** (`core/providers/connectivity_providers.dart`):
  `connectivity_plus` stream → `isOfflineProvider`; `connectivityWatcherProvider`
  reconnects dead relays on offline→online (watched at app root).
- **Profiles**: `profileProvider` is keepAlive (NOT autoDispose) — the
  10-min `profileCache` handles staleness; disposing on scroll-away was
  the avatar flicker. `userPostsProvider` is also keepAlive (profile tabs
  all filter the same list; disposing per tab re-fetched it).

## App version

- `core/providers/app_info_providers.dart`: `packageInfoProvider` +
  `appVersionProvider` read the platform bundle (pubspec `version:`) via
  `package_info_plus`. The drawer footer and Settings → App Version use it
  — NEVER hardcode a version string (the old `v1.0.0` lied on day two).

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
  tabs, `ExploreScreen` hashtag chips + People-to-follow. Block actions:
  post 3-dot menu → "Block author"; profile 3-dot menu → "Block account";
  manage lists in Settings → Content filters.
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

## Testing

- Unit/widget tests in `test/` mirror the `lib/` structure
  (`test/models/`, `test/core/utils/`, `test/core/widgets/`, …).
- Tests must be deterministic — mock/avoid network. Live-relay tests belong
  in `integration_test/`.
