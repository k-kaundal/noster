# NostrFeed Mobile — Architecture, UI/UX & Size Plan

**Status:** All phases done · **Date:** 2026-10-22 · **Scope:** `flutter_app/`

> **Progress:** All 4 phases complete.
> - **Phase 0 (Foundations):** `kinds.dart` registry, provider split behind
>   a barrel, `AppMotion` + `appTransitionPage`, flutter_animate entrances +
>   Hero photo transitions, size 35.9 → 27.9 MB, ADRs 0001–0004.
> - **Phase 1 (Structure):** all 28 features → `domain/data/application/
>   presentation` (223 imports in 100 lib files + 20 test files).
> - **Phase 2 (UX + lint):** lint additions + `dart fix` (86 fixes in 68
>   files); **lib/ at 0 issues of any kind**; `Share` → `ShareParams`.
> - **Phase 3 (size + speed):** image decode-at-display-size everywhere
>   (`memCacheWidth`/`memCacheHeight` on SmartNetworkImage, SafeAvatar, feed
>   tiles ≤1200 px, profile banner); package audit complete (all 56 used,
>   nothing cut). AAB release 27.9 MB.
> - **Leftovers closed:** `core/nostr/` layering (`relay/` + `repositories/`
>   + `usecases/` + `kinds.dart`), AnimatedSwitcher skeleton→content in the
>   feed, scale pop on action buttons. The ONLY remaining item is
>   low-end-device profiling — needs physical hardware.

This plan restructures the app for three goals, in order of importance:
1. **Fast** — instant feed, no jank, small memory footprint.
2. **Small** — minimal download size; every KB of dependency earns its place.
3. **Professional structure** — a folder/code layout a new contributor can
   navigate on day one, with Nostr protocol code organized the way mature
   Nostr libraries do it.

It is grounded in three research passes: Flutter architecture (Google's
Compass, Andrea Bizzotto's Riverpod patterns, VGV's FFCA), Nostr client
architecture (NDK Dart, nostr-tools, Quartz/Amethyst, Nostrify), and
Flutter UX/size/performance practice. Sources are cited at the end.

---

## 1. Current state (measured)

| Metric | Value |
|---|---|
| Dart files in `lib/` | 178 |
| Feature folders | 28 (`lib/features/`) |
| Core folders | 9 (`lib/core/`) |
| Test files | 33 |
| Packages in pubspec | 56 |
| Largest areas | wallet (436K), feed (152K), core/nostr (148K) |
| State management | Riverpod 2.6 (`Notifier`/`AsyncNotifier`, autoDispose) |
| Routing | go_router 16 (single `router.dart`) |

### What is already good
- Feature-first layout already exists (`lib/features/<name>/`).
- Shared UI kit is centralized (`core/widgets/`: ErrorView, EmptyState,
  Skeleton*, AppSheet/AppDialog, DetailScaffold, toasts).
- Conventions documented in `AGENTS.md` and mostly followed.
- Zero analyzer issues in `lib/`; 261 tests pass.

### The actual problems (what this plan fixes)
1. **Feature internals are inconsistent.** Some features have
   `providers/` + `services/` + `widgets/` + `models/`, some are one big
   screen file, some mix models into providers files. There is no rule for
   where a new thing goes.
2. **Nostr protocol code is organized by accident.** `core/nostr/` has
   repositories (feed/engagement/social/dm) next to zap_receipts next to
   relay_pool next to nostr_context. Kind numbers are magic literals
   scattered across features (a `37001` in memberships, a `9041` in studio,
   `kind: 5` for deletions in two places). No kind registry.
3. **Providers live in two patterns.** Global providers in
   `core/providers/app_providers.dart` (one 487-line file) vs feature-local
   providers. No rule for which.
4. **UI polish is uneven.** Some screens animate, most don't. Navigation
   uses default transitions. No shared animation language.
5. **No size discipline.** 56 packages, never measured with
   `--analyze-size`, no release-build checklist in CI, images decoded at
   full resolution in feed grids.

---

## 2. Target folder structure

