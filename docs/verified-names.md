# Verified names (NIP-05)

`alice@nostrfeed.com` means two entirely different things depending on which
field of a profile it sits in, and the app now issues both. They are separate
products, separate LNbits extensions, and only one of them costs money.

|                | Lightning address              | Verified name                  |
| -------------- | ------------------------------ | ------------------------------ |
| Spec           | LUD-16                         | NIP-05                          |
| Profile field  | `lud16`                        | `nip05`                         |
| What it does   | Receives zaps                  | Puts a ✓ next to someone        |
| Resolved at    | `/.well-known/lnurlp/alice`    | `/.well-known/nostr.json?name=alice` |
| LNbits ext.    | `lnurlp`                       | `nostrnip5`                     |
| Price          | Free                           | **Sold by the year**            |
| Expires        | Never                          | Yes — `expires_at`, then it stops verifying |
| Docs           | [lightning-addresses.md](./lightning-addresses.md) | this file |

The ✓ other clients render comes from `nip05`, not from `lud16`. Before this,
the app claimed a pay link username and published it as `lud16` — which is why
nobody's name was ever verified, however many addresses were issued.

## One name, two tiers

The wallet page used to show these as two unrelated cards. They are one thing
at two tiers, and `src/lib/identity.ts` models it:

| Tier | What they have | What it does |
| --- | --- | --- |
| `none` | nothing | the claim form, pre-filled |
| `free` | a lightning address | receives zaps, never expires, no ✓ |
| `verified` | a NIP-05 name they paid for | the identity, plus zaps at the same name |

Someone with no name at all is offered one derived from their profile name, or
from their key when they have no profile — `genUserName`, so it is stable. A
suggestion that changes between two looks at the same page reads as a bug.

Buying a name does not silently move the money. A wallet accumulates one pay
link per name ever claimed, so `pickPrimaryLink` prefers the link matching the
verified name and the card offers to issue one at the new name when they
differ — the old link keeps working, because payments already in flight to it
should not bounce.

Both profile fields are written in **one** kind 0 event (`withIdentity`).
Publishing them separately means two signatures, two relay round trips, and a
window where the profile claims a name it cannot be paid at.

A name whose invoice has not settled is deliberately not treated as an
identity. Publishing it would advertise a `nip05` that fails to verify, which
shows as a broken checkmark on every note.

## Articles need one

Long-form publishing (`/write`) is gated on the `verified` tier. Articles carry
more weight than notes and stay addressable forever, and a name someone paid
for is the cheapest honest signal that there is a person behind one.

The gate only applies where names are actually for sale — with no
`VITE_NIP5_DOMAIN_ID` configured, nobody could ever pass it, so everyone
writes. A feature nobody can reach is worse than an ungated one.

Note that this gates on a name reserved **here**, not on any `nip05` in a
profile. Someone verified at their own domain is turned away. That is what
"paid users" means, but it is a real trade — say so if you want it widened.

## The yearly price is the server's, not ours

`nostrnip5` prices a name by character count, by rank, by promo code, and it can
hand out a fixed number for free. Which rule applied is returned with the
availability answer:

```
GET /nostrnip5/api/v1/domain/{domain_id}/search?q=alice&years=1
→ { identifier, available, price, price_in_sats, price_reason, currency,
    free_identifier_number }
```

`src/lib/nip5.ts` deliberately does no price arithmetic. Anything computed here
would be a second opinion that disagrees with the invoice — the fiat figure is
what was quoted, `price_in_sats` is what the invoice will ask for, and that
converts at quote time.

## Buying one

```
POST /nostrnip5/api/v1/user/domain/{domain_id}/address
     { domain_id, local_part, pubkey, years, create_invoice: true }
→ the address, plus a bolt11 to pay

GET  /nostrnip5/api/v1/domain/{domain_id}/payments/{payment_hash}
→ polled until it settles; the name is inactive until then
```

The `pubkey` sent is the **Nostr key signed in to this app**, not the key the
LNbits account was created with. Those can differ — someone who reached their
wallet with a username and password may hold it under another key — and a name
verifying the wrong key is a name that does nothing. The card says so when it
happens rather than fixing it silently.

