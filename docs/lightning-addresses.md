# Lightning addresses for users

Every NostrFeed user can claim `name@domain` and be zapped from any Nostr
client. It is an LNbits `lnurlp` pay link pointing at their own wallet.

This is **not** the same as a NIP-05 verified name, which is written
identically, sold by the year, and is what puts a ✓ next to someone — see
[verified-names.md](./verified-names.md). This one is free, permanent, and only
moves money.

## How it fits together

```
someone zaps alice
        ↓
 alice@nostrfeed.com                    (LUD-16 address, from her kind 0 lud16)
        ↓
 GET https://nostrfeed.com/.well-known/lnurlp/alice
        ↓  (proxy — see "Domain" below)
 GET https://ln.nostrfeed.com/lnurlp/api/v1/well-known/alice
        ↓
 LNURL-pay response with allowsNostr + nostrPubkey
        ↓
 invoice paid → LNbits credits alice's wallet → publishes a kind 9735 receipt
```

Three things have to be true for that chain to work end to end. The app does
the first; the other two are server configuration.

## 1. The pay link — done by the app

`POST /lnurlp/api/v1/links` with the user's **own admin key**, held in memory
from their NIP-98 session. Two defaults in that API are traps:

- **`disposable` defaults to `true`** — a single-use link. An address that stops
  working after one payment is not an address. We always send `false`.
- **`comment_chars` defaults to `0`** — a zap carries its message as an LNURL
  comment. Left at zero, the address receives zaps but silently discards
  everything anyone wrote with them. We send 255.

`zaps: true` is what makes LNbits advertise `allowsNostr` and publish receipts.

The app then writes the address into the user's **kind 0 `lud16`**. Without that
step the address exists but nobody can zap them with it, because other clients
read the zap target from profile metadata, not from our database. The UI treats
an unpublished address as unfinished and says so.

## 2. Domain — a proxy rule you need to add

A lightning address `alice@example.com` is resolved by fetching
`https://example.com/.well-known/lnurlp/alice`. **The domain in the address is
the domain that must serve that route.**

### Option A — no setup (current default)

Leave `VITE_LIGHTNING_ADDRESS_DOMAIN` empty. Addresses are then issued on the
host in `VITE_LNBITS_URL` — `alice@ln.nostrfeed.com` for the default instance.
LNbits serves its own well-known route, so this works immediately with nothing
to configure, and it stays correct if the instance moves: the fallback is read
from the LNbits URL rather than written down a second time.

### Option B — addresses on the apex domain

Set `VITE_LIGHTNING_ADDRESS_DOMAIN=nostrfeed.com` **and** make nostrfeed.com
proxy the well-known path to LNbits. NostrFeed is a static site, so this is a
web-server or CDN rule, not application code.

nginx:

```nginx
location ~ ^/\.well-known/lnurlp/(.*)$ {
    proxy_pass https://ln.nostrfeed.com/lnurlp/api/v1/well-known/$1;
    proxy_set_header Host ln.nostrfeed.com;
}
```

Netlify (`_redirects`), status 200 to proxy rather than redirect:

```
/.well-known/lnurlp/*  https://ln.nostrfeed.com/lnurlp/api/v1/well-known/:splat  200
```

Cloudflare, Vercel and Caddy all have an equivalent. A **301/302 redirect works
with most wallets but not all** — some follow it, some treat the address as
broken. Proxy with a 200 if you can.

Do not switch the env var before the rule is live: every address issued after
the switch will be unreachable until it is.

## 3. Zap receipts — LNbits settings

`zaps: true` makes LNbits *claim* Nostr support. Publishing the kind 9735
receipt needs two more things on the instance:

- **`lnurlp` settings** need a `nostr_private_key`
  (`PUT /lnurlp/api/v1/settings`). Its pubkey is what appears as `nostrPubkey`
  in the LNURL-pay response, and it signs every receipt.
- **The `nostrclient` extension** must be enabled with relays configured, since
  that is what actually publishes the receipts.

Without these, zaps still *pay* — the sats arrive — but no receipt is published,
so the zap never appears on the note in any client. That failure is invisible
from the app's side, which is why it is worth checking directly after setup.

## Checklist

- [ ] `auth_allowed_methods` includes `nostr-auth-nip98`
- [ ] `nostr_absolute_request_urls` includes the LNbits URL
- [ ] `lnbits_allow_new_accounts` is true
- [ ] `lnurlp` extension enabled
- [ ] `lnurlp` settings have a `nostr_private_key`
- [ ] `nostrclient` extension enabled, with relays
- [ ] Well-known proxy rule live (only if using the apex domain)

Verify end to end by fetching
`https://<domain>/.well-known/lnurlp/<username>` and checking the response
contains `"allowsNostr": true` and a `nostrPubkey`.
