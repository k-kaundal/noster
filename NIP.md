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