Then, as with the lightning address, the app publishes it into the user's
**kind 0 `nip05`**. Verification is something readers do against the profile;
our server cannot assert it on anyone's behalf.

## One name doing both jobs

An address can carry a lightning address of its own:

```
PUT /nostrnip5/api/v1/user/domain/{domain_id}/address/{address_id}/lnaddress
    { wallet, min, max }
```

That is the "Enable zaps" button on the card. It is optional and separate from
buying the name, because verifying who someone is and taking money for them are
different things and the extension only does both when asked.

## Configuration

```
VITE_NIP5_DOMAIN_ID=   # the first domain's id in the nostrnip5 extension
VITE_NIP5_DOMAIN=      # defaults to VITE_LIGHTNING_ADDRESS_DOMAIN
VITE_NIP5_DOMAINS=     # any others, as `id:hostname` pairs
```

Both halves have to be configured because neither can be discovered.
`GET /nostrnip5/api/v1/domains` and `GET /nostrnip5/api/v1/domain/{id}` both
want a wallet key — and a visitor's own key answers for their account, not the
operator's, so it would list nothing. The one public route, `search`, returns
the local part alone with no hostname in the reply. Take the id from the URL of
the domain's page in the extension.

Several domains are written as pairs, separated by commas or spaces:

```
VITE_NIP5_DOMAINS=1f3c…:nostrfeed.com, 9ab2…:zap.example
```

Either order works — the half with a dot in it is read as the hostname. The
first domain is the default: it is what the buy form opens on, and what a name
falls back to reading as. The rest are offered in a picker, and every one of
them needs its own `/.well-known/nostr.json` proxy rule (below) pointing at
**that** domain's id.

A user may hold names on any number of these, and several on one domain. Only
one of them can go in the profile's `nip05` — the card lets them pick which.

**Left blank, the whole card is hidden.** So is it when the extension answers
404, which is what an instance without `nostrnip5` installed does to every route
above. Advertising a name we cannot issue is worse than not offering one.

## Serving the well-known file

`alice@example.com` verifies by fetching
`https://example.com/.well-known/nostr.json?name=alice`. **The domain in the
name is the domain that must serve it** — the same constraint as lightning
addresses, and it needs its own proxy rule:

nginx:

```nginx
location = /.well-known/nostr.json {
    proxy_pass https://ln.nostrfeed.com/nostrnip5/api/v1/domain/<domain_id>/nostr.json$is_args$args;
    proxy_set_header Host ln.nostrfeed.com;
    add_header Access-Control-Allow-Origin *;
}
```

The CORS header is not optional here the way it is for lnurlp: clients fetch
`nostr.json` from the browser, so without `Access-Control-Allow-Origin` the
lookup fails in every web client while working fine in curl.

## Checklist

- [ ] `nostrnip5` extension installed and enabled
- [ ] A domain created in it, and its id in `VITE_NIP5_DOMAIN_ID`
- [ ] That domain's cost config set (free names, per-character prices, max years)
- [ ] `/.well-known/nostr.json` proxied, with CORS
- [ ] `VITE_NIP5_DOMAIN` set if it differs from the lightning address domain
- [ ] Any further domains in `VITE_NIP5_DOMAINS`, each with its own cost config
      and its own proxy rule

Verify by fetching `https://<domain>/.well-known/nostr.json?name=<name>` and
checking the `names` object maps the name to the right hex pubkey.

## Not verified from here

None of the request shapes above could be exercised against the live instance —
egress to `ln.nostrfeed.com` is blocked by this environment's network policy, so
they were written from the LNbits OpenAPI document. Response parsing is
deliberately tolerant (`readClaimedAddress`, `readPaymentHash` accept the
address either wrapped or bare), but the first real claim on a live instance is
worth watching in the network tab.

Renewal is the one gap: the extension's own flow for extending an existing name
was not modelled, so a name inside its renewal window shows how long is left but
has no button yet.
