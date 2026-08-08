# LNbits integration

NostrFeed's wallet is backed by our own LNbits instance, pinned against
**LNbits v1.5.6**.

## Configuration

Copy `.env.example` to `.env` and fill it in. `.env` is gitignored.

| Variable | Purpose |
| --- | --- |
| `VITE_LNBITS_URL` | Instance base URL. Defaults to `https://ln.nostrfeed.com`. |
| `VITE_LNBITS_WALLET_ID` | Optional house wallet id. |
| `VITE_LNBITS_INVOICE_KEY` | Invoice/read key for that wallet. Receive-only. |
| `VITE_NIP5_DOMAIN_ID` | Domain id in the `nostrnip5` extension. Blank hides verified names. |
| `VITE_NIP5_DOMAIN` | Domain those names read as. Defaults to the lightning address domain. |

### Why there is no admin key variable

**Vite inlines every `VITE_`-prefixed variable into the built JavaScript.**
There is no such thing as a secret build-time variable in a static site — the
value ends up in a file served to every visitor, viewable in devtools.

An LNbits **admin key can spend the wallet**. Putting one in `.env` would
publish it, and anyone who opened the site could empty that wallet. So the app
holds no admin key at all.

The **invoice key** is published too, but it can only create invoices and read
the balance. The consequences are that anyone can generate an invoice that pays
us, and anyone can see the house wallet's balance. That is an acceptable trade
for a wallet whose whole purpose is receiving; it would not be acceptable for a
wallet holding funds you care about keeping private.

Spending is done with the **signed-in user's own wallet**, authorised per user
through NIP-98 (below). Each user's admin key is fetched into memory from their
own session and never persisted, so no key is shared between users and none is
ever written to disk.

If the house wallet ever needs to *send*, that requires a server to hold the
admin key — a small proxy the SPA calls. It cannot be done from the browser
safely, whatever the deployment looks like.

The full OpenAPI spec is large and mostly extensions we don't use. This
documents only the surface `src/lib/lnbits.ts` depends on, so the client can be
reviewed against a fixed contract rather than against whatever the server
happened to return the day it was written.

## Authentication

`POST /api/v1/auth/nostr` — login with a NIP-98 signed event.

This is why the integration needs no passwords and no pasted API keys: the same
Nostr key that signs notes proves ownership of the wallet. The request carries
an `Authorization: Nostr <base64 kind-27235 event>` header, built by
`nostr-tools`' `nip98.getToken`.

The URL in the event's `u` tag must match exactly what the server sees. LNbits
validates it against its `nostr_absolute_request_urls` setting, so
**`https://ln.nostrfeed.com` must be listed there** or every login fails with a
401.

Also requires `nostr-auth-nip98` in the instance's `auth_allowed_methods`. It is
in `auth_all_methods` by default but **not** in `auth_allowed_methods`, which
defaults to `["user-id-only", "username-password"]`.

