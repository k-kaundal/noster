# Nostr Event Format Reference — Parsing & Rendering Guide

Researched from the official NIPs (nostr-protocol/nips). Sources: NIP-01, NIP-10, NIP-18, NIP-23, NIP-25, NIP-52, NIP-57, NIP-71, NIP-92.

---

## 1. Kind 1 — Text Notes (NIP-10)

### Format

```json
{
  "kind": 1,
  "content": "<human-readable plaintext>",
  "tags": [
    ["e", "<event-id>", "<relay-url>", "<marker>", "<pubkey>"],
    ["p", "<pubkey>", "<relay-url>"],
    ["q", "<event-id-or-addr>", "<relay-url>", "<pubkey>"],
    ["t", "<hashtag>"],
    ["imeta", "url <url>", "m <mime>", "..."]
  ]
}
```

**Content rules:**
- Content is **arbitrary plaintext** (NIP-01: `"content": <arbitrary string>`).
- Markup (markdown/HTML) **SHOULD NOT** be used per NIP-10 — but in practice clients render it anyway.
- May contain inline URLs (`https://...`), Nostr URIs (`nostr:note1...`, `nostr:npub1...`, `nostr:naddr1...`, `nostr:nevent1...`), hashtags (`#tag`), and emoji.
- `e` tags with markers `"root"`/`"reply"` define thread structure (NIP-10).
- `q` tags mark quote reposts (event was mentioned via `nostr:` URI in content).

### When kind 1 shows as raw JSON — common causes

| Cause | Detection | Fix |
|---|---|---|
| **A) Event is actually a repost, misrouted to the note renderer** | `kind === 6` or `16`, but the feed's parser assumed kind 1 | Check kind **before** choosing a renderer; route kind 6/16 to the repost parser |
| **B) Content is a stringified JSON event** (someone copy-pasted raw event JSON, or a broken client published JSON) | `content.trim()` starts with `{` and ends with `}`, and `JSON.parse(content)` succeeds AND parsed object has `pubkey`+`sig`+`id`+`kind` keys | Treat as embedded event: parse, extract inner `content`, render that. If parse fails or missing keys, render as plaintext |
| **C) Content contains a JSON blob that is NOT a nostr event** (e.g., `{"foo": 1}`) | Parse succeeds but object lacks `id`/`pubkey`/`sig` | Render as plaintext (it's genuinely text) |
| **D) Double-escaped JSON** | content starts with `\"` or contains `\\n` literal sequences | Single `JSON.parse` of the content string, then treat result as text |
| **E) Wrong encoding / UTF-16 BOM** | First char is U+FEFF or U+FFFE | Strip BOM before parsing/rendering |
| **F) Client bug: rendered `JSON.stringify(event)` instead of `event.content`** | Shows full event wrapper (`{"id":"...","pubkey":"..."}`) | Fix the renderer — never stringify the whole event for display |

**Safe detector for embedded-event-in-content:**

```ts
function tryParseEmbeddedEvent(content: string): NostrEvent | null {
  const t = content.trim();
  if (!t.startsWith('{') || !t.endsWith('}')) return null;
  try {
    const obj = JSON.parse(t);
    if (
      typeof obj === 'object' && obj !== null &&
      typeof obj.id === 'string' && obj.id.length === 64 &&
      typeof obj.pubkey === 'string' && obj.pubkey.length === 64 &&
      typeof obj.sig === 'string' &&
      typeof obj.kind === 'number' &&
      typeof obj.created_at === 'number' &&
      Array.isArray(obj.tags) &&
      typeof obj.content === 'string'
    ) {
      return obj as NostrEvent;
    }
  } catch { /* not JSON */ }
  return null;
}
```

---

## 2. Kind 6 — Reposts (NIP-18)

### Format

- **Content**: the **stringified JSON of the reposted kind-1 note** (the full original event object).
- MAY be empty (discouraged). MUST be empty for NIP-70 protected events.
- MUST include `e` tag with the reposted note's id + relay URL as third entry.
- SHOULD include `p` tag with the reposted note's author pubkey.

