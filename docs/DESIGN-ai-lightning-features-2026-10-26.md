# Design — AI + Lightning as Top Features

**Date:** 2026-10-26 · **Scope:** AI presence in the feed, Lightning/paid prominence, screen design.

## AI as a top feature — the feed entry bar

The AI was buried (drawer + a tiny ✨ chip). It's now a **native feature entry
point at the top of the For You feed** — like WhatsApp's Meta AI bar or X's
Grok button, **NOT a promo card** (the AGENTS.md rule against ad-style
in-feed cards is honored: the old `_AiPromoCard` read as an ad; this is the
app's own search-bar-shaped input).

- **`AiFeedBar`** (`features/feed/presentation/widgets/ai_feed_bar.dart`) —
  pinned at row 0 of the For You tab only (never mid-feed, never in
  Following): a quiet pill "✨ Ask Nova AI anything…" with an accent hairline
  border + 3 rotating **suggestion chips** ("Summarize my feed", "What's
  trending today", "Explain a post to me").
- **Chips prefill the composer** — tapping one pushes `/ai` with
  `extra: {'prompt': …}` → `AiChatScreen(initialPrompt:)` drops the text into
  the input so the user just taps send (the prompt is *context-aware* — the
  AI reads your actual feed/relays via `AiContextService`, the
  differentiator).
- **AI "Summarize thread"** — a ✨ AppBar action on the thread screen
  (`aiAvailableProvider`-gated) prefills "Summarize this thread…:
  nostr:note1\<root\>" — `AiContextService._fetchThread` already pulls the
  whole conversation (root + up to 25 replies) from the user's relays, so
  the digest is real, not hallucinated.

## Lightning / paid as top features

Already prominent (this audit's earlier work); the visible pieces:

| Piece | Where | What |
|---|---|---|
| **Side shortcut** | home feed, left-center edge | quiet hairline tab → `/support` (dismissible ×) |
| **Support page** | `/support` + /you row | Lightning card (`kk@getzap.me`) + zap-style amount picker + on-chain QR addresses |
| **Zap burst** | post action row | activation ring + bolt flash on a paid zap |
| **Earnings** | /you quick stats + Studio hero | validated NIP-57 sats (display-type hero, count-up) |
| **Paid relay** | premium flow + auto-connect | paid↔paid DM lane, NIP-42 |

## Screen-design rules used

- **AI/Lightning entries are FEATURES, not ads** — a search-bar input (AI) or
  a quiet edge tab (support), never an injected promo card mid-feed.
- Suggestion chips teach capability with one tap (context-aware prompts),
  which converts better than a banner.
