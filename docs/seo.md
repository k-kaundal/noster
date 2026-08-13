# SEO, link previews and machine readers

This is a single-page app that fetches its content from Nostr relays in the
browser. That one fact decides everything below, so it is worth being blunt
about what follows from it.

## Who sees what

| Reader | Runs JavaScript | Sees per-page metadata |
| --- | --- | --- |
| Googlebot | yes | yes — `useSeo` applies before it snapshots |
| Bingbot | partly | usually |
| Twitter, Slack, Telegram, WhatsApp, Discord, iMessage | **no** | only what the served HTML says |
| GPTBot, ClaudeBot, PerplexityBot, CCBot | **no** | only what the served HTML says |

A single-page app serves the same `index.html` for every URL. So before this
work, every link to every page previewed as the site's front door — the front
door's title, description and image, whatever had actually been shared.

## What fixes it, and how far

### Static routes: fixed at build time

`scripts/seo-build.mjs` runs after `vite build`. For each entry in
`src/lib/siteRoutes.ts` it writes `dist/<route>/index.html` — a copy of the
built HTML with that route's title, description, canonical URL and card tags
substituted in. A static host serves that file before falling back to the SPA
rewrite, so a crawler is handed real metadata and the app still boots normally
for a person.

The same script writes `dist/sitemap.xml` and `dist/llms.txt` from the same
table, so the three cannot drift.

`src/lib/siteRoutes.ts` is the single source. It is plain data with no imports
because the build script compiles and imports it directly — **do not add
imports to that file.** Pages read it through `useRouteSeo('/path')`.

### Notes, profiles and articles: not fixed, and cannot be here

`/npub1…`, `/note1…`, `/naddr1…` have no build-time list — the content is on
relays and the set is unbounded. Their metadata is applied in the browser by
`useSeo`, which means:

- **Google indexes them properly.** It renders the page first.
- **A link shared into a chat app previews as the site, not the note.** No
  amount of client-side code changes this. Nothing that does not run
  JavaScript can see a tag written by JavaScript.

The only fix is a server that renders those tags per request: an edge function
matching `/npub1*`, `/note1*`, `/nevent1*` and `/naddr1*`, fetching the event
from a relay, and returning HTML with the tags filled in. That is a hosting
decision — Netlify Edge Functions, Cloudflare Pages Functions and a small
Node/Deno service in front of the static files can all do it, and a purely
static host (including Blossom or nostr-deploy) cannot do it at all.

If you add one, it needs: the relay to query, a short timeout with the generic
card as the fallback, and a cache — a preview fetcher will hit the same URL
several times in a few seconds.

## robots.txt

The NIP-19 routes used to be disallowed on the grounds that crawling them
finds an empty page. That reasoning cost more than it saved: Twitterbot,
Slackbot and LinkedIn all honour robots.txt, so the rule was not keeping thin
pages out of an index, it was suppressing the preview on every shared link to
a profile or article.

They are allowed now. What a page wants is decided by the page, through its
robots meta tag — which `useRouteSeo` sets from the `noindex` flag in the route
table, and which the build script bakes into the static HTML.

Signed-in areas (`/settings`, `/notifications`, `/chat`, `/bookmarks`,
`/wallet`, `/identity`) stay disallowed. They are also `noindex` and out of the
sitemap, but they keep their card tags: being unlisted and being unshareable
are different things.

## Machine readers

- **`llms.txt`** — generated at `/llms.txt` from the route table. A plain-text
  map of the site at a predictable path, which an assistant can read correctly
  where it cannot read a JavaScript application. It is a convention rather than
  a standard, and cheap enough to be worth following on that basis.
- **JSON-LD** — `src/lib/structuredData.ts` builds schema.org descriptions:
  `ProfilePage`/`Person` for a profile, `Article` for a long-form post,
  `SocialMediaPosting` for a note. These matter more here than on an ordinary
  site: the visible content arrives after the HTML, so a description of the
  page's subject is the only part that does not have to be inferred from prose
  that is not there yet.
- Every entity schema carries `isBasedOn: "nostr:<id>"` and the profile
  carries `sameAs: "nostr:<npub>"`, which say the page is one rendering of
  something that exists independently of this site.

## Adding a page

1. Add it to `SITE_ROUTES` in `src/lib/siteRoutes.ts`, with a description
   written for a search result rather than for the page — it has to make sense
   next to nine other results, to somebody who has never heard of this site.
   Under 160 characters, or Google cuts it mid-sentence.
2. Call `useRouteSeo('/your-path')` in the page component.
3. Mark it `noindex: true` if it is behind a login or is somebody's private
   business. It stays out of the sitemap and keeps its card tags.

Nothing else needs touching: the sitemap, the static HTML and `llms.txt` all
come from that entry.

## Checking it

```sh
npm run build           # includes the SEO step
cat dist/sitemap.xml
head -20 dist/services/index.html
cat dist/llms.txt
```

After deploying, the two that matter are what a crawler actually receives:

```sh
curl -s https://nostrfeed.com/services | grep -E 'og:(title|description)'
curl -sA 'Twitterbot' https://nostrfeed.com/premium | grep og:title
```

Validate the structured data with Google's Rich Results Test, and the cards
with the Facebook sharing debugger — both fetch the URL rather than rendering
it, which is exactly the case this work is about.
