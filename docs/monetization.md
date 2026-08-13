# Monetization: what a client without a server can honestly do

NostrFeed is a static bundle. There is no backend, no database, no cron and no
admin. Every design decision here follows from that, so this document is as
much about what is *not* being built as what is.

## The two things a server would have done

**Authority over payment.** A backend takes an invoice, watches for
settlement, writes a ledger row keyed on the payment hash, and fulfils the
order exactly once. None of that can happen in a browser: whatever a client
concludes about a payment is a claim by the party that benefits from it.

**Entitlement.** "Is this person Pro" is a database lookup. In a client it is a
localStorage flag, and `usePremium` already says so in a comment — *"a flag in
the browser can be set by anyone with devtools; the records here exist so the
UI can show what was paid for, not to unlock anything."*

So the rule for this codebase is: **anything sold has to be either publicly
verifiable or not worth faking.**

## What is publicly verifiable

Three artifacts a client can check without trusting us, in rough order of how
much they cost to build:

1. **A zap receipt** (NIP-57, kind 9735) — signed by the recipient's lightning
   server, contains the invoice and a payer-signed request. This is what boosts
   are built on.
2. **Paid relay access** — the relay accepts your writes or it does not. This
   is what `/premium` already sells, and it needs no client-side check at all.
3. **A NIP-05 name** at a domain we run — queryable from the `nostrnip5`
   extension, already used for verified names.

A NIP-58 badge signed by the platform key would be a fourth, and is the obvious
route for Pro/Pro+ if those get built: the badge is public, the signature is
ours, and any client can verify it.

## Boosts

A boost **is a zap to the platform's lightning address**, whose zap request
names the note being promoted.

```
buyer ──zap(1,000 sats, e=<note>)──▶ platform lightning address
                                          │
                                          ▼
                              kind 9735 receipt, signed by
                              the platform's lnurl provider
                                          │
     ┌────────────────────────────────────┴───────────────────┐
     │                                                        │
  NostrFeed reads it and ranks the note up          every other client
  for its own readers, capped and rationed          sees an ordinary zap
```

What that buys, for free:

- **It cannot be forged.** The receipt must be signed by the `nostrPubkey` from
  our own lnurl metadata. A receipt signed by anyone else is somebody's claim
  about their own note. `validateZapReceipt` enforces this and `readBoost`
  refuses without it.
- **The amount is what was paid.** Taken from the bolt11 invoice, not from the
  request's `amount` tag — otherwise a campaign tier could be claimed on a
  starter invoice.
- **The buyer is public.** The zap request inside the receipt is signed by the
  payer, so who paid for what promotion is a matter of record, on relays,
  forever.
- **It is auditable by outsiders.** Anyone can list every boost this platform
  has ever run by querying zap receipts addressed to our key. A client that
  wants nothing to do with paid promotion ignores them and loses nothing.

### The limits, and why they are hard

| Rule | Value | Why |
| --- | --- | --- |
| Multiplier cap | 3× | Past this a boosted note stops competing with organic content and starts replacing it. |
| Promoted share | 10% of the rendered feed | Counted against the feed that *results*, not the one that went in — otherwise each advert enlarges the denominator meant to limit it. |
| Spacing | 1 promoted per 8 organic | Keeps promotion legible as promotion. |
| Stacking | none | Only the strongest boost on a note applies. Two purchases would otherwise buy past the cap, which is the cap not existing. |
| Overflow | dropped | A boost that misses a slot is not shown. The bottom of a feed is not a placement. |

Timing comes from the **receipt's** `created_at`, which is our signature and
the one timestamp the buyer cannot choose.

### What a boost is not

A boosted note is boosted **for readers of NostrFeed**. Damus, Amethyst and
every other client see an ordinary note and an ordinary zap receipt. Anything
sold to an advertiser has to say so — "reach on Nostr" would be false.

## Money

`src/lib/money.ts`. Millisats, as integers, everywhere. Sats exist for people
to read.

- No floating point on money. `amount * 0.1` for a platform fee is off by an
  amount somebody eventually notices, in the direction of whoever wrote the
  code.
- `splitPercent` returns both halves and guarantees they add back to the
  original; the leftover millisat goes to the creator by construction.
- `toMsat` throws on a fractional sat rather than rounding it — that is a
  caller's bug and this is the last place it can be caught.
- `toSats` rounds **down**, always. Up shows a balance that cannot be spent.

## Fiat

Prices are in sats. The fiat figure shown beside a balance is a reference, not
a price, and it carries the time it was read — see `useFiat` and `FiatValue`.
Card checkout via LNbits fiat providers stays available for premium plans.

This is a deliberate departure from a "sats only, no fiat anywhere" reading of
the product: somebody looking at a balance is asking a different question from
somebody looking at a price.

## Not built, and why

- **Ledger, orders, idempotency, webhooks** — need a server that is the
  authority on payment. A client cannot be one.
- **Campaigns, prepaid balances, targeting** — need the above, plus impression
  accounting nobody can verify from outside.
- **Creator revenue share from "qualified views"** — needs view tracking, which
  is surveillance infrastructure this product otherwise refuses, and a payout
  job. Direct zaps and creator subscriptions do the same job without either.
- **Fraud scoring, risk states, admin panel** — server-side by definition.

If a backend ever exists, the shape to keep is the one already here: the client
displays and requests, the server decides, and anything a reader is asked to
believe is signed by somebody they can name.
