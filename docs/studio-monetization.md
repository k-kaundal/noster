# Studio, memberships & zap goals — creator monetization

The Studio is where a creator earns: a dashboard of what they have been paid,
plus the two tools for being paid on purpose — **subscription tiers** and
**zap goals**. This document covers the design, the event shapes, and where
each piece lives, for both the web app (`src/`) and the Flutter app
(`flutter_app/lib/`).

## The rule that decides everything

**The seller side of the Studio is premium-only.** Creating a tier, opening a
zap goal, and reading the earnings dashboard all require a paid, *active*,
non-generated NIP-05 name or lightning address — the same entitlement
`isPremiumProvider` computes and the Premium screen is built around.
Subscribing to somebody, and zapping a goal, are open to anyone with sats.

The reasoning is the same one that gates long-form articles: a creator is
asking strangers for money, on an open protocol, forever. A name somebody
paid for is the cheapest honest signal that there is a person behind the ask
— and it is what the subscriber is paying to reach. The gate is a product
choice, not a protocol one; nothing in Nostr stops a free account from
publishing a tier, and other clients are free to let it.

Non-premium users see an upsell card with a route to `/premium`; signed-out
users see a sign-in prompt. The gate is enforced in the UI, not on relays —
relays will accept a kind 37001 from anybody, and this app reads tiers from
anybody. Gating who may *read* would be a lie the receipts would expose on
the first audit.

## Subscriptions: a zap IS the subscription

There is no merged NIP for user-to-user subscriptions. The draft everybody
quotes — tiers as kind 37001, a kind 7001 "subscribe" event, cancellation by
deletion — is an unmerged pull request, frequently mislabelled "NIP-88"
(NIP-88 is polls). `NIP.md` documents what is used and why.

The draft's payment model is kept; its bookkeeping is not. NostrFeed
publishes **no** kind 7001 and **no** deletion-for-cancellation, because:

- A kind 7001 declares an intention and proves no payment.
- A deletion cancels the declaration and stops no money.
- A client cannot bill anybody on a schedule. A closed browser tab pays
  nothing, and NIP-47 wallet budgets are spending caps, not standing orders.

So: **paying is the only act that means anything, and not paying again is the
only cancellation that works.** The receipt — kind 9735, signed by the
creator's own lightning server, carrying the tier's `a` coordinate — is the
whole record.

### Tier event (kind 37001)

```jsonc
{
  "kind": 37001,
  "content": "Everything, a week early",
  "tags": [
    ["d", "gold"],                       // slug = the tier's identity
    ["title", "Gold"],
    ["amount", "5000", "monthly"],       // whole sats + weekly|monthly|yearly
    ["description", "Everything, a week early"],
    ["perks", "Early access", "Direct messages"],
    ["image", "https://…"],
    ["alt", "Subscription tier: Gold — 5000 sats per month"]  // NIP-31
  ]
}
```

- The `d` slug with the creator's pubkey addresses the tier
  (`37001:<pubkey>:<slug>`). Republishing the same slug **replaces** the tier
  — that is how editing works, and why `rankTiers` keeps only the newest
  revision per slug.
- `amount` must be a positive whole number of sats: it becomes an invoice.
  An unrecognised period reads as monthly rather than dropping the tier.
