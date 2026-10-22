# ADR-0003: One animation language, cheap approaches first

**Status:** Accepted · **Date:** 2026-10-22

## Context

UI polish was uneven: some screens animate, most don't, navigation used
default transitions, and there was no shared motion vocabulary — so what
animation existed felt like different designers made different screens.

## Decision

1. **`core/theme/app_motion.dart`** — the app's motion tokens (durations,
   curves, stagger). Every animation uses these; the app feels like one
   designer made it.
2. **Cheap approaches first:** built-in Hero + implicit animations +
   go_router `CustomTransitionPage` cost 0 KB and cover most of the polish.
3. **flutter_animate** (~0.1 MB, pure Dart) for composable polish:
   staggered list entrances, fade+rise post cards.
4. **Rive deferred** — only for ≤ 2 signature moments (splash icon, zap
   success), requires the Android NDK pin (the documented 45–80 MB bug) and
   network-served `.riv` files. If the size budget is tight, Rive is cut
   and those moments use flutter_animate instead.

## Consequences

- Every animation is a token (`AppMotion.normal`, `.curve`, `.stagger`),
  not a magic number.
- The whole motion budget is ~0.1 MB.
- `StaggeredListItem` for list rows; `PostCard` has its own one-shot fade
  (an infinite feed can't re-animate on every scroll frame); feed images
  Hero-fly to fullscreen (SVGs excluded — different pipeline).

## Alternatives considered

| Alternative | Rejected because |
|---|---|
| Rive everywhere | 5–8 MB native runtime per ABI; only worth it for designer-owned flagship moments. |
| Hand-written AnimationController for all | 5–10× more code per effect; reserved for gesture-physics only. |
