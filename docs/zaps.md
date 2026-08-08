# Zapping

## The bug this fixes

Zapping used `LightningAddress.zap()` from `@getalby/lightning-tools`, which
does all three steps — resolve the address, build the NIP-57 request, and
**pay** — and pays through `window.webln`.

So a browser extension was the only way to zap anything. The custodial wallet
this app hands out on the wallet page was ignored. Every NWC connection was
ignored — the `nwcConnection` argument was there in the signature, prefixed
with an underscore, unused. Without an extension the flow ended at
`"No wallet available"`, which reads as a bug in the app rather than an
instruction to install Alby.

## Producing the invoice, and paying it, are separate now

`src/lib/zapRequest.ts` does everything up to the invoice, and nothing after:

```
lud16 → lightningAddressUrl()      → https://domain/.well-known/lnurlp/name
      → fetchPayMetadata()          (src/lib/lnurlPay.ts, already existed)
      → buildZapRequest()           kind 9734, signed by the sender
      → zapCallbackUrl()            ?amount=&nostr=<signed>
      → the recipient's server returns a bolt11
```

`lud06` — a bech32 LNURL rather than an address — is rarer and needs a bech32
decode, so it falls back to `nip57.getZapEndpoint`, which nostr-tools already
does. No new dependency for the uncommon case.

Two details the pure functions exist to pin down, both covered by tests:

- An article is zapped by **coordinate** (`a`), a note by **id** (`e`), never
  both — a receipt carrying both attaches itself to two different things.
- The callback URL may already carry query parameters (LNbits' does), so
  parameters are appended rather than assumed to be first.

If the recipient's server does not advertise `allowsNostr`, the payment still
goes through as a plain LNURL payment — the author gets the money — but no
receipt is published, so it appears on no note. The dialog says so rather than
letting it look like a zap that vanished.

## Every wallet, listed

`usePayAnyWallet` enumerates what the person actually has, and the zap dialog's
second step is that list:

- the NostrFeed custodial wallet, with its balance
- **every** NWC connection, not only the one marked active
- a WebLN extension
- copy the invoice / scan the QR, which always works

Two fixes went in here. The NWC path read `connection.client` off the stored
connection — which never has one, since the client is built per payment — so
paying by NWC failed every time with "No wallet connected". And options are now
identified by `id` rather than by `method`, because someone with a spending
wallet and a savings wallet has two entries whose `method` is `nwc`, and
choosing one would have paid from whichever was marked active.

The preferred option is the custodial wallet when it can cover the amount,
since that is one tap with no approval prompt, and the next real wallet when it
cannot — rather than a highlighted button that fails on press.

## Not verified from here

The flow was not exercised against a live relay or LNURL server; this
environment has no egress to either. The parts that could be pinned down
without one — URL derivation, tag construction, callback assembly, amount
validation — are unit-tested.
