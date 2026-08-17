/**
 * The manual, for the people using this rather than building it.
 *
 * `docs/` already exists and is not this: those are notes to whoever changes
 * the code, full of endpoint names and decisions. Somebody who has just been
 * handed a lightning address needs a different document — what the thing is,
 * what it costs, and what to do when it looks broken.
 *
 * Kept as data rather than as files under `public/`. It ships in the bundle,
 * so it works offline and on the first paint with no request and no loading
 * state; it is searchable without an index; and the parts worth testing — that
 * every link resolves, that nothing is orphaned — are testable.
 *
 * Accuracy is the whole point. A manual that describes a nicer product than
 * the one running is worse than none, because it turns every real limitation
 * into a bug report. Where the app cannot do something, this says so.
 */

export type DocSection =
  | 'start'
  | 'money'
  | 'name'
  | 'writing'
  | 'keeping-it-working';

export interface DocSectionMeta {
  id: DocSection;
  title: string;
  /** One line under the heading in the sidebar. */
  blurb: string;
}

export const DOC_SECTIONS: DocSectionMeta[] = [
  {
    id: 'start',
    title: 'Getting started',
    blurb: 'What this is and how you get in.',
  },
  {
    id: 'money',
    title: 'Money',
    blurb: 'The wallet, your address, and zaps.',
  },
  { id: 'name', title: 'Your name', blurb: 'Free, bought, and the ✓.' },
  { id: 'writing', title: 'Posting', blurb: 'Writing, replying, and reach.' },
  {
    id: 'keeping-it-working',
    title: 'When something looks wrong',
    blurb: 'The failures worth recognising.',
  },
];

export interface Doc {
  slug: string;
  title: string;
  /** Shown in search results and under the title. */
  summary: string;
  section: DocSection;
  /** Extra words to match on that the prose may not contain. */
  keywords?: string[];
  body: string;
}

/**
 * Ordered. The order is the reading order — the sidebar, the search fallback
 * and the previous/next links all take it from here, so there is one sequence
 * rather than three that can disagree.
 */
