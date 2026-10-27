# Deep Links, the AI Agent, and the Private-Key Question

**Date:** 2026-10-26 · **Scope:** universal share links, app deep-linking, the AI agent architecture, and whether the AI can sign as the user.

---

## 1. Share links — FIXED (was a dead `nostr:` string)

**The problem:** sharing a post produced `nostr:note1…` — a scheme only Nostr
clients understand. Shared to WhatsApp/Telegram/a browser/Play Store it was a
dead string.

**The fix:** every share is now a **universal HTTPS link**
(`https://nostrfeed.com/note1…`). The web app already renders those paths via
`/api/preview`, so:

- **App installed** → the OS opens the link *in the app*, directly to the
  thread/profile (Android App Link / iOS Universal Link).
- **No app** → the link opens a web preview of the post (which is where an
  "Open in app / Get the app" banner lives).

**Changed:** `post_card` share + copy-link, `articles_screen` share (was
njump.me — a third-party redirect!), `reels_screen` share (was a raw video
URL / `nostr:` string). New helper: `core/utils/share_links.dart`
(`ShareLinks.forNote/forProfile`, origin `https://nostrfeed.com`).

## 2. App deep-link verification — what I wired + what YOU must fill in

### Android (App Links)
- `AndroidManifest.xml`: `autoVerify` intent-filter for
  `https://nostrfeed.com` + `www.nostrfeed.com` (+ a `nostr:` scheme filter).
- `public/.well-known/assetlinks.json`: created, bound to
  `com.nostrfeed.nostrfeed_mobile` — **you must replace
  `REPLACE_WITH_RELEASE_SIGNING_SHA256_FINGERPRINT`** with the release signing
  cert's SHA-256 fingerprint:
  ```bash
  keytool -list -v -keystore <your-release.keystore> -alias <alias>
  # copy the "SHA256:" value into assetlinks.json
  ```
  (Add the debug fingerprint too while testing.) Serve it at
  `https://nostrfeed.com/.well-known/assetlinks.json` with
  `Content-Type: application/json`, no redirect — Vercel serves `public/`
  as-is, so it just needs a deploy.

### iOS (Universal Links)
- `ios/Runner/Runner.entitlements`: `applinks:nostrfeed.com` +
  `applinks:www.nostrfeed.com` — **also enable "Associated Domains" on the
  App ID in the Apple Developer portal and in Xcode** (the entitlements file
  must be attached to the target in Xcode's Signing & Capabilities).
- `public/.well-known/apple-app-site-association`: created — **you must
  replace `REPLACE_WITH_TEAM_ID`** with your Apple Team ID.

### Router side (already done earlier)
The app routes `/note/<hex>` → thread and `/npub/<hex>` → profile; the
bech32 NIP-19 paths (`/note1…`, `/npub1…`…) route through the existing
`Nip19HandlerPage`. So a verified link lands on the exact content.

---

## 3. The AI agent — proper architecture (not a bare chatbot)

**Research-backed answer** (OpenRouter tool-calling docs, 2026): a real agent
is a **tool-calling loop**, not one LLM call:

```
user → LLM (with tool defs)
     ← tool_call: search_relay / fetch_thread / fetch_profile
     → app executes the tool LOCALLY (reads relays / the store)
     → result appended → LLM again
     ← final answer (grounded in real Nostr data)
```

The current `AiContextService` is a **single-shot** version of this (one
fetch, one answer). A proper agent upgrades it to a bounded **loop** (max 3–4
rounds) where the model can call tools repeatedly:

| Tool (local, read-only) | What it does |
|---|---|
| `search_relay(filters)` | Query relays/the store for events |
| `fetch_thread(id)` | Root + replies for a note |
| `fetch_profile(pubkey)` | A user's kind-0 |
| `fetch_hashtag_feed(tag)` | Posts for a hashtag |

These are **read-only** and safe — the agent searches, reads, summarizes.
Implementation lives in the app's AI layer (a `_runAgentLoop` in
`ai_chat_notifier.dart` that sends tool definitions, executes `tool_calls`
against relays/store, appends results, and loops until the model stops
calling tools or the round cap hits). The OpenRouter chat endpoint already
supports `tools`/`tool_calls` on the models the gateway uses — the gateway
just needs the loop around `streamChat`.

---

## 4. "Can I pass the user's private key to the AI agent?" — the honest answer

