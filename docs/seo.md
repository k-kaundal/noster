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

### Notes, profiles and articles: served by a function

`/npub1…`, `/note1…`, `/nevent1…`, `/naddr1…` have no build-time list — the
content is on relays and the set is unbounded. `useSeo` fills their tags in
once the app boots, which is enough for Google and enough for nothing else:
anything that does not run JavaScript cannot see a tag written by JavaScript.

`api/preview.ts` fixes it on the server. `vercel.json` routes those paths to
it; it decodes the identifier, fetches the event from a relay, writes the
title, description and image into the HTML and serves that. Everything about
it degrades to the page as it was — a relay that does not answer, an
identifier that does not decode, an event that does not exist — because a
preview is worth a round trip and is never worth a blank page.

It replaces the generic tags rather than adding to them. Two `og:title` tags
is not "the more specific one wins"; it is undefined, and several fetchers
take the first.

The pure parts — identifier decoding, card building, tag injection — are
tested in `api/preview.test.ts`, including against a real `naddr` from the
site. The bech32 and TLV reading is written out rather than imported so the
function stays dependency-free on a host that bills by the millisecond.

### Articles, also baked at build time

`scripts/seo-build.mjs` additionally queries relays during the build for
recent long-form posts and writes `dist/<naddr>/index.html` for each, the same
way it does for static routes. That covers article previews on any static host
with no function involved, and it is what keeps working if the site ever moves
off a host that can run one. It goes stale between builds and cannot cover
notes, so it complements the function rather than replacing it.

## Hosting

The site is on **Vercel**, which is what `vercel.json` is for and why it
matters more than it looks:

- **Without it, every one of these routes returned HTTP 404.** Vercel serves
  `dist/404.html` for a path that matches no file, and the build copies
  `index.html` there — so the app booted and a person saw the article while
  every crawler was told the page did not exist. A 404 is not a thin preview,
  it is no preview, and no index entry either. The `rewrites` make the SPA
  fallback a 200.
- **`public/_headers` and `public/_redirects` do nothing on Vercel.** They are
  Netlify and Cloudflare Pages formats. They are kept because they are correct
  for those hosts and cost nothing, but the rules that are actually applied
  are the ones in `vercel.json`, and the two have to be changed together.

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
