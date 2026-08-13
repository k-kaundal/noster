# NostrFeed — Premium Dark Social

The locked visual direction, and the rules that follow from it. This
supersedes the design sections of `BRANDING_GUIDE.md`,
`UI_OVERHAUL_GUIDE.md` and `PROFESSIONAL_UI_INTEGRATION.md`, which were
written at different times and disagree with each other.

> **Premium, calm, fast, content-first.**
> Social feed: minimal. Articles: editorial. Wallet: fintech. Creator: SaaS.
> Lightning: subtle amber. Brand: violet.

One identity, four registers. Not four design systems — the tokens, spacing
and type are shared, and what changes between surfaces is *density and
emphasis*, because a timeline, a balance, an essay and a dashboard are read in
four different ways.

## What is already true

Most of this direction is in the code. Worth knowing before changing anything:

| Decision | Token | Value |
| --- | --- | --- |
| Brand accent | `--primary` | `262 83% 58%` — violet |
| Lightning | `--zap` | `38 92% 50%` — amber |
| Corner radius | `--radius` | `0.75rem` |
| Recessed page behind cards | `--surface` | set in both themes |
| Text on *tinted* backgrounds | `--success-strong`, `--warning-strong` | separate from `-foreground` |

That last pair is the kind of detail worth keeping: `-foreground` is for a
solid fill, `-strong` is for an 8% tint. Using the first on the second gives
white text on near-white in one theme and black on black in the other, and
each theme hides the fault from whoever is testing the other.

## The four registers

### Feed — minimal, and dominant

The style people see most, so it sets the impression of the whole product.

- Separators, not cards. A timeline of bordered boxes reads as a list of
  adverts.
- Whitespace does the grouping. Avatar, name, time, body, actions — nothing
  else competes.
- No gradient, no shadow, no fill behind a post.
- Action row is quiet until touched: muted foreground, colour on hover only.

### Articles — editorial

- One comfortable measure (~65–75 characters). A full-width essay is not read.
- Title large and unhurried; the byline is small and gets out of the way.
- Body type sized for reading, not for scanning.
- The zap total belongs at the end, where somebody who has just finished is
  actually looking — and again in the header for whoever decides before they
  start.

### Wallet — fintech

The one place cards earn their keep, because a balance and a list of
transactions are discrete objects rather than a stream.

- Balance is the largest number on the page, and it is the only large number.
- Amounts are tabular-figure, right-aligned, signed.
- Received is `--success`, spent is muted foreground — never red. Money
  leaving on purpose is not an error.
- Fiat is a reference under a sats figure, never the price itself.

### Creator and business — SaaS dashboard

- Analytical, not celebratory. Numbers with their period attached
  ("this month"), not confetti.
- Charts are small, muted, and never the first thing.

### Boost — advertising UI, not crypto UI

Duration, budget, estimate, one button. It should look like buying promotion
anywhere else, because that is what it is. Nothing about it should look like a
token sale.

## The don't list

Each of these exists in some codebase and none belongs here:

- **Excessive gradients.** There are 19 `bg-gradient-to-*` uses in the app
  today, mostly on card headers and hero panels. A gradient is for one hero
  surface per page at most; on a card header it is decoration that costs
  contrast and says nothing.
- **Huge rounded cards everywhere.** `rounded-2xl`/`3xl` is for a hero or a
  media frame, not for every container.
- Glassmorphism, neobrutalism, cyberpunk, neon.
- Crypto-exchange styling: green/red everything, tickers, glow.
- Bitcoin orange as a *brand* colour. Amber is reserved for lightning
  specifically, which is what makes it mean something when it appears.

## Two decisions this direction forces

Both are product calls rather than styling, and neither has been made:

### 1. Fourteen theme presets, or one identity

`src/lib/advanced-themes.ts` ships fourteen presets across six categories,
including `sunset-gradient`, `bitcoin-gold` and `lightning-electric` — which
are precisely the looks the don't list rules out. A product cannot have a
locked visual identity and a menu of fourteen alternatives to it.

The options are to cut the presets to the two that serve this direction
(a light and a dark), keep them as an accessibility feature and accept that
the identity is the default rather than the product, or drop the idea of a
locked identity. Cutting them is destructive and reversible only from git, so
it needs an explicit decision.

### 2. Dark-first, or system-first

The name says dark. The app currently defaults to `theme: "system"`, which
follows the reader's operating system. Those are different products: one has
an opinion, the other defers to the machine. "Premium Dark Social" implies
dark as the shipped default with light available — but defaulting away from a
stated OS preference is a real cost, and it should be chosen rather than
inherited from a name.

## Adding a surface

1. Decide which of the four registers it belongs to. Most things are feed or
   fintech; if it is neither, say why.
2. Use the tokens. A hard-coded colour is a bug in one of the two themes,
   usually the one nobody is looking at.
3. Tint with `/8`–`/15` and pair it with a `-strong` foreground, never a
   `-foreground` one.
4. No gradient unless it is the one hero surface on that page.
