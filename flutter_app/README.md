# NostrFeed Mobile

NostrFeed — Nostr Operating System for People, Creators & Communities.
Flutter client (Android / iOS).

## Quick start

```bash
flutter pub get
flutter run --dart-define-from-file=.env   # or: ./tool/run_app.sh
```

Build-time configuration (relays, LNbits, Cashu mint, premium links) is done
via `--dart-define`, see `lib/core/config/env.dart`.

## Quality gates

```bash
flutter analyze   # 0 issues in lib/
flutter test      # deterministic unit + widget tests
```

## Release build (Android)

```bash
flutter build appbundle --release --analyze-size --target-platform android-arm64 --dart-define-from-file=.env   # or: ./tool/build_release.sh
```

Download size: **27.9 MB** (arm64 AAB slice, budget ≤ 35 MB — ADR-0004).
R8 + resource shrinking on; the bundled ML Kit barcode model is excluded
(~6 MB saved, `android/app/build.gradle.kts`).

## Architecture

Feature-first layout with a shared `core/` layer. See [AGENTS.md](AGENTS.md)
for the full structure diagram and conventions.

- **State management**: Riverpod (autoDispose providers)
- **Routing**: go_router (`lib/app/router.dart`)
- **Nostr**: custom relay pool + repositories under `lib/core/nostr/`
- **Shared UI kit**: `ErrorView`, `EmptyState`, `SkeletonList`,
  `AsyncFeedList`, `AppSheet`, `AppDialog` under `lib/core/widgets/`

## Documentation

- User guides ship **in the app** (Docs screen, `lib/features/docs/docs_data.dart`).
- **Architecture / UX / size plan**: [`docs/PLAN-architecture-ux-size.md`](docs/PLAN-architecture-ux-size.md)
- Protocol notes (event kinds, tag shapes, draft kinds): [`../NIP.md`](../NIP.md)
- Creator monetization (Studio, memberships, zap goals — web + mobile):
  [`../docs/studio-monetization.md`](../docs/studio-monetization.md)
- Web-app guides (zaps, verified names, LNbits…): [`../docs/`](../docs/)

## Regenerating icons / splash

```bash
dart run flutter_launcher_icons
dart run flutter_native_splash:create
```
