# Loading and perceived speed

Two separate problems, fixed separately: the browser had too much JavaScript to
get through before it could paint anything, and once it could paint, it had
nothing to paint until several relay round trips had finished.

## What the entry chunk was carrying

Measured from the build's own source map — `sourcesContent` bytes grouped by
package — not from guesswork.

| Removed from the entry chunk | Why it was there |
| --- | --- |
| `@getalby/sdk` (12 MB on disk) | `NWCProvider` mounts at the app root and statically imported `LN`. Now `import()`ed on first use, cached in a module promise. |
| `zod` (146 KB of source) | Validating five fields of the stored app config. Replaced by `parseAppConfig`, which does the same job and the two migrations by hand. |
| `date-fns` (55 KB) | Rendering "2h". Replaced by `src/lib/time.ts` over `Intl` — which the browser already has, and which localises, unlike date-fns without a locale import. |
| `qrcode` (71 KB) | Generating a data URL for the zap invoice. The SVG renderer already in the tree does it synchronously, so the code appears with the invoice instead of a beat later. |
| `vaul`, `qrcode.react`, the composers | Every note mounts a reply, zap, quote and report dialog. All four now load on first open, prefetched on idle. |
| `npm`, `install`, `framer-motion`, `node-emoji`, `dompurify`, `sanitize-html` | Nothing imported them. They cost nothing in the bundle and a great deal in `npm i`, which every one of this project's scripts runs first. |

Entry chunk: **779 KB → 484 KB** (237 → 147 KB gzipped).

Routes were already lazy. What was left was everything the home page reaches
transitively, which is most of the app's dialogs.

### Deferring a dialog without making the button feel broken

`src/hooks/useDeferredDialog.ts` is two small pieces:

- `useOnceOpened(open)` — true from the first open onward. Gating on `open`
  alone would unmount the dialog on close, losing its exit animation and
  anything half-typed.
- `useIdlePrefetch(load)` — starts the download on `requestIdleCallback`. Without
  it, deferring just moves the wait from first paint to the click, which is
  worse: a button that does nothing for 300 ms reads as broken.

## Painting before the network answers

Nostr starts slowly from nothing: a websocket per relay, a subscription, then a
lookup for every author in the result before a single name or avatar can be
drawn.

`src/lib/queryPersistence.ts` saves part of the query cache to localStorage and
restores it **synchronously, before React renders** — so the feed is on screen
at first paint and refreshes behind it. Built on the `dehydrate`/`hydrate` pair
already in `@tanstack/react-query`, not its separate persistence package.

What is kept, and what deliberately is not:

- **Kept**: `author` (the difference between a feed of names and a feed of grey
  circles), `feed`, `follows`, `relay-list`.
- **Not kept**: anything `lnbits-*`, because a stale balance must never be
  shown; `direct-messages`, which has no business surviving in plain text on a
  shared device.

Guards: a version stamp (a restored shape from an older build is how a cache
becomes a crash), a 24-hour age limit, and a 1.5 MB ceiling — over it, nothing
is written and that reader's next visit simply starts cold.

One trap this exposed: `NostrProvider` called `queryClient.resetQueries()` in an
effect keyed on the relay list, and effects also run on mount — so the restored
cache was being cleared before it could be shown. It now compares the relay key
against a ref and only resets on an actual change.

`useAuthor`'s `staleTime` went from 5 to 30 minutes, with a 24-hour `gcTime`.
People change their avatar a few times a year; a feed of thirty notes asks about
thirty profiles.

## Saying that something is happening

Painting instantly and refreshing silently makes a stale value look like a bug.
`LoadingBar` shows a sweep across the top of the page while anything is in
flight — after 400 ms, so fast queries don't make it flicker, and lingering 500 ms
after the last one so a burst of queries reads as one load rather than four
blinks. It is indeterminate on purpose: a relay query has no progress to report,
and a fake percentage stalling at 90% is worse than honest motion.

Two related fixes:

- A failed refresh on top of notes we already have is now a banner with a retry,
  not an empty state. Discarding a readable feed because the newest request
  timed out was the worse of the two outcomes.
- Note images hold a minimum height until they load, so a card no longer grows
  as each image lands and shoves the rest of the feed down the page.

## Not done

- The feed's 5-second query timeout is unchanged. Lowering it trades
  completeness for speed, and the trade could not be measured here — this
  environment cannot reach the relays.
- `recharts` (5.4 MB installed) is still a dependency for `components/ui/chart.tsx`,
  which nothing imports. It is tree-shaken out of the bundle, so it costs install
  time only, and removing a documented part of the component library was not
  part of this work.
- `WalletModal` still loads eagerly for signed-in users. It uses its children as
  a trigger, so deferring it needs a controlled `open` prop first.
- Every script in `package.json` begins with `npm i`. Dropping the junk
  dependencies made that much faster; not running it at all would be faster
  still.
