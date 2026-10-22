# NostrFeed AI Layer — Research & Implementation Plan (DIRECT, no new server)

**Status**: ✅ Decisions locked — Phase 1 in progress
**Date**: 2026-10-22 (updated same day after key verification + pricing decisions)
**Scope**: Flutter app (`flutter_app/`) only. OpenRouter is called **directly from the app** — no new backend. Only existing infra is reused: LNbits house wallet (invoice key) + Nostr relays.

## Locked decisions
- **Access**: 5 free trial messages/day per device, then paid-only (sats credits)
- **Revenue wallet**: house wallet (already in `.env` — `LNBITS_WALLET_ID`/`LNBITS_INVOICE_KEY`, receive-only)
- **Prices**: Basic 3 · Fast 5 · Smart 15 · Genius 70 sats/msg (adjustable via Nostr config note)
- **Key status**: free-tier verified (50 req/day shared, 2,666-token trial buffer on paid models → effectively free-only until $10 top-up; 21 free models in catalog)
- **Security rule**: LNbits ADMIN key NEVER enters the app/.env/chat — invoice key only; admin stays on the owner's machine for sweeping revenue

## Empirically verified facts (2026-10-22)
- `openrouter.ai/api/v1/auth/key` exposes live `free_model_daily_requests {used, limit, remaining}` → app shows "N free left today" honestly
- Zero-credit accounts get a ~2,666-token paid trial buffer, then hard 402 → treat key as free-only until funded
- `/api/v1/models` catalog: 468 models, 18 `:free` + 3 zero-price
- Paid tiers need: $10 top-up (→ 1,000 free/day + spendable credits) + second capped key ($25–50 limit)

---

## 1. Research Summary (verified against OpenRouter docs)

| Question | Answer |
|---|---|
| API shape | OpenAI-compatible `POST https://openrouter.ai/api/v1/chat/completions`. SSE streaming (`stream: true`) works for **all** models. |
| **Cost in response** | Every response carries `usage.cost` (USD credits) + token counts — we can meter **exact** per-request cost on-device. |
| **Per-key credit limit** | When creating an API key you set a **spend cap** (e.g. $50). A leaked key can never burn more than its cap. |
| Free models | IDs ending `:free` + `openrouter/free` auto-router. Limits: **20 req/min**, **50 req/day** (unfunded account) or **1,000 req/day** after a one-time ≥$10 top-up. **Limits are per API key → shared across ALL app users.** |
| Free model privacy | `:free` endpoints may log/train on prompts (OpenRouter discloses this). Paid endpoints don't. |
| Key rotation | Management API can rotate keys programmatically (needs a server), or manually via app releases. |
| BYOK / OAuth PKCE | OpenRouter supports OAuth PKCE — users can authorize the app and use **their own** OpenRouter key/credits. |
| L402 pattern | Industry standard for sats-paid AI (HTTP 402 + Lightning invoice). We implement an app-local version using LNbits. |

---

## 2. Architecture (direct, serverless)

```
┌─────────────────────────────────────────────────────────────────┐
│                        Flutter app                               │
│                                                                  │
│  features/ai/ ───────┬───────────────────────────────┐          │
│                      │                               │          │
└──────────────────────┼───────────────────────────────┼──────────┘
                       │ HTTPS (OpenAI-compatible)     │ HTTPS (existing infra)
                       ▼                               ▼
              ┌─────────────────┐            ┌──────────────────────┐
              │   OpenRouter    │            │  ln.nostrfeed.com     │
              │                 │            │  (LNbits — ALREADY    │
              │  Key A: "free"  │            │   used by the app)    │
              │  → :free models │            │                       │
              │  → $0 possible  │            │  invoice key only:    │
              │                 │            │  • create AI-credit   │
              │  Key B: "paid"  │            │    invoices           │
              │  → $50 cap      │            │  • poll payment status│
              │  → paid tiers   │            │  • CANNOT spend funds │
              └─────────────────┘            └──────────────────────┘
                       ▲
              Nostr relays (existing): kill-switch config note +
              AI Unlimited membership receipts (kind 9735) — no server
```

### Two-key design (the safety core)
- **Key A ("free")**: on an OpenRouter account/key with **zero credits**. Can only call `:free` models. If it leaks → worst case someone uses free models against the shared rate limit. **$0 risk.**
- **Key B ("paid")**: hard **credit limit ($25–50)** in the OpenRouter dashboard, labeled `nostrfeed-flutter-v1`. If it leaks, max loss = the cap. Rotate per release; monitor the dashboard for spikes.
- Keys ship via `--dart-define` (never committed to git, per existing `Env` convention).

