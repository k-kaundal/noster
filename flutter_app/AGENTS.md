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
- **Freshness caches** (`profileCache`/`followsCache`) are instance state on
  `NostrService`, injected into `SocialRepository` — never static globals.
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