```json
{
  "kind": 6,
  "content": "{\"id\":\"abc...\",\"pubkey\":\"def...\",\"kind\":1,\"content\":\"hello world\",\"tags\":[],\"created_at\":...,\"sig\":\"...\"}",
  "tags": [
    ["e", "<reposted-note-id>", "wss://relay.example.com"],
    ["p", "<reposted-author-pubkey>"]
  ]
}
```

### Parsing rules

1. **Never render `content` directly.** It's an event, not text.
2. Try `JSON.parse(content)`:
   - Success → render the **inner** event via the normal kind-1 renderer (its `content`, `pubkey`, `created_at`).
   - Empty/failure → fall back to the `e` tag id; fetch the referenced event from relays, then render.
3. Display "X reposted" attribution using the **outer** event's pubkey + created_at.
4. Reposts only apply to kind 1. For anything else use kind 16.

---

## 3. Kind 16 — Generic Reposts (NIP-18)

Same structure as kind 6, but for **any kind other than 1**.

### Differences from kind 6

| Feature | Kind 6 | Kind 16 |
|---|---|---|
| Reposts | kind 1 only | any kind except 1 |
| `k` tag | not used | SHOULD contain stringified reposted kind |
| `a` tag | not used | SHOULD be present when reposting a replaceable/addressable event |
| Content | stringified kind-1 event | stringified event of the reposted kind, OR empty if `a` tag is present |

### Parsing rules

1. Read the `k` tag to know what kind of content is inside.
2. If `a` tag is present, fetch the addressable event by coordinate `kind:pubkey:d-tag` and render it (content MAY be empty).
3. If no `a` tag, the content MUST be the full JSON string of the specific version being reposted — parse and render.
4. Dispatch to the appropriate renderer based on `k` (e.g., `k=30023` → article renderer, `k=20` → picture renderer, `k=21`/`22` → video renderer).

---

## 4. Kind 7 — Reactions (NIP-25)

### Valid content values

| Content | Meaning |
|---|---|
| `"+"` or `""` (empty) | Like / upvote |
| `"-"` | Dislike / downvote |
| Any Unicode emoji (`"❤️"`, `"🔥"`, `"🤙"`) | Emoji reaction — NOT a like/dislike |
| `":shortcode:"` | NIP-30 custom emoji; look up matching `emoji` tag for image URL |

**Rule**: Content MUST include user-generated content indicating reaction value. Only `+`/empty/`-` are interpreted as votes; everything else is displayed as an emoji on the post.

### Custom emoji example

```json
{
  "kind": 7,
  "content": ":soapbox:",
  "tags": [
    ["emoji", "soapbox", "https://gleasonator.com/emoji/Gleasonator/soapbox.png"],
    ["e", "<target-event-id>", "<relay>"],
    ["p", "<target-author-pubkey>"],
    ["k", "1"]
  ]
}
```

### Required tags

- `e` — id of the event being reacted to (LAST `e` tag if multiple).
- `p` — pubkey of the event being reacted to (LAST `p` tag if multiple).
- `a` — SHOULD be included when reacting to addressable events, with coordinates.
- `k` — MAY be present, stringified kind of the target.

### Parsing rules

- If content matches `^:[a-z0-9_]+:$`, look up `["emoji", "<shortcode>", "<url>"]` and render as image.
- `+`/empty → thumbs-up/heart icon. `-` → thumbs-down.
- Otherwise render the emoji as-is (may be multi-codepoint, e.g. `❤️`).

---

## 5. Kind 9735 — Zap Receipts (NIP-57)

### Format

```json
{
  "kind": 9735,
  "content": "",            // SHOULD be empty
  "pubkey": "<lnurl-server-pubkey>",   // NOT the sender!
  "tags": [
    ["p", "<zap-recipient-pubkey>"],
    ["P", "<zap-sender-pubkey>"],       // optional
    ["e", "<zapped-event-id>"],         // if zapping an event
    ["a", "<event-coord>"],             // if zapping an addressable event
    ["k", "1"],
    ["bolt11", "lnbc10u1p3unwfu..."],
    ["description", "{\"kind\":9734,...}"],  // JSON-encoded zap request
    ["preimage", "5d006d2c..."]
  ]
}
```

