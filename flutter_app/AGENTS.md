# NostrFeed Mobile — Agent Guide

Flutter app for NostrFeed. Riverpod 2.6 + go_router 16, feature-first architecture.

## Commands

```bash
flutter pub get
flutter analyze        # must stay at 0 issues in lib/
flutter test           # unit/widget tests (deterministic, no network)
flutter run            # debug run
```

Integration tests that hit **live relays** live in `integration_test/` — do NOT run them in CI.

Debug scripts (print-heavy, hit live services) live in `tool/`.

## Architecture

```
lib/
├── main.dart                 # entry point only
├── app/
│   ├── app.dart              # NostrFeedApp root widget
│   └── router.dart           # routerProvider (go_router) + NIP-19 route loader
├── core/                     # shared, feature-agnostic
│   ├── config/env.dart       # compile-time env (--dart-define)
│   ├── models/nostr_models.dart   # NostrEvent, NostrFilter, NostrProfile, AuthState
│   ├── nostr/                # Nostr infrastructure
│   │   ├── relay_pool.dart   # WebSocket relay connections (NIP-42)
│   │   ├── nostr_service.dart     # facade: init, publish, event creation, delegates
│   │   ├── nostr_context.dart     # signing context shared by repositories
│   │   └── repositories/
│   │       ├── feed_repository.dart        # feed/lists/discovery queries
│   │       ├── engagement_repository.dart  # likes/reposts/zaps/interactions
│   │       ├── social_repository.dart      # profiles, follows, search, bookmarks
│   │       └── dm_repository.dart          # NIP-04 + NIP-17 DMs
│   ├── providers/app_providers.dart        # global providers (auth, feed, theme…)
│   ├── services/http_helper.dart           # ApiHttpClient + ApiHttpException
│   ├── theme/                # app_theme.dart (AppTheme, AppStatusColors), app_spacing.dart (AppSpacing, AppDurations)
│   ├── utils/                # nip19, markdown, event_debugger
│   └── widgets/              # shared UI: ErrorView, EmptyState, SkeletonList,
│                             # AsyncFeedList, AppSheet/AppDialog, app_shell,
│                             # profile_avatar, smart_network_image
└── features/<feature>/       # one folder per feature
    ├── <feature>_screen.dart # screen(s)
    ├── providers/            # feature-local Riverpod providers (if any)
    ├── services/             # feature-local services (if any)
    └── widgets/              # feature-local widgets (if any)
```

Feature folders: articles, auth, bookmarks, bounties, calendar, chat,
communities, compose, docs, explore (explore+trending+hashtag), feed, groups,
identity, lists, live, market, memberships, notifications, p2p, premium,
profile, reels, sats_drops, search, settings, studio, wallet, zap.

Large screens are decomposed into feature-local `widgets/` (e.g.
`features/chat/widgets/` — message bubble, new message sheet, suggested
peers…; `features/wallet/widgets/` — payments list, address sections, sign-in
dialog…). Keep screen files focused on layout + wiring; extract any widget
over ~100 lines.

## Conventions (follow these)

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
  - Polls (kind 1068, NIP-88) render via `PollCard` with voting + tallied
    results (`PollResults.tally` follows NIP-88 counting rules).
  - A lone plain link in a short post gets a `LinkPreviewCard`.
- **Chat / DMs**: all DM decryption + conversation/thread assembly goes
  through `dmStoreProvider` (`features/chat/providers/dm_store.dart`). NIP-17
  gift wraps can NOT be decrypted by their sender and have randomized
  timestamps — so sent messages must be shown from the store's local outbox,
  never by re-fetching from relays. `MessageBubble` is presentational only.
  Delivery status is tracked via `MessageStatus` (pending → sent after
  `publishWithAck`, failed → tap to retry / long-press to delete). Unread
  counts use per-peer last-read watermarks (`markThreadRead`) — the chat tab
  badge shows TOTAL unread, and `dmNotifierProvider` shows an in-app banner
  for incoming DMs. Incoming DMs arrive via the real-time subscription
  (`dmLiveEventsProvider` → `dmLiveListenerProvider` → `DmStore.ingest`) —
  NIP-17 backdates created_at up to 2 days, so unread/banner decisions use
  ARRIVAL time (`arrivalTsOf`), never the event's created_at.
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
- **AppBar architecture**: `AppShell` owns THE AppBar for the 4 tab routes
  (hamburger ↔ drawer works because the leading's context is below the
  drawer Scaffold; Flutter auto-generates the back button on pushed
  routes). Tab screens render **body-only** Scaffolds — never give a tab
  screen its own AppBar, and never hand-roll a drawer button inside a
  screen (it resolves to the screen's inner, drawer-less Scaffold).
  Global actions (search, notifications, 3-dot overflow with profile/
  bookmarks/settings/theme/docs) live in the shell AppBar. The shell AppBar
  is **hidden on chat threads** (`/chat/<pubkey>`) — threads are immersive
  and render their own header (back button + peer identity + encryption
  status).
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
- **HTTP APIs** (LNbits, Cashu, LNURL…): use `ApiHttpClient` — no raw
  `http.get + jsonDecode + statusCode` blocks.
- **Async safety**: guard `setState`/context use after async gaps with
  `mounted`; wrap fire-and-forget futures in `unawaited()`.
- **Secrets**: never hardcode — use `--dart-define` with `Env` class.

## Testing

- Unit/widget tests in `test/` mirror the `lib/` structure
  (`test/models/`, `test/core/utils/`, `test/core/widgets/`, …).
- Tests must be deterministic — mock/avoid network. Live-relay tests belong
  in `integration_test/`.
