# ADR-0004: App size budget + measurement

**Status:** Accepted · **Date:** 2026-10-22 · **Updated:** first measurement done

## Context

The app has 56 packages and had never been measured with `--analyze-size`.
No release-build checklist, images decode at full resolution in feed grids
(the documented −375 MB memory trap), no size discipline.

**First measurement (2026-10-22):** baseline 35.9 MB → **27.9 MB** (−22%)
by excluding the bundled ML Kit barcode model (`libbarhopper_v3.so`, ~6 MB
across ABIs — mobile_scanner's Play-Services backend covers scanning) and
enabling R8 + `shrinkResources`.

## Decision

1. **Budget: ≤ 35 MB download** on Android (arm64 AAB slice). **Currently
   27.9 MB.** Fail CI if a PR grows download size by > 1 MB without a note.
   Keep rules live in `android/app/proguard-rules.pro`; the barcode-model
   exclusion in `android/app/build.gradle.kts` (`packaging.jniLibs.excludes`
   + `configurations.all { exclude(barcode-scanning) }`).

2. **Package audit (2026-10-22, complete):** all 56 packages are in use;
   the top native-cost plugins (mobile_scanner, video_player, chewie,
   file_picker, share_plus, cached_network_image,
   flutter_local_notifications) are all load-bearing features. Nothing cut.
   Dart AOT breakdown: `package:flutter` 4 MB, app code 2 MB,
   `pointycastle` 857 KB (crypto — zaps/NIP-44, kept).

3. **Image decode-at-display-size (done):** every shared image widget and
   the big feed/profile decodes use `memCacheWidth`/`memCacheHeight`:
   `SmartNetworkImage`, `SafeAvatar`, feed `_NetworkImageTile` (≤1200 px),
   profile banner (200 dp). Full-res decode only on detail/fullscreen
   views. This is the documented −375 MB memory trap avoided.
2. **Measure in CI**: `flutter build appbundle --release --analyze-size
   --obfuscate --split-debug-info=build/symbols`; archive the size JSON per
   release and diff between releases.
3. **Concrete steps** in priority order: AAB (not fat APK), default icon
   tree-shaking, package audit via the size JSON (native plugins first),
   R8 + `shrinkResources`, `--obfuscate --split-debug-info`, asset
   compression (WebP, subset fonts).
4. **Images decoded at display size** everywhere in feeds:
   `memCacheWidth`/`memCacheHeight` on CachedNetworkImage,
   `cacheWidth`/`cacheHeight` on raw Image.network. Full-res only on
   detail/fullscreen views.
5. **Deferred components: no** (iOS unsupported, size < 30 MB target).
   **Rive: only with the NDK pin** (ADR-0003).

## Consequences

- Size is a measured budget, not a hope.
- A PR that adds 2 MB must say why.
- Feed image memory drops by an order of magnitude on fast scrolls.

## Alternatives considered

| Alternative | Rejected because |
|---|---|
| Deferred/dynamic feature modules | iOS doesn't support them; the app is under the budget where they pay off. |
| No budget ("deal with it when it's a problem") | Size regressions are invisible until users abandon downloads. |
