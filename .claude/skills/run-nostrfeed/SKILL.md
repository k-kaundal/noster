---
name: run-nostrfeed
description: Run, screenshot, and design-audit the NostrFeed web app. Use when asked to run/start/launch/serve NostrFeed, take screenshots of a screen, review or improve UI/UX, check a design in light and dark mode or on mobile, compare before/after of a visual change, or check contrast, tap targets, and layout overflow. Also covers building and testing the app.
---

# Running and reviewing NostrFeed

React 18 + Vite + TailwindCSS + shadcn/ui Nostr client. All paths below are
relative to the repo root (`/home/user/noster`).

**This container cannot install the app's own Nostr library.** `.npmrc` points
`@jsr:*` at `npm.jsr.io`, which returns 403 here for both metadata and
tarballs, so `@nostrify/nostrify` and `@nostrify/react` are installed as
`0.0.0-types-only-stub` — `.d.ts` files with **no runtime code**. Types are
enough for `tsc` and for most tests, which is why the test suite goes green
while the app cannot boot: the moment Vite resolves the *value* `NPool`, there
is nothing there.

So the app is run against fixture shims in `.claude/skills/run-nostrfeed/harness/`.
That is also what makes design review possible — screenshots of live relay data
are not comparable between runs.

## Prerequisites

Chromium ships with the container. Install the browser driver once — it must go
outside the project, because `npm i` in the project re-resolves the whole tree,
hits the unreachable jsr registry, and fails before installing anything:

```bash
mkdir -p /tmp/nostrfeed-pw && cd /tmp/nostrfeed-pw && \
  echo '{"name":"pw","private":true}' > package.json && npm i playwright-core
```

The driver finds it there automatically. Nothing else to install.

## Start the design server

Leave it running; the driver connects to it. From the repo root:

```bash
nohup npx vite --config .claude/skills/run-nostrfeed/harness/vite.design.mjs \
  > /tmp/vite-design.log 2>&1 &
sleep 8 && curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/
```

Expect `200`. It is signed in as a fixture account, so composers, Studio, the
wallet and notifications all render.

## Drive it (agent path)

```bash
# Screenshots -> design-shots/<route>.<viewport>.<theme>.png
node .claude/skills/run-nostrfeed/driver.mjs shots /studio /communities

# Every viewport and both themes
node .claude/skills/run-nostrfeed/driver.mjs shots / --all

# Design audit: contrast, tap targets, overflow, alt text, control names
node .claude/skills/run-nostrfeed/driver.mjs audit /studio /wallet --all

# Click through to state that has no URL — dialogs, tabs, popovers
node .claude/skills/run-nostrfeed/driver.mjs flow /communities "Relay Operators"
```

Flags: `--viewports mobile,tablet,desktop` · `--themes light,dark` · `--all`
(mobile+desktop × light+dark) · `--full` (full-page) · `--signed-out` ·
`--console-all`.

`audit` exits non-zero when it finds anything, so it works in a loop.

**Always open the PNG and look at it.** A green audit on a blank page is still
a blank page.

`flow` takes a route then any number of things to click. Bare text matches a
visible label; a string starting with `.`, `#` or `[` is a CSS selector.

### Real output

```
$ node .claude/skills/run-nostrfeed/driver.mjs audit /studio --viewports mobile --themes dark
/studio  [mobile · dark]
  ✗ low-contrast: 1 distinct low-contrast text style(s)
      30 days (3.94:1, needs 4.5)

1 finding(s).
```

Standing findings as of writing — real, in the app, not harness artifacts:
`DISCOVER` sidebar label 2.74:1 in light mode; the notification badge `18`
3.28:1; `text-primary` on `bg-card` 4.23:1 in dark; the Studio period toggle
3.94:1.

## Test and build

```bash
npx tsc -p tsconfig.app.json --noEmit && npx tsc -p tsconfig.api.json
npx eslint
npx vitest run
```

`npm test` and `npm run build` **do not work here** — both start with `npm i`,
which fails on the jsr 403. `vite build` also fails, for the stub reason above.
`src/App.test.tsx` and `src/components/NoteContent.test.tsx` fail to collect for
the same reason; every other suite passes. That is the expected baseline —
1800+ tests pass, 2 suites fail to load.

## Gotchas

- **`/opt/pw-browsers/chromium` is a symlink to the binary**, not to a
  directory. `<that>/chrome-linux/chrome` fails with "Not a directory".
- **`page.evaluate(<string>)` evaluates an expression.** Passing an arrow
  function's source returns the function object, which does not serialise —
  you get `undefined`, not a call. Wrap it: `` page.evaluate(`(${SRC})()`) ``.
- **`networkidle` never fires.** TanStack Query refetches on a timer and the
  app keeps sockets open. The driver waits for `#root` to have children plus a
  fixed settle instead.
- **Contrast maths must composite alpha.** This app tints with `bg-repost/5`
  and `text-repost/70`; reading raw RGB off a 5%-opacity layer reports green
  text on a green background at exactly `1.00:1`. If you see `1.00:1`, the
  checker is broken, not the design.
- **The 32px tap-target rule only runs under 900px wide.** It is a touch
  guideline; applying it to desktop flagged ~50 elements per page and buried
  everything real.
- **Console is full of `ERR_TUNNEL_CONNECTION_FAILED`.** The container has no
  outbound network, so every relay socket fails. Filtered by default;
  `--console-all` to see them.
- **Vite must be started with `--config`**, not `-c` plus the base config —
  the design config *extends* `vite.config.ts` so the harness cannot drift from
  how the app really builds.
- Screenshots land in `design-shots/`, which is gitignored.

## Extending the fixtures

`harness/fixtures.mjs` builds every event at import time with **real
signatures** (via `nostr-tools`, a genuine npm package) from a fixed seed — so
reruns are byte-identical, and zap receipts survive the app's own NIP-57
validation. Fake signatures would render as a wall of "not counted".

To make a screen show something it currently doesn't, add events there. To add
a *new* nostrify export the app starts importing, add it to `harness/nostrify.mjs`
(or `react-login.mjs` / `uploaders.mjs`); the current surface was found with:

```bash
grep -rhn "from '@nostrify/[^']*'" src/ --include=*.ts --include=*.tsx | sort -u
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `browserType.launch: executable doesn't exist` | Use `/opt/pw-browsers/chromium` exactly, or set `CHROMIUM_PATH`. |
| `playwright-core not found` | Run the Prerequisites install; or set `NOSTRFEED_PW` to its path. |
| `No known conditions for "./login" in @nostrify/react` | You started plain `npx vite`. Use `--config .claude/skills/run-nostrfeed/harness/vite.design.mjs`. |
| `403 Forbidden - GET https://npm.jsr.io/...` | Expected. Never run `npm i` in this project here. |
| Blank screenshot / `waitForFunction` timeout | Check `/tmp/vite-design.log` and `curl http://127.0.0.1:8080/`; re-run with `--console-all`. |
| `Cannot read properties of undefined (reading 'findings')` | The `page.evaluate` string was not wrapped in `(...)()`. |
| Port 8080 in use | `pkill -f vite.design` then restart. |
