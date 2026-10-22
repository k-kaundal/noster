# NostrFeed — User Experience & Interaction Strategy

**Date**: 2026-10-22 · **Scope**: all features, both apps · **Sources**: live codebase analysis + UX research (2026 mobile playbook, Nostr client comparisons, AI-UX trust patterns, creator-economy engagement data)

---

## 1. What NostrFeed is (and what users actually come for)

NostrFeed has **28 features**. Users don't. They come for **three loops**, and every feature either feeds a loop or gets out of the way:

| Loop | What the user does | Features that feed it | Why it's our moat |
|---|---|---|---|
| **1. Consume & connect** | Scroll feed → watch reels → reply → follow | feed, reels, explore, search, notifications, chat, articles, live | Table stakes — must be *effortless* |
| **2. Zap economy** | See great post → zap ⚡ → creator earns → creator posts more | zaps, wallet, studio, memberships, zap goals, sats drops, bounties, market | **No competitor has this** — Twitter tips died, YouTube takes 30–50%; we take 0% (Lightning direct) |
| **3. AI utility** | Ask AI → summarize → translate → create | ai chat, (future: copilot, digest) | First Nostr client with built-in, sats-priced AI |

**Strategy rule #1**: Loop 1 keeps users daily, Loop 2 keeps creators (and creators bring users), Loop 3 is the differentiator that gets people to *try* us. Marketing leads with Loop 2+3, product must nail Loop 1.

---

## 2. Feature impact tiers (what to polish first)

| Tier | Features | Rule |
|---|---|---|
| **S — daily drivers** | Feed, Post cards + composer, Zaps, Notifications, Wallet balance, AI chat | Pixel-perfect. Zero-friction. These ARE the app. |
| **A — retention hooks** | Reels, Chat/DMs, Profile, Search/Explore, Articles | Solid and discoverable; second session depends on these. |
| **B — depth** | Communities, Groups, Live, Bookmarks, Lists, Calendar, Studio, Memberships | Power-user features; don't clutter primary UI for them. |
| **C — background** | Identity, Premium, Settings, Docs, P2P, Market, Bounties, Sats drops | Work quietly; surface contextually (drawer, profile, wallet). |

Current state check (from code): S-tier is ~85% there — the biggest gaps are **zap friction** (sheet has too many steps), **AI discoverability** (drawer-only entry), and **first-run emptiness** (new user → quiet feed).

---

## 3. What the research says (applied to us)

### 3.1 The 60-second rule (biggest retention lever, ~2× D7)
New users must hit real value in under a minute. Our risks: key-generation confusion, empty feed, no follows.
→ **Fixes in §5.1.**

### 3.2 Thumb zone + 3-tap rule
Primary actions bottom-center; anything >3 taps away is hidden.
→ Zap is currently: tap ⚡ → sheet → pick preset → (maybe) comment → confirm → pay = **4–5 interactions**. Target: **2**.

### 3.3 Variable rewards (why TikTok works)
Fresh-content uncertainty is the hook. Our "N new posts" pill + live DM banner already do this — keep them, never auto-insert posts (scroll yank kills trust).

### 3.4 Micropayment mental cost (Szabo's law)
Every payment decision has a cognitive price. If users must *think* about sats, they won't spend them.
→ **Presets, one-tap defaults, no confirmation dialogs for ≤ 100 sats.** Save decisions for big spends.

### 3.5 AI trust patterns (2026 consensus)
AI must be **inline, opt-in, reversible, labeled, honestly priced**. Never pushed into every empty state. Our AI design (per-message sats price, model picker, privacy banner, streaming, stop button) already matches — the gap is *contextual entry points* (AI where the content is, not only in its own screen).

### 3.6 Nostr client landscape
- **Primal** wins beginners: built-in wallet, dead-simple zap button, clean media.
- **Damus** wins iOS purists: fast, native feel, zap culture.
- **Amethyst** wins Android power users: everything, everywhere.
- **Our lane**: Primal's simplicity + an economy (studio/memberships/goals) and AI neither has. **We must not out-feature Amethyst — we must out-*flow* Primal.**

---

## 4. The interaction model (how we engage users without dark patterns)

NostrFeed's values = no engagement-bait, no algorithmic addiction engineering. But retention mechanics aligned with user benefit are fair game:

| Mechanic | How we use it | Guardrail |
|---|---|---|
| **New-posts pill** | "N new posts" — user pulls when ready | Never auto-insert (already correct) |
| **Zap receipts as social proof** | "⚡ 2.1k sats" on posts = visible gratitude economy | Real receipts only (already validated) |
| **Notification center** | Likes, reposts, zaps, replies, follows in one live stream | No promotional pushes, ever |
| **Daily AI trial** | 5 free AI messages/day = a daily reason to open | Honest counter, no fake scarcity |
| **Creator earnings** | Studio shows real sats earned daily | Real zap receipts, no vanity metrics |
| **Streaks?** | ❌ Not now — streaks serve the app, not the user | Revisit only if users ask |
| **Push notifications** | DMs + zaps + mentions only | User-controlled per type |

---

## 5. Surface-by-surface UI plan

### 5.1 Feed (the first 60 seconds decide everything)
**Today**: For You / Following tabs, offline cache, new-posts pill, media-rich cards. Good bones.

