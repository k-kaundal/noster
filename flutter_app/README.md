# NostrFeed Mobile

NostrFeed — Nostr Operating System for People, Creators & Communities.
Flutter client (Android / iOS).

## Quick start

```bash
flutter pub get
flutter run
```

Build-time configuration (relays, LNbits, Cashu mint, premium links) is done
via `--dart-define`, see `lib/core/config/env.dart`.

## Quality gates

```bash
flutter analyze   # 0 issues in lib/
flutter test      # deterministic unit + widget tests
```

## Architecture

Feature-first layout with a shared `core/` layer. See [AGENTS.md](AGENTS.md)
for the full structure diagram and conventions.

- **State management**: Riverpod (autoDispose providers)
- **Routing**: go_router (`lib/app/router.dart`)
- **Nostr**: custom relay pool + repositories under `lib/core/nostr/`
- **Shared UI kit**: `ErrorView`, `EmptyState`, `SkeletonList`,
  `AsyncFeedList`, `AppSheet`, `AppDialog` under `lib/core/widgets/`

## Regenerating icons / splash

```bash
dart run flutter_launcher_icons
dart run flutter_native_splash:create
```
