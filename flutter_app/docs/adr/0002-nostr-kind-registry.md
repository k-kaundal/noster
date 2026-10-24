# ADR-0002: Nostr kind registry + use-case layer

**Status:** Accepted · **Date:** 2026-10-22

## Context

Kind numbers were magic literals scattered across features: `37001` in
memberships, `9041` in studio, `kind: 5` for deletions in two places,
`kind == 9735` in zap code. A reader needed the NIPs repo open to know what
a filter matched, and a typo in one place was invisible.

## Decision

1. **`core/nostr/kinds.dart`** — the kind registry (nostr-tools `kinds.ts`
   pattern): a named constant for every kind the app publishes or reads,
   plus NIP-01 classification (`isReplaceable`, `isEphemeral`,
   `isAddressable`, `isRegular`). Kind literals in features migrate here.
2. **One generic `NostrEvent`** (not a sealed class per kind). Nostr has
   200+ kinds and growing; a class hierarchy can't keep up and handles
   unknown kinds badly.
3. **Use-case organization** (NDK Dart pattern): protocol code organized
   per domain (notes/profiles/dms/zaps/lists/relays), NOT per NIP number —
   a use case like DMs spans NIP-04, NIP-17, NIP-44, NIP-59.

## Consequences

- A number with a name: `NostrKinds.deletion` instead of `kind: 5`.
- Feature-local protocol constants delegate to the registry
  (`const zapReceiptKind = NostrKinds.zapReceipt`) so existing references
  keep working.
- Unknown kinds degrade gracefully (generic event + tag accessors).

## Alternatives considered

| Alternative | Rejected because |
|---|---|
| Sealed class per kind (Quartz/Amethyst pattern) | 200+ kinds, growing; unknown kinds crash or fall through. Kotlin's open-class idiom doesn't map well to Dart. |
| Per-NIP packages (one module per NIP number) | Fragments what the app actually does across dozens of tiny packages; use cases map to user actions, not spec numbers. |