- Retiring is a NIP-09 deletion request (`kind 5` with the tier's `a` tag) —
  a request, not a guarantee.

### Subscribing

```
subscriber ──zap(≥ price, a=37001:creator:slug, p=creator)──▶ creator's lnurl
                                        │
                                        ▼
                      kind 9735 receipt, signed by the creator's
                      lightning server, naming the tier's coordinate
```

The zap request (kind 9734) carries the tier coordinate in `a`, the creator
in `p`, and the relays the receipt should land on. Whoever pays it — built-in
LNbits wallet, NWC, Cashu, or any external wallet by QR — the receipt that
comes back **is** the subscription. Confirmation is the receipt appearing on
relays naming the tier and the payer, never a local record.

### Standing, computed from receipts

`standingFrom` (web `src/lib/subscription.ts`, Flutter
`features/studio/models/subscription.dart`) turns a payer's receipts into a
state:

| state | meaning |
| --- | --- |
| `active` | a payment of ≥ the tier price landed inside the period it bought |
| `lapsed` | paid once, but that period has run out |
| `none` | never paid the full price |

Three judgements worth knowing, because they are the ones users ask about:

- **One payment buys one period.** Payments below the price are tips — real
  money, shown in the history — that buy no time. Three tips do not add up to
  a month. A creator who priced a tier at 5,000 sats did not price it at
  whatever somebody felt like.
- **`shortfallSats`** exists because an underpayment used to be
  indistinguishable from never having paid: the sats left the wallet, the
  button said "Subscribe", and nothing said why it did not start. The UI now
  says what was sent, what the period costs, and that sending the remainder
  separately will not start one.
- **The most recent *qualifying* payment opens the period**, not the most
  recent payment. An older full payment still holds a period open when a
  small tip came after it.

The creator's figures come from one pass over the same validated receipts
(`tierStanding` → `summarizeMemberships`): members, active, renewing-soon
(within 5 days), lapsed, lifetime sats, and a **run rate** — what the periods
currently running are worth per month. The run rate is a description of
running periods, never a forecast, and the UI says which one it means.
Anonymous zaps are real revenue attached to a throwaway key: counted in
`unattributedSats` so the lifetime total agrees with the wallet, never as a
number of people.

### What nobody here can do

Nothing on this protocol charges anybody on a schedule, and the interface
says so rather than implying otherwise. Each payment covers one period;
renewal is a person deciding again. Any client claiming automatic renewal is
describing "we charge you when you next open the app".

## Zap goals (NIP-75, kind 9041)

Goals are the one part of this feature set that **is** a ratified NIP.

```jsonc
{
  "kind": 9041,
  "content": "Help fund the conference trip",
  "tags": [
    ["relays", "wss://a.example", "wss://b.example"],  // REQUIRED, one tag
    ["amount", "2100000"],                             // REQUIRED, millisats
    ["closed_at", "1735689600"],                       // optional deadline
    ["image", "https://…"],
    ["summary", "Conference travel"],
    ["r", "https://…"],                                // optional link
    ["a", "30023:<pubkey>:<d>"],                       // optional subject
    ["zap", "<pubkey>", "<relay>", "<weight>"]         // optional splits
  ]
}
```

Two things are easy to get wrong, and both are handled in the model (web
`src/lib/nip75.ts`, Flutter `features/studio/models/zap_goal.dart`):

- **The amount tag is millisats.** A target of `210000` is 210 sats, not 210
  thousand. The editors take sats and multiply; the cards divide for display.
- **`relays` is a MUST, not a hint.** It is where receipts are published and
  tallied from. A goal whose zaps do not name those relays produces receipts
  the tally never sees — which is why `buildGoalTags` throws rather than emit
  a bare `["relays"]`, and why the tally asks the reader's relays *and* the
  goal's: a funded goal reading zero because the sender's client ignored the
  MUST is the bug that pairing avoids.

### Funding and progress

Progress is the sum of validated zap receipts `e`-tagging the goal, checked
with the same rules as every other figure in the app (`explainZapReceipt`).
Receipts are windowed at **both** ends: after `closed_at` (plus a 5-minute
clock-skew tolerance), and not before the goal's own `created_at` — without a
lower bound, the first thing a new goal does is credit itself with every zap
its announcing note had ever collected. Valid zaps set aside by the window
are reported (`excludedCount`/`excludedMsat`) rather than silently dropped,
because "I sent sats and the bar did not move" deserves an answer.

A kind 9041 does not appear in any feed, so a goal on its own is close to
invisible. **Announce it**: a kind-1 note carrying `["goal", "<id>",
"<relay hint>"]`. Zaps on the note count toward the goal — that is what makes
the bar move for people reading in clients that have never heard of NIP-75.
Addressable events link back the same way (`linkedGoal` reads the tag).

Goals stay fundable after the target is met — over-funding is normal. Only a
passed `closed_at` stops the count. Retiring is a NIP-09 deletion request on
the goal id; sats already sent are the author's and are not affected.

## The Studio dashboard

Built only from zap receipts that survive NIP-57 validation — no figure can
exceed the one on the post it came from, and a dashboard that invents rows is
worse than one with fewer.

- **Earnings** (web `useStudio`/`lib/studio.ts`, Flutter
  `studioEarningsProvider`): every receipt naming the user in the window,
  deduplicated on receipt id, validated. Sats, payments, unique zappers,
  repeat zappers, the previous equal period for a real % change, and a
  per-day series with every day filled so the chart has no holes. Receipts
  that name the user and fail a check are **counted and shown as refused** —
  a figure you would quote has to say what it left out.
- **Validation policy.** Figures that gate money (tier standings) run
  `providerPolicy: 'require'` — a receipt the recipient's own lightning
  server did not sign is refused outright. The earnings dashboard runs
  `'prefer'` — a provider mismatch is counted but flagged, because the
  provider key is remembered from earlier payments and is legitimately
  missing for much of the network. The distinction is deliberate: a
  subscription gates perks, a dashboard reports.

## Where everything lives

| Piece | Web (`src/`) | Flutter (`flutter_app/lib/`) |
| --- | --- | --- |
| Tier model, standing, summaries | `lib/subscription.ts` | `features/studio/models/subscription.dart` |
| Goal model, progress (NIP-75) | `lib/nip75.ts` | `features/studio/models/zap_goal.dart` |
| Tier fetch/publish, subscribe invoice | `hooks/useSubscriptions.ts` | `features/memberships/services/membership_service.dart` |
| Membership providers | — | `features/memberships/providers/membership_providers.dart` |
| Earnings fetch/summary | `hooks/useStudio.ts`, `lib/studio.ts` | `features/studio/providers/studio_providers.dart` |
| Studio screen | `pages/StudioPage.tsx` | `features/studio/studio_screen.dart` |
| Memberships screen | `pages/MembershipsPage.tsx` | `features/memberships/memberships_screen.dart` |
| Tier editor / cards | `components/subscriptions/` | `features/memberships/widgets/` |
| Goal editor / cards | `components/ZapGoal*.tsx` | `features/studio/widgets/` |
| Premium entitlement | `lib/tiers.ts`, `hooks/useNip5.ts` | `features/premium/providers/premium_providers.dart` |
| Zap receipt validation | `lib/zap.ts`, `lib/zapSummary.ts` | `core/nostr/zap_receipts.dart` |
| Arbitrary-kind signing | `useNostrPublish` | `NostrService.createEvent(kind, content, tags)` |

The Flutter models are line-for-line ports of the web's `lib/` files; the two
apps reading the same receipts reach the same standing, which is the point of
computing status instead of storing it.

## Configuration

Nothing new. Tiers, goals and receipts are plain Nostr events on the relays
already configured; subscribing pays through the wallets already wired
(LNbits custodial → NWC → Cashu → external QR). The only prerequisite is the
premium gate: a deployment with no NIP-05 domain configured sells nothing, so
everyone is non-premium and the Studio shows its upsell to everybody — which
is correct, not a gap, in exactly the way the article gate documents.
