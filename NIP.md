# NostrFeed protocol notes

This app publishes standard Nostr events. It defines no custom kinds.

It does add fields to two existing schemas, documented here so another client
reading NostrFeed's events knows what they are — and so a future version of
this app does not quietly change their meaning.

## Avatar ring on profile metadata (kind 0)

NostrFeed reads one non-standard field from kind 0:

| field         | value                                                     |
| ------------- | --------------------------------------------------------- |
| `avatar_ring` | id of an animated ring drawn around the profile's avatar   |

```jsonc
{
  "name": "alice",
  "lud16": "alice@nostrfeed.com",
  "avatar_ring": "orbit"
}
```

Current ids: `pulse`, `glow`, `orbit`, `aurora`, `prism`. Absent, unknown or
non-string means no ring.

### Why it needs no enforcement

Which rings a profile may wear is derived from the tier of its own `lud16`, in
the same event. Every reader recomputes that independently, so a profile naming
a ring above its tier renders without one — on its owner's screen as much as
anyone else's. There is nothing to trust and so nothing to verify.

Clients that do not know the field ignore it, as NIP-01 expects of unknown kind
0 fields. It is purely decorative and carries no protocol meaning.

## Ecash token detail on NIP-60 spending history (kind 7376)

NIP-60 defines a spending-history event whose `content` is a NIP-44 sealed
array of tag-shaped entries: `direction`, `amount`, `unit`, and `e` references
to the token events created and destroyed by the change.

NostrFeed adds three optional entries to that sealed array, written only for a
change that hands out an ecash token:

| entry   | value                                             |
| ------- | ------------------------------------------------- |
| `token` | the cashu token string produced by the send       |
| `memo`  | the note written on that token, when there is one |
| `mint`  | the mint that will honour it                      |

```jsonc
// Decrypted content of a kind 7376 event, for a 21 sat send
[
  ["direction", "out"],
  ["amount", "21"],
  ["unit", "sat"],
  ["e", "<token-event-id>", "", "created"],
  ["e", "<token-event-id>", "", "destroyed"],
  ["token", "cashuB..."],
  ["memo", "coffee"],
  ["mint", "https://mint.example"]
]
```

### Why

A cashu token is a bearer string. The moment it is cut, the proofs behind it
leave the wallet's balance — so nothing in the NIP-60 token events (kind 7375)
mentions them any more, and the spec's history entry records only that some
amount went out.

That is enough to draw a transaction list, and not enough to do anything about
an unclaimed token. If nobody redeems it, the only way to recover the sats is
to redeem it yourself, which requires the string. Keeping that string only in
the browser that produced it means logging in anywhere else shows the money
gone with nothing to show for it.

### Compatibility

The entries live inside the sealed array, alongside NIP-60's own. A client that
does not know them ignores them, exactly as it would ignore any unrecognised
entry; nothing about the spec's fields changes. The unencrypted tags are
untouched — they still carry only the `redeemed` markers NIP-60 asks to be left
in the clear.

### On writing bearer money to relays

The token is the money, and this puts a copy of it on relays. It is sealed with
NIP-44 to the author's own key, which is the same protection NIP-60 already
applies to the proofs in kind 7375 — those are bearer secrets too. A wallet
that backs up its balance but not the tokens it has handed out is not safer for
the omission; it just loses the unclaimed ones.

## Subscription tiers (kind 37001) — an unmerged draft

NostrFeed publishes subscription tiers as **kind 37001**, following the
unmerged "recurring subscriptions" pull request against the NIPs repository.

**This is not NIP-88.** NIP-88 is Polls (kinds 1068 and 1018). The subscription
draft is frequently mislabelled as NIP-88 in secondary documentation; kinds
37001 and 7001 appear nowhere in the NIPs list. The number is used here because
it is the only convention that exists and it is what zap.stream implements —
but nothing about it is settled, and a future NIP could claim 37001 for
something else.

### Tier

```
{
  "kind": 37001,
  "tags": [
    ["d", "gold"],
    ["title", "Gold"],
    ["amount", "5000", "monthly"],
    ["description", "Everything, a week early"],
    ["perks", "Early access", "Direct messages"],
    ["image", "https://…"],
    ["alt", "Subscription tier: Gold — 5000 sats per month"]
  ]
}
```

`amount` is whole satoshis, with the period as its second value: `weekly`,
`monthly` or `yearly`. An unrecognised period is read as monthly rather than
dropping the tier. A tier without a usable amount is refused entirely, because
that number becomes an invoice.

### What we do not publish

The draft also defines a kind 7001 subscription event and cancellation by
deletion. NostrFeed publishes neither, and the omission is deliberate.

**A subscription is a zap to the tier.** The receipt — kind 9735, signed by the
creator's own lightning server, carrying the tier's `a` coordinate and a
readable amount — is the whole record. A kind 7001 declares an intention and
proves no payment; a deletion cancels the declaration and stops no money.
Paying is the only act with meaning, and not paying again is the only
cancellation that works.

That choice has three consequences worth stating:

- **Status is computed, not stored.** A subscriber is active if their most
  recent payment of at least the tier price is inside the period it bought.
  Payments below the price count as tips and buy no time; a creator who priced
  a tier at 5,000 sats did not price it at whatever somebody felt like.
- **Anyone can verify.** The creator gating something, the subscriber checking
  their standing, and a third party auditing either reach the same answer from
  the same public receipts. There is no membership table to trust.
- **It cannot be forged**, for the same reason a zap total cannot: a receipt
  the recipient's own lnurl provider did not sign is refused.

### On the word "subscription"

Nothing in this client charges anybody on a schedule, and the interface says
so rather than implying otherwise. A browser tab that is closed pays nothing,
and NIP-47 has no scheduling primitive — a wallet budget is a spending cap, not
a standing order. Each payment buys one period; renewal is a person deciding
again.