**Yes, the agent can ACT as the user (post, like, zap, follow) — but the
private key must NEVER leave the device or touch the model.**

The safe pattern (the only correct one):

```
Model proposes an action (structured tool_call): post_note{content}
     ↓
APP shows a confirmation: "Post this note? <content>"  [user approves]
     ↓
APP signs LOCALLY with the key already in secure storage → publishes
```

Rules (non-negotiable):
- **The key is NEVER in the prompt, the tool args, or any API request.**
  The model sees "you can ask the user to post a note" as a tool definition —
  it never sees the key. The app's `AuthService` signs with the key it
  already holds (secure storage, hardware-backed) — exactly like every other
  publish in the app.
- **Human-in-the-loop confirmation for every write.** Read tools are free;
  write tools (post/zap/follow/delete) always pause for an explicit user
  approve/deny sheet (OpenRouter's Agent SDK calls this HITL —
  `awaiting_hitl`). This is what makes an agent safe instead of a bot that
  spends your sats and posts under your name while you sleep.
- **Budgets on money tools** (zap amounts capped, like the existing
  `quickZapMaxSats`).

So: the agent works AS the user **with per-action consent** — that's the
pro-user experience (agent does the work, user keeps the keys + the final
say). Handing the raw key *to the model* would be the one version of this
that's never acceptable.

---

## 5. Status

| Item | State |
|---|---|
| Universal share links (app-side) | ✅ shipped (post/article/reel + helper) |
| Android App Link filter + assetlinks.json | ✅ wired — **needs your release SHA-256** (Play Console → Setup → App Integrity → App signing → SHA-256 certificate fingerprint; the developer ID `5080195924069414581` in your link is NOT the fingerprint) |
| iOS entitlement + AASA | ✅ wired — **needs your Apple Team ID + Xcode "Associated Domains"** |
| **AI agent — Chat + Agent modes** | ✅ **shipped** (Grok-style tool-calling loop, read-only Nostr tools, live steps panel + steps trail in bubbles) |
| Agent write-tools (act as user, key never leaves device, per-action consent) | 📋 design ready (§4) — next |

## 6. The Agent — shipped (Chat + Agent modes)

The AI screen now has a **Chat / Agent segmented toggle**:

- **Chat** — the normal assistant (streams a completion + one-shot context).
- **Agent** — a bounded **tool-calling loop** (OpenRouter function calling,
  max 4 rounds): the model calls READ-ONLY Nostr tools, the app executes
  them locally, results feed back, and it answers grounded in the real data.

**Tools** (`ai_agent_tools.dart`): `search_relay`, `fetch_thread`,
`fetch_profile`, `fetch_hashtag_feed` — all read-only, bounded, against the
app's relay pool. The model NEVER sees a key.

**Grok-style steps:** `liveAgentSteps` streams each tool call into the
advanced **`AgentStepsPanel`** above the input — a pulsing ✨ header ("Agent
is working…" + step count), the **current step highlighted** in the accent
with a small spinner + "now", and **done steps collapsed** into an
expandable "N steps done" trail. The finished answer keeps a compact
`_AgentStepsTrail` in its bubble. No per-frame tickers — one
`TweenAnimationBuilder` drives the pulse. Billing rides the same
trial→credits reserve→exact-settle flow as chat.

**Agent billing scales with steps (2x-3x):** the loop makes several billed
API calls (one per tool round + the final answer), so:

- **Reserve** = `estimate × 2` up front (a typical 1-2 step run), so a
  multi-step run doesn't hit `insufficient_credits` mid-loop.
- **Usage is SUMMED across every round** — the old code kept only the LAST
  round's usage (undercharging a 3-step run by its first two rounds' cost);
  fixed, each round's prompt+completion+cost accumulates.
- **Settle-to-exact-cost** on the summed usage → lands at ~2x for 1-2 steps
  and ~3x for 3+ steps, capped by reserve × 2 (the `maxSettleOverage` bound),
  so the charged amount honestly scales with the steps taken.
- The bubble's cost line shows `model · N tokens · agent ×<steps>` so the
  multiplied cost is transparent.

**`agenix` package (evaluated, not adopted):** a full multi-agent
orchestration framework (memory, multi-agent chains, Firebase). Rejected as
overkill — our custom loop already does the tool-calling we need AND is
integrated with the app's credits/billing system, relay pool, and context
service, none of which agenix knows about. Our agent is the better fit.