export const DOCS: Doc[] = [
  {
    slug: 'what-this-is',
    title: 'What NostrFeed is',
    summary:
      'A Nostr client with a Lightning wallet built in. Your account is a key, not a login.',
    section: 'start',
    keywords: ['nostr', 'account', 'sign up', 'decentralised'],
    body: `
NostrFeed is a client for Nostr — an open network where your account is a
cryptographic key rather than a row in somebody's database. Nobody can suspend
it, and nothing you post lives only here.

Two things follow from that, and they are the two things worth understanding
before anything else.

## Your posts are not stored here

They are published to **relays** — independent servers that accept and serve
events. This app reads from the relays you choose. So the same account looks
different in different clients, and a post can exist on a relay this app is not
reading. That is not a fault; it is how the network works.

## Money is real money

Zaps are Lightning payments. They are not points, they cannot be reversed, and
a wrong address sends real sats somewhere you did not intend. Everything in the
Money section is written with that in mind.

## What you need

A Nostr key. You can create one here, or sign in with a browser extension or a
remote signer you already use. There is no email, no password, and no account
recovery — see [Your keys](/docs/your-keys) before you go further, because that
last part is not a figure of speech.
`,
  },
  {
    slug: 'your-keys',
    title: 'Your keys',
    summary:
      'A public key is your name. A secret key is your account. Losing it is permanent.',
    section: 'start',
    keywords: ['nsec', 'npub', 'password', 'recovery', 'security', 'extension'],
    body: `
Your account is a pair of keys.

- **Public key** (\`npub1…\`) is your identity. Share it freely — it is how
  people find and follow you.
- **Secret key** (\`nsec1…\`) *is* the account. Anyone holding it is you: they
  can post as you, read your private messages, and move any money attached to
  your name.

## There is no reset

No email, no support desk, no recovery. If you lose your secret key you lose the
account, and if somebody else gets it you cannot take it back. This is the cost
of nobody being able to suspend you.

So: write it down, keep it somewhere a house fire will not reach, and never
paste it into a website that asks for it.

## The safer ways to sign in

A **browser extension** or a **remote signer** holds the key and signs on your
behalf, so the key never enters this app at all. If you already have one, use
it. If you created your key here, moving it into one later is worth the ten
minutes.

## What this app stores

Your key stays in your browser. It is never sent to a server, ours or anyone
else's. Your wallet session is separate and is described under
[The wallet](/docs/wallet).
`,
  },
  {
    slug: 'relays',
    title: 'Relays',
    summary:
      'Where your posts go and where your feed comes from. Choosing badly makes the app look empty.',
    section: 'start',
    keywords: ['relay', 'feed empty', 'not showing', 'missing posts'],
    body: `
A relay is a server that accepts events and serves them back. You publish to
relays and you read from relays, and the two sets do not have to match.

Most confusing behaviour on Nostr comes from this one fact: **if a post is not
on a relay you read, it does not exist as far as this app is concerned.**

## What that looks like

- A feed that seems quiet while everyone says the network is busy.
- A reply you can see that the person you replied to never sees.
- A zap that arrives in the wallet but shows no count — the receipt was
  published somewhere you do not read. See
  [When a zap does not show](/docs/zap-not-showing).

## Choosing them

A small number of well-connected relays beats a long list. Every relay you add
is another connection to keep open and another copy of everything to merge, and
past a handful the app gets slower without finding much more.

You can change them under **Relays** in the navigation. If a page looks empty,
switching relays is the first thing to try — several empty states offer the
switcher directly for that reason.
`,
  },
  {
    slug: 'wallet',
    title: 'The wallet',
    summary:
      'A Lightning wallet tied to your key. Custodial, and honest about it.',
    section: 'money',
    keywords: ['lnbits', 'balance', 'send', 'receive', 'invoice', 'custodial'],
    body: `
The built-in wallet runs on LNbits. Signing in with your Nostr key creates it —
there is no separate registration.

## Custodial, and what that means

The operator holds the sats. This is convenient and it is a real trade-off: a
custodial balance is only as safe as the service holding it. **Keep spending
money here, not savings.** For anything you would be upset to lose, use a wallet
where you hold the keys and connect it instead — this app can pay from a browser
extension or any wallet you connect over NWC.

## What is stored where

Your wallet **session token** is kept in this browser so you stay signed in.
Your wallet **keys** are fetched fresh each time and never written to storage —
the spending key exists only in memory while the page is open.

## Several wallets

An LNbits account can hold more than one. The wallet page lets you switch, and
which one is active decides where new invoices are paid and which balance is
shown. Your lightning address keeps paying into whichever wallet it was created
against, regardless of which one you are looking at.

## Signing in elsewhere

You can reach the same wallet with a username and password, or with the account
link that carries \`?usr=\`. Be aware that these can open a *different* LNbits
account than your Nostr key created — if names or balances look wrong after
signing in that way, that is usually why.
`,
  },
  {
    slug: 'lightning-address',
    title: 'Your lightning address',
    summary:
      'The `you@domain` that receives money. Free, permanent, and yours.',
    section: 'money',
    keywords: ['lud16', 'lightning address', 'receive', 'pay me', 'free'],
    body: `
A lightning address looks like an email address and works like an account
number: anyone can send to it from any Lightning wallet.

## The free one

You get one without paying. The name is derived from your key rather than
chosen, so it looks like \`u3f2a91c4b7e8@…\` — not pretty, but it receives money
exactly as well as any other address, and it is yours permanently.

## Publishing it

Creating the address is not the last step. Other clients read where to send
zaps from your **profile**, so until you publish it there, nobody can zap you.
The wallet page prompts for this, and it is one tap.

## Names are shared across the site

A name is claimed site-wide, not per domain. If \`alice\` is taken, it is taken
everywhere this service answers for — so the same name cannot be issued twice
under two different domains. When you claim a name you already hold, you get
the address back rather than a second one.

## Addresses are never deleted

There is deliberately no delete button. Retiring a name would return it to the
pool, and the next person to claim it would start receiving money aimed at you
— from printed QR codes, saved contacts, and old profiles that will never find
out. So a name, once issued, stays issued.

To stop receiving at an address, publish a different one. The old one keeps
working for whoever already had it, which is what anyone you gave it to is
entitled to assume.
`,
  },
  {
    slug: 'zaps',
    title: 'Zaps',
    summary: 'Paying someone for a post, and what has to happen for it to count.',
    section: 'money',
    keywords: ['zap', 'nip-57', 'tip', 'sats', 'receipt', '9735'],
    body: `
A zap is a Lightning payment attached to a post or a person. It is real money
moving, and it is public: the amount and the sender appear next to what was
zapped.

## What happens when you press ⚡

1. Your client writes a **zap request** and you sign it.
2. The recipient's server turns that into an invoice.
3. You pay it from whichever wallet you chose.
4. That server publishes a **zap receipt** to relays.
5. Everyone reading those relays counts it.

Steps 4 and 5 are the ones that fail, and they fail *after* the money has
already moved. See [When a zap does not show](/docs/zap-not-showing).

## One tap or a dialog

You can set a default amount and zap in a single tap. Holding the button always
opens the full dialog, so a different amount or a note is one gesture away. If a
one-tap zap cannot happen — no wallet, not enough balance — the tap opens the
dialog rather than doing nothing.

## Zapping a person

Zapping a profile rather than a post is a real thing and behaves slightly
differently: the payment names the person and no event, so it appears on their
profile rather than on any post. That is correct, not a bug.

## Split zaps

A post can route its zaps to several people. When it does, the amount is
divided as the post specifies and paid as separate invoices — the author is not
necessarily the recipient.
`,
  },
  {
    slug: 'verified-names',
    title: 'Verified names',
    summary:
      'The ✓ next to your posts. Rented by the year, and a different thing from your address.',
    section: 'name',
    keywords: ['nip-05', 'checkmark', 'verified', 'buy name', 'rent', 'domain'],
    body: `
A verified name is a NIP-05 identifier — \`alice@example.com\` — that proves a
Nostr key belongs to whoever controls that domain. Clients render it as a ✓.

## It is not the same as your lightning address

They are written identically and behave differently, which is the single most
confusing thing in this app:

| | Lightning address | Verified name |
|---|---|---|
| What it does | receives money | proves who you are |
| Cost | free | rented by the year |
| Expires | never | yes |
| Profile field | \`lud16\` | \`nip05\` |

One name can do both jobs, and often does. They are still two records.

## Buying one

Pick a name, pick a domain, and the price comes back from the server — names
are priced by length and by domain, so a short one costs more. Pay the invoice
and the name goes live. If you pay from another device or after closing the
tab, it still activates; the app picks the payment up on its own.

## Publishing it

Like an address, a bought name does nothing until it is on your profile. You
can hold several names and exactly one of them can carry the ✓, so the app asks
which.

## A link you can actually share

Once a name is on your profile you get a readable web address for it:

\`\`\`
nostrfeed.com/@alice
\`\`\`

That is the one to put in a bio somewhere else, print, or read out loud. Your
\`npub\` also works as a link and nobody can type it from memory. A name hosted
somewhere other than here keeps its domain in the link —
\`nostrfeed.com/@alice@example.com\` — and resolves the same way.

The link works for anyone, signed in or not. Copy it from the QR button on
your profile.

## Expiry

Names are rented, not bought outright. You are warned as the date approaches.
If one lapses the ✓ disappears until it is renewed — and so does the short
link, since the name is what it resolves through.
`,
  },
  {
    slug: 'posting',
    title: 'Posting and replying',
    summary: 'Writing, threads, quotes, and who actually sees it.',
    section: 'writing',
    keywords: ['post', 'note', 'reply', 'thread', 'quote', 'mention', 'hashtag'],
    body: `
Posts are public and permanent by default. There is no edit, and delete is a
*request* — you ask relays to drop an event and most honour it, but anyone who
already has a copy keeps it. Write accordingly.

## Replies and quotes

A **reply** continues a conversation inside the thread. A **quote** lifts a post
into one of your own and starts a new conversation about it. Both notify the
author, and they are not the same thing to the person being notified.

## Mentions and hashtags

Typing \`@\` offers people to mention; they are notified. Hashtags are how posts
are found by topic — one or two relevant ones does more than a wall of them.

## Reach

Your post goes to the relays you publish to and is seen by people reading those
relays. If your posts seem to reach nobody, that is usually a relay question
rather than an audience one — see [Relays](/docs/relays).

## Deleting

The delete option publishes a deletion request. Treat it as "ask politely",
not "erase".
`,
  },
  {
    slug: 'notifications',
    title: 'Notifications',
    summary:
      'What you get told about, and the one thing this app genuinely cannot do.',
    section: 'keeping-it-working',
    keywords: ['notification', 'push', 'alert', 'badge', 'follow', 'mention'],
    body: `
You are notified about replies, mentions, quotes, reactions, reposts, zaps, and
new followers. Payments into your wallet are announced too, whether or not they
came with a zap attached.

## Follows are approximate

Nostr has no "alice followed you" event — there is only alice's contact list,
republished whole whenever she edits it. So a new follower is worked out by
comparing that list against who was already there, and the timestamp shown is
when she last published the list, not the moment she followed you.

## System notifications

With permission, this app can raise a desktop or phone notification and set an
app badge **while it is running** — a background tab, or the installed app not
in focus. That covers the case people actually complain about.

## What it cannot do

**Nothing arrives while the app is fully closed.** That requires Web Push,
which requires a server to hold a subscription and watch relays on your behalf.
This app talks to relays from your browser and has no such server. A switch
labelled "notifications" that silently did nothing overnight would be worse
than being told plainly, so: it does not work overnight.
`,
  },
  {
    slug: 'zap-not-showing',
    title: 'When a zap does not show',
    summary:
      'The money arrived and the count did not. What that means and what to check.',
    section: 'keeping-it-working',
    keywords: [
      'zap count',
      'zero',
      'not counted',
      'receipt',
      'missing',
      'troubleshoot',
    ],
    body: `
The payment and the count are two separate things, and only the first involves
your money. Sats can arrive perfectly while nothing appears anywhere.

## Why

A zap counts because the recipient's server published a **receipt** and your
client found it. Between the payment and the count sit two independent steps
that can each fail without touching the money.

## The usual causes

**The payment was not a zap.** Paying a lightning address directly — from a
phone wallet, or by scanning an invoice — produces no receipt at all. It is an
ordinary payment. The sats are there; there was never anything to count.

**The receipt went to relays you do not read.** It is published to the relays
named in the sender's request, which need not be yours. Nothing is lost; you
simply cannot see it. See [Relays](/docs/relays).

**The recipient's server does not publish receipts.** Plenty of providers serve
Lightning perfectly and cannot sign a Nostr receipt. When we can tell in
advance, the zap dialog says so before you pay.

**It was a profile zap.** Zapping a person names the person and no post, so it
appears on their profile and nowhere else. Working as intended.

## What is not a cause

A count that stays at zero is never a sign that your money went missing. Check
the wallet — if the sats are there, they are there.

## Counts are checked, not trusted

Anyone can publish an event claiming a zap happened. Receipts are verified
before they are counted, so a total here can be lower than one shown somewhere
that counts everything it sees. That is the intended direction to be wrong in.
`,
  },
  {
    slug: 'something-looks-broken',
    title: 'Something looks broken',
    summary: 'The handful of failures worth recognising before reporting.',
    section: 'keeping-it-working',
    keywords: ['error', 'broken', 'help', 'stuck', 'troubleshoot', 'support'],
    body: `
## The feed is empty

Almost always relays. Try the relay switcher offered in the empty state — most
"nothing is here" screens have one for exactly this reason.

## My address says it is not set up

If money is arriving at it, it is set up. Some names are answered by your own
pay link rather than by the name's own record; both resolve to the same place,
and nothing needs fixing to be paid.

## A name I paid for still says "awaiting payment"

Give it a moment and reload. Activation happens when the invoice settles, which
can be a few seconds behind the payment, and the app picks it up on its own —
including when you paid from another device. Do not pay twice.

## The ✓ is not showing

Check the name is published to your profile, and that it has not expired. A
name that verifies a *different* key than the one you are signed in with will
never show a ✓ here, and the app says so where it happens.

## A payment failed

Read the message rather than retrying. "Insufficient balance" means top up.
Anything mentioning a route means the network could not find a path — usually
worth trying again in a minute. A message naming an address means the address
did not resolve, and retrying will not change that.

## Still stuck

Reach the author at [@kkworld](https://x.com/kkworld). Include what you did,
what you expected, and what actually appeared — a screenshot of the error beats
a description of it.
`,
  },
];