**Moves**:
1. **Cold-start content guarantee**: new users land on an *already-filled* For You feed (cache warm from trending relay fetch at splash). Never an empty first screen.
2. **Follow nudge, not wall**: after ~3 posts, one inline card — "Your feed gets better when you follow people →" (explore). Dismissable, once per session.
3. **Composer affordance**: persistent, thumb-zone ✏️ (already center-bottom create — good); add "What's happening on Nostr?" hint text rotation.
4. **Card actions in one row, thumb-reachable**: like · comment · repost · **zap ⚡** · bookmark · share (exists) — make zap the visually *warm* one (amber ⚡), it's our signature.

### 5.2 Posts & composer
1. **AI in the composer** (Phase 2, high impact): ✨ button → Improve / Shorten / Hashtags / Translate — 1-tap, labeled "AI", price shown (1–3⚡), result editable before insert (reversible = trust).
2. **Post-level AI actions** (long-press or ⋯ menu): Summarize thread · Translate · Explain — answers appear as an in-context card, not a navigation away.
3. **Draft autosave** (if missing) — losing a long post is a top churn moment.

### 5.3 Zaps — the money loop (highest-leverage UX in the app)
**Current**: presets 21/100/500/1k/5k/10k, custom, comment, multi-wallet cascade. Solid but heavy.

**Moves**:
1. **One-tap zap**: double-tap the ⚡ icon (or long-press) = instant default zap (user-set, default 21 sats) with haptic + flying-⚡ micro-animation. No sheet for ≤ 100 sats when a wallet is connected.
2. **Sheet simplification**: presets stay; move comment behind "Add a message"; show *"to @alice"* prominently (people tip people, not posts).
3. **Zap feedback loop**: after zapping, show the creator's zap goal progress if one exists ("You pushed 'New Mic' to 60% 🎙️") — completion emotion drives repeat zaps.
4. **Received-zap delight**: notification + wallet screen entry with confetti-⚡ for first zap of the day (creators become earners become promoters).

### 5.4 AI — discoverability without intrusion
**Current**: drawer entry + /ai route. Too hidden for a differentiator.

**Moves**:
1. **Search screen AI bar**: top of Explore — "Ask NostrFeed AI ✨" — the #1 place users already go with intent. (Cheap, huge.)
2. **Contextual AI entries** (Phase 2): composer ✨, long-press post → AI actions, article TL;DR chip. AI meets the content where it lives.
3. **Pricing honesty**: keep per-model ~N⚡ chips (done) + "5 free left today" (done). Never hide that Basic exists — trust compounds.
4. **Suggested first prompts** on the empty chat: 3 tappable chips ("Summarize #bitcoin today", "Draft a post about…", "Translate this text…") — empty states should teach.
5. **AI Daily Digest** (Phase 3): morning "Your Nostr day in 60 seconds" — a *pull* notification users opt into; becomes the daily habit anchor.

### 5.5 Wallet
1. **Balance first, everything else second** (already the hub card — good).
2. **AI credits row** next to wallets (planned) — credits are money too; show them together.
3. **Recent activity as stories**: "You zapped @bob 100⚡ · @alice zapped you 500⚡" — money in a social app is *social*, present it that way.

### 5.6 Profile & identity
1. **The ✓ + ⚡ combo**: verified name + "zap me" affordance on every profile — identity that earns.
2. **Creator dashboard teaser**: non-premium users see "Creators earned X sats today on NostrFeed" on the Studio gate — aspiration converts.

### 5.7 Notifications
1. **Priority sorting**: zaps + replies first, likes batched ("23 people liked"), follows last. Value-ordered, not just time-ordered.
2. **Tappable through to context** (thread, not just profile).

### 5.8 Onboarding (the 2× D7 lever)
1. **60 seconds to value**: generate keys silently → land on filled For You feed → *then* offer "claim your name" / backup nsec. No slides, no walls.
2. **Key backup as a moment, not a screen**: after first zap received or first post — "Your key is your account — save it now" (context = consequence).
3. **Two personalization taps max**: pick 3 interests → seeds For You. Done.

---

## 6. Prioritized roadmap (impact ÷ effort)

**Quick wins (1–2 weeks)**
1. One-tap zap (≤100 sats, default 21) + haptic/animation
2. AI entry on Explore/search bar + suggested first prompts in AI chat
3. AI credits row on Wallet screen
4. Cold-start feed guarantee for new users

**Medium (2–4 weeks)**
5. Composer AI ✨ (improve/translate/hashtags) + post long-press AI actions
6. Zap goal progress feedback after zapping
7. Notification priority sorting (zaps first, batched likes)
8. Onboarding: silent keys → filled feed → contextual key backup

**Bigger bets (4+ weeks)**
9. AI Daily Digest (morning habit anchor)
10. Semantic search ("find people discussing…")
11. Article TL;DR + voice-post transcription (creator AI suite)

---

## 7. Metrics to watch weekly
- **Time-to-first-value** (install → first like/zap/AI message): target < 60 s
- **Zap conversion**: % of daily users who zap ≥ once (target 5%+; Nostr average is <1% — the economy is the differentiator)
- **AI**: trial→paid conversion, messages/user/day, Basic vs paid tier mix
- **D7 retention** (target 25%+ = top quartile), DAU/MAU (target 20%+)
- **Creator earnings posted** (studio views → content posted next day correlation)

## 8. Hard rules (don't regress)
1. No dark patterns — symmetric opt-in/out, honest prices, no fake urgency.
2. Never auto-insert into the feed; never auto-play with sound.
3. AI is opt-in, labeled, reversible, honestly priced — everywhere.
4. Zaps ≤ 100 sats must never take more than 2 interactions.
5. Empty states teach; they never sit blank.
