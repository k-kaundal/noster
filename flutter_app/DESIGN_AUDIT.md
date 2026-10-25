# NostrFeed Flutter — Design Research & UI/UX Audit

> Research date: 2026-10-25 · Scope: all 45 screens, core UI kit, theme system

---

## 1. Research Summary — What "Great" Looks Like (2026)

Based on analysis of leading social apps (X, Primal, Damus, Instagram, Telegram) and
Material 3 / iOS HIG best practices, the current benchmark for social-client UI/UX:

### Design Trends That Matter for a Nostr Client

| Trend | What leaders do | Where we stand |
|---|---|---|
| **Design tokens everywhere** | Zero hardcoded colors/radii/fontSizes in feature code | ⚠️ Tokens exist (`AppSpacing`, `AppShapes`, `AppMotion`, full `ColorScheme`) but **NOT enforced** — 522 raw `TextStyle(`, 437 raw `fontSize:`, 109 `Colors.white`, 34 `Colors.green`, 273 raw `BorderRadius.circular` in features |
| **Semantic action colors** | Zap/like/repost/bookmark colors from one palette | ⚠️ `AppActionColors` exists but notifications, profile, identity bypass it with `Colors.amber.shade700`, `Colors.red.shade400`, etc. |
| **Component kit** | Shared `AppButton`, `AppCard`, `AppBadge`, `AppText` | ❌ Missing — no shared button/card/badge/text components; only theme-level overrides |
| **Consistent state handling** | Every screen: skeleton → content / error (ErrorView) / empty (EmptyState) | ⚠️ Good on 6 core screens; market/groups/live use raw `Text('Failed…')`; sats_drops has no real data at all |
| **Screen size discipline** | Screens < ~400 lines; widgets extracted at ~100 lines | ❌ profile (1449), wallet (1365), identity (1214), lnbits (1176), articles (1158), chat (1102) |
| **Accessibility (WCAG AA)** | ≥4.5:1 text contrast, ≥48dp tap targets | ✅ Theme colors are AA-tuned (light-mode like/repost were darkened for contrast) |
| **Motion system** | Tokenized durations/curves, staggered entrances | ✅ Excellent — `AppMotion` 100% adopted (ADR-0003) |
| **Adaptive layouts** | Breakpoints for tablet/foldables | ❌ None — no breakpoint tokens, drawer width hardcoded at 320 |

### What the Best Nostr Clients Do (Primal, Damus)

- **Primal**: sliding-pill bottom nav ✅ (we have it), signature zap-orange ✅, thread connector lines ✅, compact 140dp profile banners ✅ (we match)
- **Damus**: iOS-native feel, minimal chrome, content-first
- **X**: dense feeds (tight line-heights ✅ we tuned this), inline video, gesture-driven actions
- **Telegram**: pinned saved-messages row in chat list ✅ (our AI tile), swipe-to-reply ✅, grouped bubbles ✅

**Verdict**: our *design language* is already competitive (Primal-inspired, well-tuned). The gap is in *consistency of execution* — tokens not enforced, missing component kit, uneven screen quality.

---

## 2. Audit Findings (Data-Backed)

### 🔴 Critical

1. **Token violations at scale** — 522 raw `TextStyle`, 437 raw `fontSize`, 273 raw `BorderRadius.circular`, ~280 hardcoded `Colors.*` in feature code. The design system exists but is advisory, not enforced.
2. **`Colors.white` ×109** — many should be `colorScheme.onPrimary` / `onSurface` (breaks in edge cases, signals ad-hoc styling).
3. **Wallet balance card** uses hardcoded `Colors.blue.shade700 → Colors.purple.shade600` gradient (off-brand — brand gradient is `#0A66C2 → #3D9BE9`).
4. **SatsDropsScreen is a non-functional mockup** — hardcoded sample data, dead buttons.
5. **Wrong toasts for failures** — `compose_screen.dart:229` shows `AppToast.success` for an upload failure; `thread_screen.dart:81` shows success for a login prompt.

### 🟡 High