The response sets a session cookie and may also return `{access_token}`. Both
are handled: the cookie works when the app and LNbits are same-origin, the
bearer token covers the cross-origin case where the browser will not send a
third-party cookie.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/v1/auth` | Current account, including its wallets. 401 when signed out. |
| `POST /api/v1/auth/logout` | Ends the session. |

## Wallets

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `GET /api/v1/wallets` | Bearer | All the user's wallets |
| `POST /api/v1/wallet` | Bearer | Create one (`{name, wallet_type: "lightning"}`) |

Each wallet carries two keys:

- **`adminkey`** — can spend
- **`inkey`** — can create invoices and read balance, cannot spend

Neither is ever written to storage. They are fetched from the session on load
and kept in memory; the session token is what persists, because it can be
revoked server-side while a leaked admin key cannot.

`balance_msat` is in **millisatoshis**, as is everything else in LNbits'
internal accounting.

## Payments

| Endpoint | Auth | Notes |
| --- | --- | --- |
| `POST /api/v1/payments` | `inkey` to receive, `adminkey` to send | `{out: false, amount, unit: "sat", memo}` creates an invoice; `{out: true, bolt11}` pays one. **Amount is in sats here.** |
| `POST /api/v1/payments/lnurl` | `adminkey` | Pays a lightning address or LNURL with a comment. **Amount is in millisats here** — the unit differs from `/payments`, which is the easiest mistake to make in this API. |
| `GET /api/v1/payments` | `inkey` | Recent payments. `amount` is negative for outgoing. |
| `GET /api/v1/payments/{payment_hash}` | optional | Payment status |

`/payments/lnurl` matters for zapping: LNbits resolves the address and handles
the LNURL callback server-side, so a zap is one request instead of the three
round trips the browser would otherwise make.

### Errors

Failures arrive in three shapes depending on which layer rejected the request,
all normalised by `describeError`:

- `{detail: "..."}` — handled application errors
- `{detail: [{loc, msg, type}]}` — FastAPI request validation (422)
- `{success: false, message: "..."}` — extension endpoints

Statuses with a specific meaning: `401` not authorised, `402` insufficient
balance, `520` the Lightning node rejected the payment.

## Names

Two extensions issue `name@domain`, and they are not the same product:

- **`lnurlp`** gives every user a free permanent lightning address that
  receives zaps — [lightning-addresses.md](./lightning-addresses.md).
- **`nostrnip5`** sells NIP-05 verified names by the year, with an expiry, and
  that is what shows the ✓ — [verified-names.md](./verified-names.md).

## Not yet used

Available on the instance and worth building on later:

- **`/api/v1/ws/{item_id}`** — websocket for live payment updates, which would
  replace the current 30-second balance poll.

## Paid relay access

Two LNbits pay links sell write access to the NostrFeed relay, referenced by
id in `VITE_PREMIUM_MONTHLY_LINK` and `VITE_PREMIUM_LIFETIME_LINK`.

The links are configuration, not something the app creates. A pay link belongs
to the platform's own wallet, and creating one needs that wallet's admin key —
which cannot live in a static site. Make them once in LNbits, paste the ids.

### Enforcement lives at the relay, not here

This is the part worth being blunt about: **the app cannot grant access.** A
static site has no trustworthy place to keep an entitlement flag — whatever it
stores, the person holding the browser can change. `/premium` shows what was
paid and when; it does not unlock anything, and it says so.

The relay is the thing that accepts or rejects a write, so the relay is where
access has to be decided. Three ways to close that loop, in descending order of
how well they fit:

1. **LNbits `nostrrelay` extension.** It has paid relays built in:
   `RelaySpec.isPaidRelay` and `costToJoin`, a public
   `PUT /nostrrelay/api/v1/pay` that takes `{action, relay_id, pubkey}`, and a
   `NostrAccount` per pubkey carrying `paid_to_join` and `allowed`. The relay
   enforces payment itself and no reconciliation is needed. If
   `relay.nostrfeed.com` runs this extension, use it and delete most of the
   rest of this section.

2. **Pay link webhook → relay allowlist.** Set `webhook_url` on each pay link.
   LNbits calls it on payment; the handler reads the buyer's npub from the
   LNURL comment and writes them into the relay's allowlist. Needs a small
   service, and needs the comment to survive — see below.

3. **Reconcile by hand** from the LNbits payment list. Fine to start with,
   does not scale.

### The comment carries the buyer

A pay link is shared by everyone, so a payment is otherwise anonymous — LNbits
records that *someone* paid, not who. The app sends the buyer's npub as the
LNURL comment, which is what makes a payment attributable to an account.

**This only works if the link allows comments.** `comment_chars` defaults to
`0` on a new pay link, and LNbits rejects a comment longer than that. A link
created with the default accepts none, so every payment through it is
anonymous and option 2 above cannot work. Set `comment_chars` to at least 64
(an npub is 63 characters) on both links.

The app reads each link's `comment_chars` from
`GET /lnurlp/api/v1/links/public/{id}` and truncates to fit, sending nothing
rather than half an npub — a truncated npub identifies nobody and is worse
than no comment at all.

### Checklist

- [ ] Both pay links created, ids in `.env`
- [ ] `comment_chars` >= 64 on both links
- [ ] `webhook_url` set on both links, if using option 2
- [ ] Relay configured to enforce paid writes
- [ ] Relay's NIP-11 advertises `limitation.payment_required`, so `/premium`
      can tell users the truth about what the relay expects

## Card and PayPal subscriptions

LNbits brokers recurring fiat through its Fiat API. The plan lives with the
provider — a PayPal billing plan, a Stripe price — and LNbits charges it on
schedule, crediting the wallet named in the request.

`POST /api/v1/fiat/{provider}/subscription` takes a wallet API key, and that
key decides **who gets paid**. Created against the buyer's own wallet, a
subscription tops *them* up; created against ours, it buys access. So this
uses the house wallet from `VITE_LNBITS_WALLET_ID` and
`VITE_LNBITS_INVOICE_KEY` — a receiving key, which is the most that can live
in a static bundle.

A card payment carries no Nostr identity, so the request sends
`subscription_request_id` as `nostrfeed-<plan>-<npub prefix>` and repeats the
full npub in the memo. That is what makes a PayPal subscription attributable
to an account, the same problem the LNURL comment solves for sats.

`GET /api/v1/auth` returns `fiat_providers` for the signed-in account, and the
app hides the button for providers not in that list. LNbits can restrict a
provider to particular users, and a button that leads to a refusal is worse
than no button.

### Server settings

In the LNbits admin settings:

- [ ] `paypal_enabled` true
- [ ] `paypal_client_id` and `paypal_client_secret` from the PayPal app
- [ ] `paypal_webhook_id` — without it LNbits cannot verify the callbacks that
      tell it a period settled, so nothing is ever credited
- [ ] `paypal_payment_webhook_url` pointing at
      `https://ln.nostrfeed.com/api/v1/callback/paypal`
- [ ] `paypal_limits.allowed_users` includes the house account, or is empty

Then create the billing plans in PayPal and put their ids in
`VITE_PREMIUM_MONTHLY_FIAT_PLAN` and `VITE_PREMIUM_LIFETIME_FIAT_PLAN`.

### Cancelling

`DELETE /api/v1/fiat/{provider}/subscription/{id}` is wired to the stored
request id. If LNbits expects its own subscription id there instead, the call
fails and the app says so and points the person at their PayPal account —
which cancels it regardless. Worth verifying against a live subscription
before relying on the in-app button.

## Account settings

The wallet page exposes the parts of `/api/v1/auth` that a person can act on:

- `PATCH /api/v1/auth` — username, and `extra.notifications.email_address` for
  payment notices. The account's login email is **not** settable here; the
  LNbits schema for `UpdateUser` has no email field, so it is fixed at
  registration or by the SSO provider.
- `PUT /api/v1/auth/password` — adds or changes a password. Worth offering:
  signing in with a Nostr key is the only way into the wallet otherwise, so a
  lost signer is a lost balance.
- `PUT /api/v1/auth/pubkey` — relinks the account to the Nostr key currently
  signed in. Offered only when the two disagree, which happens after switching
  Nostr accounts.
