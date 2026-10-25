# NostrFeed — Design

Three documents. **Read `refined.html` — that's the direction.**

| File | Role |
|---|---|
| **[`refined.html`](refined.html)** — ✂️ **THE DIRECTION (v2.1)** | Content-first. Small 13.5px reading type, hairline dividers, one restrained accent, a 40-icon SVG set. **All 34 screens across every feature.** Quiet UI so the posts are the loudest thing on screen. Cheapest to build. |

### Refined — complete screen inventory (34)

| # | Group | Screens |
|---|---|---|
| 01 | Principles | 4 rules + 40-icon SVG system |
| 03 | Feed | Home (reading feed) · Feed states (poll/CW/repost/quote) · Thread |
| 04 | Chat & money | Messages · Thread bubbles · Wallet · Zap sheet |
| 05 | Identity & discovery | Profile · Activity · Explore · Search · Compose · Create sheet · Reels |
| 06 | Long-form & communities | Articles · Article reader · Communities · Live · Calendar · Lists & Bookmarks · AI Assistant |
| 07 | Money features | Memberships · Studio · Market · P2P · Earn (Drops+Bounties) · Premium · Send · Boost |
| 08 | System | Login · Identity · Settings · You · Docs |
| [`nova.html`](nova.html) — 🌌 the loud dream | The maximal exploration (aurora, glass, hero media, springs). Kept for reference — a few ideas salvaged (Explore tab, wallet rails, zap cards), the rest deliberately tamed. |
| [`index.html`](index.html) — 📐 v1.3 reference | Where we ARE. Current tokens/components/screens mirrored 1:1 with `lib/core/theme/`. |

## Refined in one paragraph

NOVA was too loud. Refined goes the other way: **13.5px body text** with a 1.5
line-height so posts are genuinely readable; **hairline 1px dividers** instead
of shadows and glass; **one accent** (`#2F6BFF`) that only marks interactivity;
**muted amber** (`#E8860B`) for zaps instead of neon orange; and a **real SVG
icon system** (24-viewBox, 1.75px stroke, ~40 icons) replacing the emoji +
Material mix. Emoji survive ONLY in the zap preset grid, where they're cultural
shorthand for amounts. The UI whispers so content speaks.

## Why Refined over NOVA

- **Readability** — a social app is text-first; NOVA's hero media competed with
  the words. Refined constrains media to tasteful 16:9 tiles.
- **Consistency** — one icon family at one stroke weight is the #1 "feels
  designed vs assembled" signal.
- **Cost** — Refined is a new theme pair + an `AppIcon` widget + PostCard
  padding/typography tweaks. No layout surgery. Ships in days, screen-by-screen,
  through the existing token system.

## What survives from NOVA into Refined

Explore as a **tab** (kills the 20-item drawer) · wallet **quick-rails** for the
money features (Earn/Creator/Trade) · zap receipts as **value cards** in chat ·
⌘K as a simple search-first palette (low priority). Everything else — gradients,
glass, hero media, glow, spring-personality — was cut.

## ✅ IMPLEMENTATION STATUS — COMPLETE (v2.1 shipped)

The Refined design is **100% implemented** in the Flutter app (`lib/`):

| Layer | Status |
|---|---|
| Theme — `#2F6BFF`/`#6B96FF` accent, neutral de-blued surfaces, muted zap/like/repost/bookmark palette | ✅ shipped |
| AppIcon — 50-icon stroke SVG set + `AppIconSize` tokens; ~470 Material→AppIcon conversions | ✅ shipped |
| Bottom nav — flat hairline bar, top accent tick, outlined Create capsule | ✅ shipped |
| Nav tabs — **Home · Explore · Create · Chat · Wallet** (Explore is tab 2, Reels out of the bar) | ✅ shipped |
| PostCard — 13.5px reading type, stroke action icons | ✅ shipped |
| Create sheet — Ask AI + Post lead, 4-icon grid | ✅ shipped |
| "You" surface (`/you`) — profile hub behind the avatar | ✅ shipped |
| Wallet quick-rails — Earn / Creator / Trade horizontal nav cards | ✅ shipped |
| ⌘K command palette — long-press Create, universal launcher | ✅ shipped |

Verified: **604/604 tests** · **0 `flutter analyze lib` errors** · token guard
below baseline (Colors **200**, TextStyle **190**, BorderRadius **104**) ·
hot restart clean · **zero `LinearGradient` in `lib/features`** (gradient
discipline: logo mark only). Emoji survive ONLY in the zap preset grid
(cultural shorthand) and as user content — never as UI icons.

**Every screen is on the Refined system** — the one-by-one pass (Home,
Explore, Chat, Wallet, Profile) plus a 5-subagent parallel sweep completed
all remaining screens (notifications, articles, communities, groups, live,
settings, identity, login, docs, premium, studio, memberships, market, p2p,
bounties, sats-drops, lists, calendar, bookmarks, search, compose, reels,
ai-chat). Bare `icon: Icons.x` IconData-params (EmptyState/ErrorView/menus)
intentionally stay Material.

## Token handoff (all three docs obey the same rule)

Figma variables and CSS vars mirror `lib/core/theme/` 1:1. Change a token in
code → change it here; never a one-off value in a screen. `tool/token_guard.sh`
enforces it in `lib/features/`; these files are the visual half of the contract.
