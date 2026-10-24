# NSFW / Adult Content Filtering Research for a Nostr Mobile Client

Compiled 2026-10-21. Covers: NIP-36 spec, client moderation approaches, moderation services/APIs with endpoints, multilingual wordlists, evasion-resistant normalization, and Google Play / Apple App Store compliance.

---

## 1. NIP-36 — Sensitive Content / Content Warning (spec summary)

Source: https://nips.nostr.com/36 (status: draft, optional; created 2022-12-01, updated 2023-11-18)

**Core mechanism:** a single event tag `content-warning` with one optional parameter, the reason:

```
tag: content-warning
options:
 - [reason]: optional
```

**Semantics:** the tag marks that the event's content "needs to be approved by readers to be shown." Clients can (and app-store-compliant clients should) hide/blur the content until the user takes an explicit action (tap to reveal). There is no controlled vocabulary for the reason — free-form strings like `"nsfw"`, `"nudity"`, `"spoiler"` are all in use.

**Optional NIP-32 labeling interop:** `l`/`L` tags MAY be used with the `content-warning` namespace (or `social.nos.ontology`) for machine-queryable qualification:

```json
{
  "kind": 1,
  "tags": [
    ["t", "hastag"],
    ["L", "content-warning"],
    ["l", "reason", "content-warning"],
    ["L", "social.nos.ontology"],
    ["l", "NS-nud", "social.nos.ontology"],
    ["content-warning", "<optional reason>"]
  ]
}
```

- NIP-71 (video) also defines an optional `content-warning` tag for NSFW video: https://github.com/nostr-protocol/nips/blob/master/71.md
- Known gap (open issue): there is no standard for marking *profile metadata* (kind 0 avatar/banner/display name) as explicit — https://github.com/nostr-protocol/nips/issues/315. This is exactly why username/profile filtering must be done client-side with wordlists/classifiers (see §5).

**Related protocol pieces a compliant client should also implement:**