### Extracting the amount — the correct way

**Primary source: parse the `bolt11` invoice.** The `amount` tag is on the *zap request* (kind 9734, embedded in the `description` tag), NOT directly on the receipt.

Steps:

1. Get `bolt11` tag value.
2. Decode the BOLT11 invoice (use a bolt11 library; on Dart: `bolt11` from `bolt11-dart` / `bech32` decode + parse amount section).
3. The human-readable part of the bolt11 encodes the amount: `lnbc10u...` = 10 micro-BTC = 10 × 100 sats = **1000 sats**. Multiplier codes:
   - `m` = milli-BTC (10⁻³) = ×100,000 sats
   - `u` = micro-BTC (10⁻⁶) = ×100 sats
   - `n` = nano-BTC (10⁻⁹) = ×0.1 sats
   - `p` = pico-BTC (10⁻¹²) = ×0.0001 sats
4. Cross-check: parse the `description` tag as JSON → it's the kind-9734 zap request → read its `["amount", "<millisats>"]` tag. Per Appendix F, this MUST equal the bolt11 amount.

**Quick-and-dirty fallback** (when you can't decode bolt11):

```ts
function zapAmountSats(receipt: NostrEvent): number | null {
  // 1. Try the description tag (zap request)
  const desc = receipt.tags.find(t => t[0] === 'description')?.[1];
  if (desc) {
    try {
      const zapReq = JSON.parse(desc);
      const amountTag = zapReq.tags?.find((t: string[]) => t[0] === 'amount')?.[1];
      if (amountTag) return Math.floor(parseInt(amountTag, 10) / 1000); // msats → sats
    } catch {}
  }
  // 2. Parse bolt11 human-readable prefix
  const bolt11 = receipt.tags.find(t => t[0] === 'bolt11')?.[1];
  if (bolt11) {
    const m = bolt11.match(/^lnbc(\d+)([munp]?)/i);
    if (m) {
      const value = BigInt(m[1]);
      const mult = m[2] || '';
      const satsPerBtc = 100_000_000n;
      let msats: bigint;
      switch (mult) {
        case 'm': msats = value * satsPerBtc * 1000n / 1000n; break;           // ×10⁻³ BTC
        case 'u': msats = value * satsPerBtc * 1000n / 1_000_000n; break;     // ×10⁻⁶ BTC
        case 'n': msats = value * satsPerBtc * 1000n / 1_000_000_000n; break; // ×10⁻⁹ BTC
        case 'p': msats = value * satsPerBtc * 1000n / 1_000_000_000_000n; break; // ×10⁻¹² BTC
        default:  msats = value * satsPerBtc * 1000n;                          // whole BTC
      }
      return Number(msats / 1000n); // sats
    }
  }
  return null;
}
```

### Critical pitfall: who sent the zap?

- `receipt.pubkey` = the **LNURL server's** pubkey (e.g., Wallet of Satoshi's signing key). NOT the human sender.
- `P` tag (capital) = the actual human sender.
- `p` tag (lowercase) = the recipient.
- The zap request's `content` (inside the `description` tag) is the zap comment — show that, not the receipt's empty content.

---

## 6. Notification Kinds