6. **6 giant screen files** (1100–1450 lines) — wallet duplicates its Lightning-address + connections card across two tabs; profile inlines 6 private widget trees.
7. **Inconsistent status colors** — live badges (`Colors.red/blue/grey`), P2P buy/sell (`Colors.green/orange.shade700`), identity (green/red/amber/orange everywhere) instead of `AppStatusColors`.
8. **Radius chaos** — 13 distinct raw radius values; 10/14/22/24 have no `AppShapes` equivalent → either extend the scale or normalize to it.
9. **Error-state drift** — market, groups, live, chat-thread, wallet-activity render raw `Text('Failed…')` instead of `ErrorView`.
10. **Padding inconsistency** — chat uses 20dp horizontal, most screens 16dp; feed FAB has a fragile manual `bottom: 90` offset.

### 🟢 Medium

11. **Missing component kit** — no `AppButton` (primary/secondary/destructive), `AppCard`, `AppBadge` (badge styles duplicated inline in nav + bell), `AppText`.
12. **Refresh-pattern drift** — `ref.invalidate` vs `ref.refresh(x.future)` vs notifier calls, used interchangeably.
13. **Bounties screen watches `communitiesProvider`** (wrong data source); filter chips don't filter.
14. **Reels screen unmigrated** — hardcoded `Colors.black`/`Colors.white24` throughout.
15. **Two "brand gradients"** — `AppTheme.brandGradient` (static) vs ad-hoc `primary → tertiary` computed in nav/drawer/wallet.

---

## 3. Recommended Plan (Phased, Minimal-Intrusion)

### Phase 0 — Guardrails (½ day)
- Add lint rules to **stop the bleeding**: ban `Colors.` (except in theme/), raw `TextStyle(fontSize:)`, `BorderRadius.circular` in `lib/features/` via `analysis_options.yaml` custom lints or a simple grep CI check.
- Fix the 3 wrong-toast bugs (compose, thread) — user-facing correctness.

### Phase 1 — Component Kit (1–2 days)
Create in `core/widgets/`:
- `app_button.dart` — `AppButton.primary/secondary/destructive/ghost` (wraps FilledButton/Tonal/Text with `AppShapes.md` + loading state)
- `app_card.dart` — `AppCard` (surfaceContainerLowest, radiusLg, paddingMd, optional onTap ink)
- `app_badge.dart` — `AppBadge.count` (nav, notification bell, unread)
- `status_badge.dart` — `StatusBadge.live/upcoming/ended/pending/success` driven by `AppStatusColors`
- Migrate: wallet balance card → `brandGradient`; all live/p2p/identity status colors → `AppStatusColors`.

### Phase 2 — Token Sweep, Screen by Screen (ongoing, ~15 min/screen)
Order by traffic: notifications → profile → reels → live → p2p → market → groups → identity → calendar → sats_drops.
Per screen: replace raw Colors/TextStyle/radii with tokens; swap raw error text → `ErrorView`; add `EmptyState` where missing; unify padding to `AppSpacing`.

### Phase 3 — Decompose Giant Screens (1–2 days)
- `wallet_screen.dart` → extract `BalanceCard`, `WalletListTile`, `ActivityTab`, `WalletSettingsTab` (kills the duplicated settings card)
- `profile_screen.dart` → extract `ProfileHeader`, `ProfileStats`, `ProfileTabBar`, tab bodies (already partially private widgets — promote to files)
- `chat_screen.dart` → split conversation list vs thread into own files
- `identity_screen.dart` → extract sections + migrate colors (worst offender)

### Phase 4 — Broken Features (as prioritized)
- SatsDrops: build real provider + wire Create/Share, or hide behind a flag
- Bounties: point at a real bounties provider; make filter chips work
- P2P: implement the no-op `onRefresh`

### Phase 5 — Adaptive (later)
- Add breakpoint tokens (compact <600 / medium <840 / expanded); tablet two-pane for chat & settings; navigation rail on wide screens.

---

## 4. Success Metrics

| Metric | Now | Target |
|---|---|---|
| Raw `TextStyle(` in features | 522 | 0 |
| Raw `fontSize:` in features | 437 | 0 |
| Raw `Colors.` in features | ~280 | 0 |
| Raw `BorderRadius.circular` in features | 273 | 0 |
| Screens > 600 lines | 6 | 0 |
| Screens with raw-text error states | 5 | 0 |
| `flutter analyze` issues | 0 (keep) | 0 |