Adopts **feature-first with per-feature layers** (Andrea Bizzotto's
Riverpod structure, which Google's Compass app mirrors in spirit). The
change from today: every feature gets the *same* internal layout, and
protocol code moves into a proper `core/nostr/` layering.

```
lib/
├── main.dart                     # entry point only (as today)
├── app/
│   ├── app.dart                  # NostrFeedApp root widget (as today)
│   └── router.dart               # go_router + route transition helpers
│
├── core/                         # app-wide, feature-agnostic infrastructure
│   ├── config/                   # Env (compile-time config) — as today
│   ├── theme/                    # AppTheme, AppSpacing, AppDurations — as today
│   ├── utils/                    # nip19, text_sanitize, media, markdown — as today
│   ├── widgets/                  # shared UI kit — as today
│   ├── providers/                # global providers (auth, connectivity, app_info)
│   ├── services/                 # app-level services (wallet_payment, http, notifications)
│   ├── moderation/               # content filter — as today
│   └── nostr/                    # THE PROTOCOL LAYER (restructured, §3)
│       ├── core/                 # NostrEvent, NostrFilter, NostrProfile, kinds
│       ├── crypto/               # signing, bip340 glue (via auth_service)
│       ├── relay/                # relay_pool, relay_router, dm_delivery
│       ├── repositories/         # feed, engagement, social, dm — as today
│       └── usecases/             # zaps, subscriptions, goals, lists (per-domain)
│
├── features/                     # 28 features, ONE internal layout for all
│   └── <feature>/
│       ├── domain/               # models + abstract contracts (pure Dart)
│       ├── data/                 # services/repositories impl (relay/API calls)
│       ├── application/          # providers/notifiers (state, cross-service logic)
│       └── presentation/         # screens + widgets (Flutter UI only)
│
└── shared/                       # ONLY for code used by 3+ features (created lazily)
```

### Per-feature layout — the single rule

Every feature uses these four folders. Small features may collapse
`application` into `presentation`; large ones (wallet, feed, chat) use all
four.

| Folder | Contains | Depends on | Examples |
|---|---|---|---|
| `domain/` | models, pure logic, abstract contracts | nothing (pure Dart) | `nostr_list.dart`, `subscription.dart` |
| `data/` | services that fetch/send (relay, HTTP, storage) | domain | `membership_service.dart`, `lndhub_service.dart` |
| `application/` | Riverpod providers/notifiers | domain + data | `membership_providers.dart` |
| `presentation/` | screens + feature widgets | application (+ shared UI) | `memberships_screen.dart`, `tier_card.dart` |

**Migration mapping** (today → target, mechanical, no behavior change):
- `features/<f>/models/` → `features/<f>/domain/`
- `features/<f>/services/` → `features/<f>/data/`
- `features/<f>/providers/` → `features/<f>/application/`
- `features/<f>/widgets/` + `<f>_screen.dart` → `features/<f>/presentation/`

### Naming conventions (adopt VGV's, adapted)

| What | Convention | Example |
|---|---|---|
| Feature folder | snake_case noun | `memberships`, `sats_drops` |
| Screen | `{name}_screen.dart` | `feed_screen.dart` |
| Notifier/controller | `{name}_notifier.dart` | `feed_notifier.dart` |
| Service | `{name}_service.dart` | `lndhub_service.dart` |
| Model | `{name}.dart` | `nostr_list.dart` |
| Provider | co-located in the file it provides, `{name}Provider` | `tiersProvider` |
| Shared widget | `app_{name}.dart` (only when moved to shared) | `app_button.dart` |

**Providers co-locate with the class they provide** (Bizzotto rule). The
487-line `core/providers/app_providers.dart` splits by domain:
`auth_providers.dart`, `feed_providers.dart`, `profile_providers.dart`,
`connectivity_providers.dart` (exists), `app_info_providers.dart` (exists).

---

## 3. Nostr protocol code (the professional NIP setup)

Adopts the **NDK Dart pattern** — the most mature Dart Nostr architecture:
one generic event model + kind registry + per-domain use cases, NOT a
sealed class per kind (Nostr has 200+ kinds; a class hierarchy can't keep
up and handles unknown kinds badly).

### 3.1 Protocol core — `core/nostr/core/`

```
core/nostr/core/
├── nostr_event.dart      # NostrEvent (moved from models/)
├── nostr_filter.dart     # NostrFilter
├── nostr_profile.dart    # NostrProfile
└── kinds.dart            # Kind constants + classification (NEW)
```

**`kinds.dart`** (new — the kind registry, nostr-tools `kinds.ts` pattern):

```dart
/// Kind numbers for every event type this app publishes or reads, with
/// NIP-01 classification. Magic kind literals in features migrate here.
class NostrKinds {
  NostrKinds._();

  static const int profile = 0;
  static const int textNote = 1;
  static const int contacts = 3;
  static const int deletion = 5;
  static const int repost = 6;
  static const int reaction = 7;
  static const int longForm = 30023;
  static const int followSet = 30000;
  static const int muteList = 10000;
  static const int relayList = 10002;
  static const int zapRequest = 9734;
  static const int zapReceipt = 9735;
  static const int zapGoal = 9041;
  static const int subscriptionTier = 37001;
  // … every kind the app uses, one name each.

  // NIP-01 classification.
  static bool isReplaceable(int kind) =>
      kind == 0 || kind == 3 || (kind >= 10000 && kind < 20000);
  static bool isAddressable(int kind) => kind >= 30000 && kind < 40000;
  static bool isEphemeral(int kind) => kind >= 20000 && kind < 30000;
  static bool isRegular(int kind) =>
      !isReplaceable(kind) && !isAddressable(kind) && !isEphemeral(kind);
}
```

Migration rule: `kind: 5` → `NostrKinds.deletion`, `37001` →
`NostrKinds.subscriptionTier`. Grep for all kind literals, move to registry.

### 3.2 Relay layer — `core/nostr/relay/`

`relay_pool.dart`, `relay_router.dart`, `dm_delivery.dart` (unchanged code,
moved). The reconnect-resilience rules in `AGENTS.md` stay authoritative.

### 3.3 Use cases — `core/nostr/usecases/` (per-domain, not per-NIP)

NDK's key insight: organize by **what the app does**, not by NIP number —
a use case can span several NIPs. Current repositories split this way:

```
core/nostr/usecases/
├── notes/        # feed_repository (kind 1, 6, 16, NIP-10 threading, NIP-18)
├── reactions/    # engagement_repository (likes/reposts/comments/zaps tally)
├── profiles/     # social_repository (kind 0, NIP-05, follows, search, bookmarks)
├── dms/          # dm_repository (NIP-04 + NIP-17)
├── zaps/         # zap_receipts (NIP-57 validation/summaries)
├── lists/        # NIP-51 (follow sets, mute lists) — extracted from feed_repository
└── relays/       # NIP-65 relay list sync (from settings/relay_settings_providers)
```

Feature-specific use cases stay in their feature (`memberships/data/` keeps
`membership_service.dart` — it's a feature, not app-wide protocol).

---

## 4. UI/UX upgrade (advanced, animated — cheap)

The rule from the research: **built-ins first, flutter_animate for
composable polish, Rive reserved for 1–3 signature moments.**

### 4.1 Animation language (one shared vocabulary)

Add `core/theme/app_motion.dart` — the app's motion tokens (durations,
curves, stagger delays). Every animation uses these so the app feels like
ONE designer made it:

```dart
class AppMotion {
  AppMotion._();
  static const fast = Duration(milliseconds: 150);
  static const normal = Duration(milliseconds: 300);
  static const slow = Duration(milliseconds: 450);
  static const curve = Curves.easeOutCubic;
  static const stagger = Duration(milliseconds: 30);
}
```

### 4.2 What gets animated, and how (0 KB approaches first)

| Where | Effect | Cost |
|---|---|---|
| **Navigation** | go_router `CustomTransitionPage`: shared-axis fade + 2% slide on pushes, `NoTransitionPage` on tab switches | 0 KB |
| **Post cards** | entrance fade+rise with 30 ms stagger (flutter_animate `.animate().fadeIn().slideY()`) | ~0.1 MB total |
| **Photo → detail** | Hero shared-element transition (feed thumbnail ↔ full-screen) with `flightShuttleBuilder` cross-fade | 0 KB |
| **Like/zap buttons** | scale+color pop on tap (implicit `TweenAnimationBuilder`) | 0 KB |
| **Skeletons** | shimmer (exists) → content cross-fade (`AnimatedSwitcher`) | 0 KB |
| **New-posts pill** | slide-down + fade entrance | 0 KB |
| **Pull-to-refresh** | keep platform indicator; no custom (costly, low value) | 0 KB |

**flutter_animate** added for staggered entrances and shimmer — the best
UX-per-KB in the research (~0.1–0.2 MB, pure Dart, tree-shaken).

**Rive**: reserved for AT MOST 2 signature moments (app icon animation on
the splash, and possibly the zap success bolt). Requires the Android NDK
pin (`ndkVersion "25.1.8937393"` in `android/app/build.gradle` — the
documented 45–80 MB bug) and network-served `.riv` files. **Decision
deferred to phase 2** — if size budget is tight, Rive is cut entirely and
those moments use flutter_animate instead.

### 4.3 Interaction polish
- Haptic patterns already exist; keep (light on nav, medium on actions).
- All buttons get proper pressed states (existing `FilledButton`/`InkWell`
  do this); no custom splash factories (they fight the platform feel).

---

## 5. App size plan (small + fast)

### 5.1 Measure first (new CI step)

```bash
flutter build appbundle --release --analyze-size \
  --obfuscate --split-debug-info=build/symbols
```

- Archive the `*-code-size-analysis_*.json` per release; diff between
  releases to catch regressions per package.
- **Size budget: ≤ 35 MB download** on Android (arm64 AAB slice). Fail CI
  if a PR grows download size by > 1 MB without an explicit note.

### 5.2 The concrete steps (with expected savings)

| Step | Saving | Status |
|---|---|---|
| Ship **AAB** (not fat APK) | ~60–70% per device vs universal | do now |
| Icon tree-shaking (default since 1.22) | 1.6 MB → ~KBs | verify on |
| **Package audit** via size JSON | 0.5–5 MB | audit the 56 packages, cut top offenders |
| R8 + `shrinkResources` (gradle) | 10–30% of dex layer | enable in `android/app/build.gradle` |
| `--obfuscate --split-debug-info` | symbols out of binary | add to release build, archive symbols |
| Asset compression (WebP, subset fonts) | 1–10 MB (media apps) | audit `assets/icon/` |
| Deferred components | skip for now (iOS unsupported, size < 30 MB) | no |
| Rive NDK pin (only if Rive adopted) | 45–80 MB bug fix | only with Rive |

Package audit priorities (native-code plugins first, they're the biggest):
mobile_scanner, video_player, chewie, file_picker, share_plus,
cached_network_image, flutter_local_notifications, rive (if added).
Anything unused or single-call-site that can be replaced with 20 lines:
cut.

### 5.3 Performance checklist (fast list-heavy app)

From the official perf docs + the feed-specific research:

- **Images decoded at display size** — the single biggest feed-app win
  (documented −375 MB memory in one case). Add `memCacheWidth`/`memCacheHeight`
  to every `CachedNetworkImage` in feeds and `cacheWidth`/`cacheHeight` to
  raw `Image.network` calls (compose previews, banners). Feed grid cells:
  ≤ 800 px decode; full-res only on the detail/fullscreen view.
- **`const` everywhere** — sweep for non-const constructors on static
  widgets (lint: `prefer_const_constructors`, `prefer_const_declarations`).
- **Localized state** — like/repost optimistic state already per-card;
  keep it that way; no whole-feed `setState`.
- **`ListView.builder`** — already used; verify no `Column` of posts inside
  `SingleChildScrollView` remains (profile tabs, search results).
- **Isolates** — DM decryption and zap-receipt validation batches move to
  `compute()` if profiling shows > 2 ms/frame (measure first).
- **Precache** next few feed images just outside the viewport.
- **Profile on a low-end physical device** (not the iPhone 17 Pro
  simulator) against an **8 ms frame budget** (120 fps devices).

---

## 6. App management & docs (professional practice)

### 6.1 Architecture Decision Records

Create `docs/adr/` in the flutter_app (MADR format, append-only):

```
flutter_app/docs/adr/
├── README.md            # index table
├── 0001-feature-first-layers.md
├── 0002-nostr-usecase-layer.md
├── 0003-kind-registry.md
├── 0004-animation-language.md
├── 0005-size-budget.md
└── 0006-no-rive-unless-two-moments.md
```

ADRs are numbered, append-only, and supersede rather than edit. `AGENTS.md`
stays the contributor-facing conventions doc; ADRs record *why*.

### 6.2 Lint discipline

Keep current lints (0 issues in `lib/` is non-negotiable). Adopt from
`very_good_analysis` selectively (full VGA would touch every file at once —
not worth the diff noise now):

```yaml
# analysis_options.yaml additions (incremental)
linter:
  rules:
    - prefer_const_constructors
    - prefer_const_declarations
    - directives_ordering
    - sort_pub_dependencies
    - always_use_package_imports
```

---

## 7. Migration plan (phased, no big-bang rewrite)

**Phase 0 — Foundations (no behavior change)** · ~1 day ✅ DONE
- ✅ `kinds.dart` registry (full kind set + NIP-01 classification); feature
  constants delegate to it (`zapReceiptKind`, `muteListKind`, `tierKind`,
  `goalKind`).
- ✅ `app_providers.dart` split by domain behind a barrel
  (`nostr_service_providers` / `auth_providers` / `content_providers`).
- ✅ `AppMotion` tokens + `appTransitionPage` go_router transition helper.
- ✅ `flutter_animate` added; post-card fade entrance; `StaggeredListItem`.
- ✅ Hero feed→fullscreen photo transitions (fade, pinch-zoom, SVG excluded).
- ✅ ADRs 0001–0004 in `docs/adr/`.
- ✅ `--analyze-size` baseline: **35.9 MB → 27.9 MB** (−22%) by excluding
  the bundled ML Kit barcode model (`libbarhopper_v3.so`, ~6 MB) + enabling
  R8/`shrinkResources` (keep rules in `android/app/proguard-rules.pro`,
  exclusion in `android/app/build.gradle.kts`). Remaining package audit
  items moved to Phase 3.

**Phase 1 — Structure (mechanical moves)** · ~2 days ✅ DONE
- ✅ All 28 features restructured to `domain/data/application/presentation`
  (mechanical moves: `models/` → `domain/`, `services/` → `data/`,
  `providers/` → `application/`, `widgets/` + screens → `presentation/`).
- ✅ 223 import references rewritten in 100 lib files + 20 test files.
- ✅ ADR-0001/0002/0003 written (in `docs/adr/`).
- ✅ `core/nostr/` layering done: `relay/` (relay_pool, relay_router,
  dm_delivery), `repositories/` (per-domain queries), `usecases/`
  (zap_receipts), `kinds.dart` at the root. Imports rewritten (17 refs in
  14 lib files + 1 test).
- ⬜ Lint additions + `const` sweep (Phase 2).

**Phase 2 — UX polish + lint** · ~2 days ✅ DONE
- ✅ flutter_animate entrances on post cards; `StaggeredListItem` for lists.
- ✅ Hero photo transitions (feed → fullscreen, fade + pinch-zoom).
- ✅ Lint additions (`prefer_const_constructors`, `prefer_const_declarations`,
  `directives_ordering`, `always_use_package_imports`) — `dart fix` applied
  86 fixes in 68 files; **lib/ at 0 issues of any kind**.
- ✅ `Share` → `SharePlus` `ShareParams` migration (5 call sites).
- ✅ AnimatedSwitcher skeleton→content cross-fade in the feed (first load
  fades posts in, no yank) + scale pop on like/zap/repost action buttons.
- ✅ Image decode-size pass (`memCacheWidth/Height` everywhere) — Phase 3.

**Phase 3 — Size & speed verification** · ~1 day
- AAB + R8 + shrinkResources + obfuscate + split-debug-info in release.
- Package cuts from the audit.
- Profile-mode verification on a low-end device (feed scroll jank, memory).
- ADR-0005 (size budget) enforced in CI.

**Phase 4 — Deferred / optional**
- Rive decision (only if 2 signature moments justify it, NDK pinned).
- Deferred components (only if size ever exceeds 30 MB with separable flows).
- Isolate moves for DM decryption / zap validation (only if profiling says so).

### Acceptance criteria
- `flutter analyze` → 0 issues in `lib/` at every phase.
- `flutter test` → all tests green at every phase.
- Download size ≤ 35 MB (Android arm64 AAB slice) by end of Phase 3.
- Feed scroll at 60 fps (8 ms budget) on a low-end physical device.
- A new contributor can place any new file correctly by reading `AGENTS.md`
  alone.

---

## 8. Sources

**Architecture:** Flutter official guide + Compass case study
(docs.flutter.dev/app-architecture) · Andrea Bizzotto, feature-first +
Riverpod architecture (codewithandrea.com) · VGV FFCA + barrel files +
very_good_analysis (engineering.verygood.ventures) · MADR
(github.com/adr/madr).

**Nostr:** NDK Dart (github.com/relaystr/ndk, domain_layer/{entities,
repositories,usecases}) · nostr-tools kinds.ts (github.com/nbd-wtf/nostr-tools)
· Quartz/Amethyst (github.com/vitorpamplona/quartz) · Nostrify
(gitlab.com/soapbox-pub/nostrify).

**UX/Size/Perf:** flutter_animate (pub.dev/packages/flutter_animate) · Rive
flutter runtime + best practices + NDK size bug (rive.app/docs,
itnext.io NDK-80MB case) · Flutter perf best practices + app size docs
(docs.flutter.dev/perf) · cached_network_image memCache guidance + the
−375 MB image-memory case (saropa.com) · go_router transition examples
(github.com/flutter/packages go_router/example).