### Kill-switch without a server (Nostr-native)
App fetches a config note from **your pubkey** on relays (addressable kind, e.g. kind 30078 app-data):
```json
{ "ai_enabled": true, "paid_key_version": 3, "free_daily_limit": 10,
  "prices": {"fast": 3, "smart": 12, "genius": 60} }
```
- Revoke a leaked key: bump `paid_key_version` → old builds stop paying, you rotate the key.
- Change prices/limits any time without an app release. Signed by your nsec = tamper-proof. **Zero server.**

### Sats payment verification without a server
The app already talks to `ln.nostrfeed.com`. An **LNbits invoice/read key** (inkey) can create invoices + check payment status **but cannot spend**. Embedding it is safe (worst case: someone reads the AI wallet's payment history).
1. User taps "Top up AI credits" → picks a pack (1,000 / 5,000 / 20,000 sats)
2. App creates an LNbits invoice on the dedicated `nostrfeed-ai` wallet, memo `ai-credits:{pubkey}:{pack}`
3. User pays via existing `payWithAnyWallet()` + `showPayInvoiceSheet` (built-in LNbits wallet → internal, instant)
4. App polls `GET /api/v1/payments/{hash}` until settled → credits land in the **on-device ledger** (secure storage)

### Honest security tradeoffs (accepted by going serverless)
| Risk | Impact | Mitigation |
|---|---|---|
| Paid key extracted from APK | Attacker spends up to key cap ($25–50) | Hard cap, dashboard alerts, rotation, Nostr kill-switch |
| Local credit ledger bypassed (patched APK) | Cheater uses the embedded paid key for free | Same cap; ledger has checksum; honest users unaffected |
| Free quota shared across all users (1,000/day) | Free tier can be exhausted on busy days | Buy the one-time $10 top-up (→1,000/day), queue + retry on 429, upsell "3 sats Fast" when busy |
| Wiped app = lost credits | Support requests | Credits are small amounts; export/restore via optional Nostr-encrypted backup later |

---

## 3. Pricing model (everything in sats)

### 3.1 Model tiers (in-app picker) — LOCKED

| Tier | Models | Your cost | **User pays** | Margin |
|---|---|---|---|---|
| **Basic** | `openrouter/free` + 21 `:free` models | ~0 sats | **3 sats** | ~100% |
| **Fast** (needs credits) | `google/gemini-2.5-flash`, `deepseek/deepseek-chat` | ~2 sats | **5 sats** | ~60% |
| **Smart** | `openai/gpt-5-mini`, `anthropic/claude-haiku-4.5` | ~10 sats | **15 sats** | ~33% |
| **Genius** | `anthropic/claude-sonnet-4.5`, `openai/gpt-5` | ~50 sats | **70 sats** | ~29% |

Trial: 5 free messages/day per device (Basic tier only). Credit packs: 1,000 / 5,000 / 20,000 (+10% bonus) sats → house wallet. All prices/limits overridable live via the Nostr config note.

### 3.2 Metering (exact, on-device)
- Before send: reserve an estimate (`max_tokens` cap × tier price).
- After response: read `usage.cost` (USD) → convert via existing `walletToolsService.fiatRate` → **deduct actual sats = cost × 1.5 margin**, min 1 sat. Refund unused reserve.
- UI shows running balance: `⚡ 1,240 credits` in the AI screen + Wallet screen row.

### 3.3 Revenue streams (all serverless)
1. **Credit packs** — 1,000 / 5,000 / 20,000 sats (20k pack = +10% bonus credits). Paid to your LNbits AI wallet = **your revenue**.
2. **AI Unlimited membership — 10,000 sats/mo** — built on the **existing memberships system** (kind 37001 tier, subscribe = zap, receipt kind 9735 = proof). Zero new payment code; `tierStanding` already validates standing. Members get: unlimited Fast tier + 50 Smart/day.
3. Free tier = funnel (10/day → upsell).

### 3.4 Margin math (BTC ≈ $90K)
Fast req costs you ~$0.002 ≈ 2 sats → charge 3 → **~33% margin**. Genius ~$0.05 ≈ 50 sats → charge 60 → **~17% margin** (tune in config note). 200 active users × 20 paid req/day × avg 3 sats profit ≈ **360K sats/mo** + memberships.

---

## 4. Features & phases (all client-side)

### Phase 1 — Foundation + AI Chat (~2–3 weeks)
1. `Env` additions: `OPENROUTER_FREE_KEY`, `OPENROUTER_PAID_KEY`, `LNBITS_AI_INVOICE_KEY` (--dart-define).
2. **`lib/features/ai/`** (ADR-0001 layout):
   - `domain/` — `AiMessage`, `AiModel` (tier/price/limits), `AiCredits` ledger (pure Dart, checksummed)
   - `data/` — `OpenRouterService` (via `ApiHttpClient`, SSE streaming, `usage` parsing), `AiCreditsService` (LNbits invoice create/poll), `AiConfigService` (Nostr kill-switch note), local chat history store (Hive/SharedPreferences JSON)
   - `application/` — Riverpod: `aiChatNotifierProvider` (streaming), `aiCreditsProvider`, `aiFreeQuotaProvider` (10/day, device), `aiConfigProvider`
   - `presentation/` — `AiChatScreen` (markdown bubbles, streaming text, model picker with sat badges, cost-per-msg label, balance chip), `AiTopUpSheet` (packs → invoice → poll → credits)
3. **Nostr-aware assistant**: context built **on-device** from `FeedStore` cache + `socialRepository` (recent notes from follows, mentions, trending) → stuffed into the prompt. "What happened on my feed today?" works with no server.
4. Entry points: `/ai` route (`DetailScaffold`), drawer (Discover), chat-tab FAB.

### Phase 2 — Creator Copilot (~2 weeks)
- Compose ✨ menu: Improve / Shorten / Fix grammar / Translate / Hashtags / Title ideas / Variations (1 request each, free quota or credits).
- Article copilot: outline→draft in `ArticleEditorScreen`; TL;DR card + translate in `ArticleReaderScreen`.
- **Auto alt-text** for images at upload (Gemini Flash vision, ~1 sat) — accessibility win.
- Voice post transcription: audio-capable model via base64 (Gemini) → transcript + chapters for reels.

### Phase 3 — Discovery (~3 weeks)
- **AI Daily Digest**: on-device — morning pull of feed cache → "Your Nostr day in 60 seconds" (top zaps/replies/stories). Local notification; premium/members get it free.
- **Scoped semantic search**: OpenRouter embeddings over the user's cached feed/bookmarks, vectors in on-device SQLite, cosine search in Dart — "posts I saw about AI agents". (Network-wide semantic search genuinely needs a server → deferred.)
- Long-press any post → Translate (cached by event id + lang).

### Phase 4 — Membership + polish
- AI Unlimited tier (kind 37001) live; standing via existing `tierStanding`.
- Optional credit backup/restore (NIP-44 encrypted app-data event).
- Web app parity (same OpenRouter-direct pattern works in React).

---

## 5. Flutter integration notes
- SSE streaming: `ApiHttpClient` streaming or `web_socket_channel` (already a dep) — token-by-token bubbles.
- Cost UX: every AI button shows `⚡ 3 sats`; chat input shows `≈ 3 sats/msg · 7 free left today`; `describeSatsAsFiat` for the "$0.003" subtitle.
- Free-tier 429 → friendly sheet: "Free AI is busy right now — Fast tier answers instantly for 3 sats."
- DMs are NEVER sent to AI without explicit per-message action; chat screen shows a one-time privacy banner ("Processed by third-party AI; never share your nsec").
- `flutter analyze` at 0 issues; unit tests for ledger math, tier pricing, config-note parsing (deterministic, no network).

## 6. Remaining decisions (asking in chat)
1. Two-key strategy + capped paid key — OK to accept the capped-leak risk, or free-models-only for v1?
2. Prices/limits: 3/12/60 sats, 10 free/day, 10,000 sats/mo Unlimited — sane defaults?
3. Start Phase 1 now?

## 7. Effort & cost
| Phase | Dev | Out-of-pocket |
|---|---|---|
| 1 (direct chat + credits) | 2–3 wks | $10 OpenRouter top-up (unlocks 1,000 free req/day) + $25–50 paid-key float |
| 2 (copilot) | 2 wks | usage only |
| 3 (digest/search) | 3 wks | usage only |
| 4 (membership/polish) | 1–2 wks | — |