- **NIP-56 Reporting** (https://nips.nostr.com/56): `kind 1984` report events. MUST have a `p` tag (reported pubkey); an `e` tag if reporting a note; the 3rd tag entry is a report type: `nudity`, `malware`, `profanity`, `illegal`, `spam`, `impersonation`, `other`. Suggested client behavior: e.g. "if 3+ of your friends report a profile for nudity, blur photos from that account."
- **NIP-51 Lists** (https://nips.nostr.com/51):
  - Mute list = `kind 10000` — expected items: `"p"` (pubkeys), `"t"` (hashtags), `"word"` (lowercase string), `"e"` (threads). Items can be public (tags) or private (NIP-44-encrypted JSON in `.content`).
  - Blocked relays = `kind 10006`; Kind mute sets = `kind 30007`; Follow sets = `kind 30000`.
  - Shared mute lists are just another user's public kind-10000 event — clients can let users "subscribe" to someone else's list (Primal does exactly this).

---

## 2. How existing Nostr clients handle NSFW

- **Primal (iOS/Android/Web)** — the most developed system. In Sep 2023 Primal shipped a moderation suite: opt-in/opt-out filter lists, subscribing to other users' mute lists, and "never filter" allowlists; trending feeds moved to a Web-of-Trust "human-ness" score. Source: https://www.nobsbitcoin.com/primal-moderation-system/ . The whole backend is open source:
  - `PrimalHQ/primal-server` (MIT, OCaml): https://github.com/PrimalHQ/primal-server — caching/membership/discovery/media services; WebSocket cache API (default `wss://cache.primal.net` style, self-host `ws://127.0.0.1:8801`). The `jobs/` daemon computes **TrustRank** ("TrustRank spreads trust from the seed accounts over the follow graph; it runs when primal-jobs starts and then hourly. An event's score counts the reactions, replies, reposts and zaps of accounts TrustRank ranks above the humaness threshold").
  - Trust seeds: `selfhost/trust-seeds.txt`; API calls listed in `api/lib/funcall.ml`, e.g. `["REQ","sub",{"cache":["feed",{"pubkey":"..."}]}]`, `["cache":["user_infos",...]]`.
  - Older Julia version archived: https://github.com/PrimalHQ/primal-caching-service
- **Damus (iOS)** — honors NIP-36 content warnings (blur + tap-to-reveal), mute lists, reporting. It is a pure client: moderation is client-side (mute lists, reports, relay choice). https://github.com/damus-io/damus
- **Amethyst (Android)** — has a Security-filter screen with a **Content Sensitivity setting**, NIP-56 Report Post/Report Account ("Illegal Content" reason), Block Post/Account, **Block Relay** (NIP-51 kind 10006), Mute Words/Hashtags. Its Google Play compliance doc is a useful template: https://github.com/vitorpamplona/amethyst/blob/main/PRIVACY.md
- **Nostur (iOS/macOS)** — "Detect nsfw / content-warning in posts," plus Web-of-Trust-based "show more" gating for reactions/zaps outside your WoT.
- **nostr-filter-relay (atrifat)** — relay-side ML filtering anyone can run or point a client at: https://github.com/atrifat/nostr-filter-relay (MIT). Classifies kind-1 notes for **SFW/NSFW** (text + image URL via NsfwSpy model), **language**, **hate speech**, sentiment, topic; publishes results as **NIP-32 kind 1985 label events**; the relay then serves filtered results. Public demo relay: `wss://nfrelay.app`. Component APIs (self-hostable):
  - https://github.com/atrifat/nsfw-detector-api
  - https://github.com/atrifat/language-detector-api
  - https://github.com/atrifat/hate-speech-detector-api
  - https://github.com/atrifat/nostr-monitoring-tool

---

## 3. Concrete moderation services / APIs a client can query

### 3.1 nostr.wine APIs (free tier: 1 req/sec) — docs: https://docs.nostr.wine/

- **Classification API** (most directly useful):
  `GET https://api.nostr.wine/classification?nsfw=true|false&language=english&topic=...&sentiment=...&pubkey=<hex>&since=&until=&limit=&page=&order=`
  Returns kind-1 events each annotated with `classification: {language, nsfw: bool, sentiment, topics[], urls[][]}`. Caveat from the docs: "not currently classifying new events"; historically only events on the paid nostr.wine relay were classified. Still a working reference design for a classification API shape.
- Search: `GET https://api.nostr.wine/search?query=&kind=` (NIP-50-like REST).
- Trending: `GET https://api.nostr.wine/trending?hours=&order=replies|reposts|reactions|zap_count|zap_amount&limit=`
- **filter.nostr.wine relay** (`wss://filter.nostr.wine`, NIP-42 auth, 10,000 sats/mo): aggregates the public network; global feed defaults to *follows + follows-of-follows* (Web-of-Trust spam reduction); `?global=all` gives everything behind only a basic spam filter. Readme: https://nostr-wine.github.io/filter-relay/

### 3.2 nostr.band (Nostr.Band) — search/stats + TrustRank spam filtering

- Public API announced at `https://api.nostr.band` (trending profiles, profile/event stats). Source: https://x.com/NostrBand ("UPDATE: We've launched an API api.nostr.band ..."). Nostr.Band also powers Amethyst's search. (api.nostr.band was unreachable during research; treat endpoint paths as unverified.)
- **TrustRank** spam filtering: public spam-free relay `wss://relay.nostr.band/trusted` — "all spam is hidden using TrustRank" (same source). A client can simply *read global feeds from this relay* instead of querying an API — the cheapest integration.

### 3.3 Primal caching-service API (open source, self-hostable)

- WebSocket API, e.g. `["REQ","id",{"cache":["user_infos",{"pubkeys":[...]}]}]`, `{"cache":["feed",...]}`, `{"cache":["net_stats"]}`. TrustRank scores computed hourly from trust seeds. MIT: https://github.com/PrimalHQ/primal-server

### 3.4 atrifat classification stack (self-host)

- See §2. NSFW/language/hate-speech/sentiment/topic classification as HTTP APIs feeding a filtered relay (`wss://nfrelay.app` demo). MIT.

### 3.5 Image-level NSFW detection (for avatars, banners, note images)

- **NsfwSpy.js** (used by atrifat's nsfw-detector-api) and **NSFWJS** (https://nsfwjs.com/) — TensorFlow.js models that can run **on-device** (good for a mobile client: classify avatar/banner/note images locally before unblurring, no server needed, no privacy leak).

---

## 4. Open-source multilingual NSFW / profanity wordlists

### 4.1 LDNOOBW — "List of Dirty, Naughty, Obscene, and Otherwise Bad Words" ⭐ (the canonical one)

- URL: https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words
- Origin: Shutterstock's production autocomplete/recommendation filter list.
- License: **Creative Commons Attribution 4.0 (CC-BY-4.0)** — commercial use OK with attribution. © 2012–2020 Shutterstock.
- **28 languages** (one file per language code): Arabic (ar), Chinese (zh), Czech (cs), Danish (da), Dutch (nl), English (en), Esperanto (eo), Filipino (fil), Finnish (fi), French (fr), French-CA, German (de), Hindi (hi), Hungarian (hu), Italian (it), Japanese (ja), Kabyle (kab), Klingon (tlh), Korean (ko), Norwegian (no), Persian (fa), Polish (pl), Portuguese (pt), Russian (ru), Spanish (es), Swedish (sv), Thai (th), Turkish (tr).
- npm wrapper: `naughty-words` (https://github.com/LDNOOBW/naughty-words-js); PHP: `vasart/naughty-words` (Packagist).
- Note: lists are短 (tens-to-hundreds of words per language) and curated for "what we wouldn't suggest," not exhaustive NSFW detection — combine with a classifier for note text.

### 4.2 google-profanity-words (coffee-and-fun, ex-RobertJGabriel)

- URL: https://github.com/coffee-and-fun/google-profanity-words — "Full list of bad words and top swear words banned by Google," packaged as a Node.js `ProfanityEngine` with severity levels (mild/moderate/severe) and custom wordlists; multilingual. Actively maintained (releases through 2025).
- Companion explicit list: https://github.com/RobertJGabriel/List-Of-Explicit-Words (explicit search terms from SEO blacklists + Google Profanity API).

### 4.3 zautumnz/profane-words + better-profane-words

- https://github.com/zautumnz/profane-words — semi-comprehensive English profanity list (README points to `better-profane-words` for an enhanced list with categorization + intensity classification).

### 4.4 Jenyay/Obscene-Words-List

- https://github.com/Jenyay/Obscene-Words-List — obscene words in different languages; explicitly solicits non-English contributions.

### 4.5 glin-profanity (library + bundled 24-language dictionaries) ⭐ best turnkey option

- URL: https://github.com/glincker/glin-profanity — MIT, JS/TS (npm `glin-profanity`, 12 KB core, runs offline in browser/edge) **and** Python (PyPI). Bundled dictionaries for 24 languages: Arabic, Chinese, Czech, Danish, Dutch, English, Esperanto, Finnish, French, German, Hindi, Hungarian, Italian, Japanese, Korean, Norwegian, Persian, Polish, Portuguese, Russian, Spanish, Swedish, Thai, Turkish. Built-in leetspeak levels and Unicode homoglyph normalization (see §5), optional TensorFlow.js toxicity model, benchmarked F1 80.6% with 0.0% false positives vs bad-words' 54.2% F1.
- ("shyiko" from the request does not exist as a profanity-wordlist author — likely a misremembering of Shutterstock/LDNOOBW or robertjgabriel.)

### Practical bundle recommendation

`LDNOOBW (28 langs, CC-BY)` for wordlists + `glin-profanity` for matching/normalization, + an on-device image model (NSFWJS/NsfwSpy) for media, + relay/service-level signals (NIP-36 tags, NIP-56 reports, Primal TrustRank, nostr.wine classification, nostr.band TrustRank relay).

---

## 5. Username / display-name filtering: normalization vs. evasion

**Why naive substring matching fails** (sources: https://cleanspeak.com/help-center-article/leet-speak-filtering-methods, https://apiverve.com/marketplace/usernameprofanity/learn/username-moderation-challenges):

1. **Leetspeak**: `f4ck`, `5h1t`, `@$$`, `ph.u" "ck` — char substitution, insertion, and spacing defeat literal matching.
2. **Unicode homoglyphs / confusables**: `fսck` (Armenian `ս` U+057D → u), `shіt` (Cyrillic `і` U+0456 → i), `ƒuck` (Latin `ƒ` U+0192). Different code points, identical glyphs. Used to spoof names and bypass filters (https://dev.to/bbkr/fun-with-utf-8-homoglyphs-4619, https://github.com/MedjayPT/Homoglyph-Attack-Toolkit).
3. **Case/diacritic tricks**: mixed case, accent stacking, zero-width joiners/spaces.

**Normalization pipeline to apply before matching** (in this order):

1. **Unicode normalization**: NFKC (compatibility decomposition + composition) — folds full-width chars, many compatibility homoglyphs.
2. **Confusable skeleton mapping**: map every char to a canonical ASCII look-alike using the Unicode **confusables.txt** (UTS#39 skeleton) or a bundled table — e.g. glin-profanity's `normalizeUnicode` (Armenian/Cyrillic/Latin-ext → ASCII), Python's `confusable_homoglyphs`, JS `homoglyph`-search libs. Reference data: Unicode's own https://github.com/unicode-org/ml-confusables-generator.
3. **Case folding** (`toLowerCase` is not enough for all scripts; use proper case folding).
4. **Diacritic stripping**: NFD → remove `Mn` marks → NFC (àáâ→a). Libraries: `unidecode`/text-unidecode as a heavier fallback (transliterates whole scripts to ASCII — useful as a *second* normalized form, not the only one, since it can create false positives).
5. **Leetspeak decoding**: substitution map (`4/@→a, 3→e, 1/!/|→i/l, 0→o, 5/$→s, 7→t, 8→b, +→t, ph→f`) with levels (basic/moderate/aggressive); also collapse repeated chars (`fuuuck→fuck` with a max-run rule) and strip separators (`f.u.c.k`, `f_u_c_k`).
6. **Token-aware matching**: match against word boundaries, not raw substring, to avoid the Scunthorpe problem (`ass` in `class`, `cock` in `cockpit` — keep an allowlist of known false positives).

**Libraries that do this for you**: glin-profanity (JS+Py, §4.5 — `detectLeetspeak`, `leetspeakLevel: 'basic|moderate|aggressive'`, `normalizeUnicode`); commercial reference for techniques: CleanSpeak leet-speak filtering docs. For a Kotlin/Swift mobile client, port steps 1–4 with ICU (ICU4J/ICU4C provide NFKC, case folding, diacritic stripping, and UTS#39 spoof/skeleton APIs — `uspoof_getSkeleton`).

---

## 6. Google Play & Apple App Store compliance summary

### Google Play — User Generated Content policy
Source: https://support.google.com/googleplay/android-developer/answer/9876937

Apps "that contain or feature UGC, **including apps which are specialized browsers or clients to direct users to a UGC platform**" (i.e., a Nostr client is squarely covered) must implement "robust, effective, and ongoing UGC moderation" that:

1. Requires users to accept terms of use before creating/uploading UGC.
2. Defines and prohibits objectionable content in the ToS.
3. Provides an **in-app system for reporting** objectionable UGC and users, **blocking users**, and taking action. (Public-UGC/social apps: report users+content AND block users; 1:1 interactions: blocking.)
4. Prevents monetization from incentivizing objectionable content.

**Incidental sexual content** (a general social app where some users post adult content) is allowed only if ALL of:
- Hidden by default behind filters requiring **at least two user actions** to disable (e.g., default-on "safe search" toggle buried in settings);
- Minors explicitly excluded via a **neutral age screen**;
- Accurate content-rating questionnaire (expect 17+/Mature rating).

Apps whose primary purpose becomes objectionable UGC are removed.

### Apple App Store — Guideline 1.2 (User-Generated Content)
Source: https://developer.apple.com/app-store/review/guidelines/#1.2

UGC apps "must include":
1. "A method for **filtering objectionable material** from being posted to the app" — i.e., proactive filtering, not just reactive.
2. "A mechanism to **report offensive content** and timely responses to concerns."
3. "The ability to **block abusive users** from the service."
4. "Published **contact information** so users can easily reach you."

Critically for a Nostr client: *"If your app includes user-generated content from a web-based service, it may display incidental mature 'NSFW' content, provided that the content is **hidden by default** and only displayed when the user turns it on via your website."* Also note guideline 1.1.4 (no overtly sexual material as app purpose) and that apps that end up used primarily for porn are removed without notice. You are responsible for removing violating content and showing a remediation plan if contacted.

**Compliance checklist implied for the Nostr client:**
- NSFW hidden by default (NIP-36 blur + classifier + blocklists), opt-in with ≥2 taps, gated by age screen on Google Play.
- In-app report (NIP-56 kind 1984 incl. `illegal`/`nudity` types) + block user (NIP-51 mute list) + block relay.
- Published ToS defining objectionable content + contact/support URL (Apple 1.5 too).
- Content rating 17+; never promote/recommend sexual content in the app.

---

## 7. Community NSFW/spam pubkey blocklists

There is **no single canonical community NSFW blocklist repo**. The working mechanisms, in order of usefulness:

1. **NIP-51 shared mute lists** (kind 10000): users publish public mute lists (`p`/`t`/`word`/`e` tags); clients can import/subscribe to a curator's list. Primal productized this ("subscribe to other users' mute lists" — §2). Listr (https://listr.lol/) is a general list curation/discovery client for NIP-51 lists (mute lists, follow sets).
2. **Trust/score services** (better than raw pubkey lists because they generalize): Primal TrustRank (open source, §3.3), nostr.band TrustRank relay `wss://relay.nostr.band/trusted` (§3.2), filter.nostr.wine follows+follows WoT (§3.1), Vertex (`wss://relay.vertexlab.io` — PageRank-style pubkey ranking DVM/HTTP API: https://vertexlab.io/docs/endpoints/rank-profiles).
3. **NIP-32 label events** (kind 1985): atrifat's nostr-filter-relay publishes NSFW/language labels queryable by any client — a de-facto shared NSFW event-label feed (`wss://nfrelay.app`, §2).
4. **Relay-level curation**: paid relays and your own relay allowlist; NIP-51 kind 10006 blocked-relay lists for known-bad relays (Amethyst's approach for relays that refuse to moderate).

Practical seeding strategy for the app: ship a curated starter mute list (top spam/NSFW accounts observed via the above services) as a default NIP-51 list the user can edit, and auto-apply TrustRank/classification signals for everything else.

---

## Source index

- NIP-36: https://nips.nostr.com/36
- NIP-56: https://nips.nostr.com/56
- NIP-51: https://nips.nostr.com/51
- Profile-CW gap: https://github.com/nostr-protocol/nips/issues/315
- Primal moderation launch: https://www.nobsbitcoin.com/primal-moderation-system/
- Primal server: https://github.com/PrimalHQ/primal-server (archived: https://github.com/PrimalHQ/primal-caching-service)
- Amethyst compliance doc: https://github.com/vitorpamplona/amethyst/blob/main/PRIVACY.md
- nostr-filter-relay: https://github.com/atrifat/nostr-filter-relay ; https://github.com/atrifat/nsfw-detector-api ; https://github.com/atrifat/nostr-monitoring-tool
- filter.nostr.wine readme: https://nostr-wine.github.io/filter-relay/
- nostr.wine APIs: https://docs.nostr.wine/ (classification: https://docs.nostr.wine/api/classification)
- nostr.band TrustRank/API: https://x.com/NostrBand
- Vertex rank API: https://vertexlab.io/docs/endpoints/rank-profiles
- LDNOOBW: https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words (CC-BY-4.0, 28 languages)
- google-profanity-words: https://github.com/coffee-and-fun/google-profanity-words ; https://github.com/RobertJGabriel/List-Of-Explicit-Words
- profane-words: https://github.com/zautumnz/profane-words ; https://github.com/Jenyay/Obscene-Words-List
- glin-profanity: https://github.com/glincker/glin-profanity (MIT, 24 languages, leetspeak+homoglyph)
- NSFWJS: https://nsfwjs.com/
- Leet filtering techniques: https://cleanspeak.com/help-center-article/leet-speak-filtering-methods ; https://apiverve.com/marketplace/usernameprofanity/learn/username-moderation-challenges ; https://dev.to/bbkr/fun-with-utf-8-homoglyphs-4619 ; https://github.com/MedjayPT/Homoglyph-Attack-Toolkit ; https://github.com/unicode-org/ml-confusables-generator
- Google Play UGC: https://support.google.com/googleplay/android-developer/answer/9876937
- Apple guidelines: https://developer.apple.com/app-store/review/guidelines/#1.2