/** The doc with this slug, or null. */
export function findDoc(slug: string | undefined): Doc | null {
  if (!slug) return null;
  return DOCS.find((doc) => doc.slug === slug) ?? null;
}

/** Every doc in a section, in reading order. */
export function docsInSection(section: DocSection): Doc[] {
  return DOCS.filter((doc) => doc.section === section);
}

/**
 * What comes before and after, for the links at the foot of an article.
 *
 * Taken from the one ordered list rather than from the section, so the
 * sequence runs through the whole manual instead of dead-ending at each
 * section's last page.
 */
export function docNeighbours(slug: string): {
  previous: Doc | null;
  next: Doc | null;
} {
  const index = DOCS.findIndex((doc) => doc.slug === slug);
  if (index < 0) return { previous: null, next: null };

  return {
    previous: DOCS[index - 1] ?? null,
    next: DOCS[index + 1] ?? null,
  };
}

/**
 * Docs matching what somebody typed.
 *
 * Ranked rather than filtered: a word in the title is a much better match than
 * the same word buried in a paragraph, and a list that does not say so puts
 * the page they wanted third. Body text is matched too, because people search
 * for the error they saw rather than the heading it lives under — which is
 * what the `keywords` are for as well.
 */
export function searchDocs(query: string): Doc[] {
  const terms = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  if (!terms.length) return [];

  const scored = DOCS.map((doc) => {
    const title = doc.title.toLowerCase();
    const summary = doc.summary.toLowerCase();
    const keywords = (doc.keywords ?? []).join(' ').toLowerCase();
    const body = doc.body.toLowerCase();

    let score = 0;
    for (const term of terms) {
      if (title.includes(term)) score += 8;
      else if (keywords.includes(term)) score += 5;
      else if (summary.includes(term)) score += 3;
      else if (body.includes(term)) score += 1;
      // Every term has to land somewhere, or this is not a match at all
      else return { doc, score: -1 };
    }

    return { doc, score };
  });

  return scored
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.doc);
}

/** Every internal `/docs/...` link in the manual, for checking none are dead. */
export function internalDocLinks(doc: Doc): string[] {
  return [...doc.body.matchAll(/\]\(\/docs\/([a-z0-9-]+)\)/g)].map(
    (match) => match[1]
  );
}

/** Every URL the manual occupies, for the sitemap. */
export const DOC_PATHS: string[] = [
  '/docs',
  ...DOCS.map((doc) => `/docs/${doc.slug}`),
];