| Kind | Trigger | Target tag | Notes |
|---|---|---|---|
| **1** | Mention or reply to user | `p` tag = your pubkey | Reply if has `e` tag pointing to your note; mention if only `p` tag |
| **6** | Repost of your note | `e` tag = your note id (and `p` = you) | Only for kind 1 reposts |
| **16** | Generic repost of your content | `e` or `a` tag = your event | Use `k` tag to know what was reposted |
| **7** | Reaction to your note | `e` tag = your note id, `p` = you | |
| **9735** | Zap received | `p` tag = your pubkey (you're the recipient) | The `P` tag is the sender |
| **9734** | — | — | Do NOT notify (never published to relays anyway) |
| **4** | Legacy NIP-04 DM | `p` tag = you | Deprecated but still in the wild |
| **1059** | NIP-17 gift-wrapped DM | `p` tag = you | Modern DM; must unwrap kind 1059 → 13 → 14 |
| **1111** | Comment on your content | `p` tag = you | NIP-22 comment |
| **30023** | Long-form mention | `p` tag = you | Article mentions |
| **31925** | RSVP to your calendar event | `a` = your event, `p` = you | Calendar RSVP |

**Filter example** for "things that mention me":

```json
{
  "kinds": [1, 4, 6, 7, 16, 1059, 1111, 9735, 30023, 31925],
  "#p": ["<my-pubkey>"],
  "limit": 100
}
```

**Do NOT notify on**: kind 0 (metadata), 2 (relay list), 3 (contacts), 10002 (relay list), own events (`pubkey === me`).

---

## 7. Kind 30023 — Long-form Articles (NIP-23)

### Format

- **Content**: Markdown text (no hard line breaks, no HTML).
- **Addressable**: must have a `d` tag.

### Standard metadata tags

| Tag | Required | Description |
|---|---|---|
| `d` | YES | unique identifier |
| `title` | no (but expected) | article title |
| `image` | no | URL of hero image |
| `summary` | no | article summary |
| `published_at` | no | unix seconds (string) of first publication |
| `t` | no, repeated | hashtags/topics |

### Extraction code

```ts
function articleMeta(event: NostrEvent) {
  const get = (name: string) => event.tags.find(t => t[0] === name)?.[1];
  return {
    id:          get('d') ?? '',
    title:       get('title') ?? 'Untitled',
    summary:     get('summary'),
    image:       get('image'),
    publishedAt: get('published_at') ? parseInt(get('published_at')!, 10) : event.created_at,
    topics:      event.tags.filter(t => t[0] === 't').map(t => t[1]),
    markdown:    event.content,
  };
}
```

**Pitfall**: When multiple versions exist (same pubkey + d-tag), keep only the one with highest `created_at`.

---

## 8. NIP-71 Videos (kinds 21, 22, 34235, 34236)

| Kind | Type |
|---|---|
| 21 | normal video (regular event) |
| 22 | short video (regular event) |
| 34235 | addressable normal video |
| 34236 | addressable short video |

### Format

- **Content**: description/summary of the video.
- **`title` tag**: required.
- **`imeta` tags**: primary source of video URLs (one per variant/quality).
- Addressable kinds must have a `d` tag.

### imeta tag structure (NIP-92 + NIP-71 extensions)

Each `imeta` tag is `["imeta", "key value", "key value", ...]` — space-delimited key/value pairs.

Common keys:
- `url <url>` — primary video URL (**required**)
- `m <mime>` — e.g. `video/mp4`, `application/x-mpegURL` (HLS)
- `dim <WxH>` — e.g. `1920x1080`
- `x <sha256>` — file hash
- `image <url>` — preview thumbnail (may repeat)
- `fallback <url>` — mirror URL (may repeat)
- `duration <seconds>` — float
- `bitrate <bits/sec>` — int
- `service nip96`
- `l <code> ISO-639-1 ov` — audio language; `ov` = original voice
- `waveform <ints...>` — audio only

### Parser

```ts
interface VideoVariant {
  url: string;
  mime?: string;
  dim?: { w: number; h: number };
  hash?: string;
  images: string[];
  fallbacks: string[];
  duration?: number;
  bitrate?: number;
}

function parseImeta(tag: string[]): VideoVariant | null {
  const fields = new Map<string, string[]>();
  for (const kv of tag.slice(1)) {
    const sp = kv.indexOf(' ');
    if (sp === -1) continue;
    const k = kv.slice(0, sp), v = kv.slice(sp + 1);
    fields.set(k, [...(fields.get(k) ?? []), v]);
  }
  const url = fields.get('url')?.[0];
  if (!url) return null;
  const dimStr = fields.get('dim')?.[0];
  return {
    url,
    mime: fields.get('m')?.[0],
    dim: dimStr ? (() => { const [w, h] = dimStr.split('x').map(Number); return { w, h }; })() : undefined,
    hash: fields.get('x')?.[0],
    images: fields.get('image') ?? [],
    fallbacks: fields.get('fallback') ?? [],
    duration: fields.get('duration')?.[0] ? parseFloat(fields.get('duration')![0]) : undefined,
    bitrate: fields.get('bitrate')?.[0] ? parseInt(fields.get('bitrate')![0], 10) : undefined,
  };
}

const variants = event.tags
  .filter(t => t[0] === 'imeta')
  .map(parseImeta)
  .filter((v): v is VideoVariant => v !== null);

// Pick best variant: prefer video/mp4, then HLS, sort by dim descending
```

### Required/important top-level tags

- `title` — required
- `d` — required for 34235/34236
- `published_at` — unix seconds string
- `content-warning` — NSFW reason
- `alt` — accessibility description
- `duration` — may also appear as a top-level tag (addressable example)
- `p` (repeated) — participants
- `t` (repeated) — hashtags

---

## 9. Calendar Events (NIP-52)

### Kind 31922 — Date-based (all-day)

Required tags: `d`, `title`, `start`

- `start`: `YYYY-MM-DD` (ISO 8601 date), inclusive
- `end`: `YYYY-MM-DD`, optional, exclusive; if omitted ends same day

Validation: `/^\d{4}-\d{2}-\d{2}$/` against `start` (and `end` if present).

### Kind 31923 — Time-based

Required tags: `d`, `title`, `start`, `D`

- `start`: unix timestamp in seconds (string), inclusive
- `end`: unix timestamp, optional, exclusive
- `D`: **day-granularity timestamp** = `floor(start / 86400)`, required; may repeat to span multiple days
- `start_tzid` / `end_tzid`: IANA timezone names, optional

Validation: `parseInt(start)` is a positive number.

### Shared optional tags

`summary`, `image`, `location` (repeated), `g` (geohash), `p` (participants, with role as 4th element), `t`, `r`, `a` (calendar inclusion request)

### Validator

```ts
function validateCalendarEvent(e: NostrEvent): boolean {
  if (![31922, 31923].includes(e.kind)) return false;
  const get = (n: string) => e.tags.find(t => t[0] === n)?.[1];
  if (!get('d') || !get('title') || !get('start')) return false;
  if (e.kind === 31922) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(get('start')!)) return false;
  } else {
    const ts = parseInt(get('start')!, 10);
    if (isNaN(ts) || ts <= 0) return false;
  }
  return true;
}
```

---

## 10. Common Parsing Pitfalls

### A. "Raw JSON display" bugs — root causes

1. **Kind routed to wrong renderer.** A kind 6/16 repost passed to the kind-1 note renderer → renders stringified event JSON as if it were text. **Always switch on `event.kind` before rendering content.**
2. **Rendering the whole event object** (`Text('$event')` or `JSON.stringify(event)`) instead of `event.content`.
3. **Not unwrapping nested content**: repost → parse content → inner event → render `innerEvent.content`. Two levels of JSON.
4. **Content is JSON but not an event** (kind 0 profiles, kind 10002 relay lists, kind 30078 app data). These MUST be `JSON.parse`d and the relevant fields extracted — never shown raw.
5. **BOM / encoding issues** breaking `JSON.parse`.
6. **Trailing commas or single quotes** in hand-crafted JSON content — use a lenient parser or fall back to plaintext.

### B. Kinds whose content is ALWAYS JSON (must parse before display)

| Kind | Content | Display |
|---|---|---|
| 0 | `{"name","about","picture",...}` | profile fields |
| 2 | (deprecated) relay list | — |
| 3 | `{"wss://relay": {"read": true, "write": true}}` (legacy; modern uses tags) | contacts |
| 10002 | `""` (relays in `r` tags) | — |
| 30078 | app-specific JSON | app-defined |
| 9735's `description` tag | JSON zap request | parse to get amount/comment |
| 6 / 16 content | JSON stringified event | unwrap and render inner |

### C. Kinds whose content is PLAINTEXT (never JSON.parse)

1, 1111, 30023 (markdown), 21/22/34235/34236 (description), 31922/31923/31924/31925 (description), 7 (reaction emoji/`+`/`-`).

### D. Nested JSON handling rules

- Only attempt `JSON.parse` on content when:
  - The kind spec says content is JSON (0, 3, 6, 16, 30078, ...), OR
  - Content passes the embedded-event detector above (kind 1 edge case).
- Reposts: parse **once**, validate the result is an event, then render `inner.content` as plaintext (do NOT recursively parse inner.content — a repost of a repost is not a thing; kind 6 content is always a kind 1).
- Zap receipts: content is empty; parse the **`description` tag** (not content) to get the zap request.
- Depth limit: never recurse more than 2 levels deep.

### E. Tag parsing pitfalls

- **First value wins for indexing**: relays index only `tag[1]`. Filters like `#e` only match the first value.
- **Variadic imeta**: parse each `key value` string separately; keys may repeat (`image`, `fallback`).
- **Marked e tags**: positions 2=relay, 3=marker (`root`/`reply`), 4=pubkey. Old positional scheme (no marker) is deprecated — last `e` tag = direct parent.
- **`p` vs `P` in zaps**: lowercase = recipient, uppercase = sender. Case-sensitive!
- **Multiple tag instances**: `t`, `p`, `e`, `image`, `fallback` repeat — collect all, don't take only the first.

---

## 11. Flutter App Rendering Checklist

Before rendering any event, run this pipeline:

```
1. switch (event.kind) {
     case 1:     → NoteRenderer(event.content, event.tags)
     case 6:     → RepostRenderer(unwrap(event), expectedInnerKind: 1)
     case 16:    → RepostRenderer(unwrap(event), expectedInnerKind: kTag)
     case 7:     → ReactionRenderer(event.content, emojiTag)
     case 20:    → PictureRenderer(imetaTags)
     case 21/22/34235/34236: → VideoRenderer(imetaTags, titleTag)
     case 9735:  → ZapRenderer(descriptionTag, bolt11Tag, P/pTags)
     case 1111:  → CommentRenderer(event.content)
     case 30023: → ArticleRenderer(markdown: event.content, meta: title/image/summary)
     case 31922/31923: → CalendarRenderer(validate!)
     case 0/3/10002/30078: → JsonDataRenderer(jsonDecode(event.content))
     default:    → FallbackRenderer(kind: event.kind)
   }

2. unwrap(event) for reposts:
   - if content empty → fetch by e/a tag
   - else jsonDecode(content) → validate is event → render inner

3. validate before render:
   - has required tags? (d, title for addressable; e for reposts/reactions)
   - content parses when JSON expected?
   - signature valid? (optional at render time)

4. never render raw:
   - JSONDecode errors → show plaintext, not the raw string
   - Missing data → skeleton/placeholder, not raw JSON
```

### Quick "is this content JSON?" guard for Flutter

```dart
bool looksLikeEvent(String content) {
  final t = content.trim();
  if (!t.startsWith('{') || !t.endsWith('}')) return false;
  try {
    final obj = jsonDecode(t);
    return obj is Map &&
        obj['id'] is String && (obj['id'] as String).length == 64 &&
        obj['pubkey'] is String &&
        obj['sig'] is String &&
        obj['kind'] is int;
  } catch (_) {
    return false;
  }
}
```

---

## Source NIPs

- NIP-01 — Basic protocol, event structure, tag conventions
- NIP-10 — Kind 1 text notes, marked e tags
- NIP-18 — Kind 6/16 reposts, q tags
- NIP-23 — Kind 30023 long-form
- NIP-25 — Kind 7 reactions, custom emoji
- NIP-52 — Kinds 31922/31923/31924/31925 calendar
- NIP-57 — Kinds 9734/9735 zaps, bolt11 amount, P/p tags
- NIP-71 — Kinds 21/22/34235/34236 video, imeta extensions
- NIP-92 — imeta tag structure
