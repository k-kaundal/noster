# LNbits integration

NostrFeed's wallet is backed by our own LNbits instance at
**https://ln.nostrfeed.com**, pinned against **LNbits v1.5.6**.

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

## Not yet used

Available on the instance and worth building on later:

- **`/lnurlp`** — mint each user a lightning address on our domain, with
  `zaps: true` for NIP-57. This would let people receive zaps at
  `name@nostrfeed.com` without running anything themselves.
- **`/nostrnip5`** — sell or grant NIP-05 identifiers on our domain.
- **`/api/v1/ws/{item_id}`** — websocket for live payment updates, which would
  replace the current 30-second balance poll.
