/**
 * Bakes each page's metadata into its own HTML file, and writes the sitemap.
 *
 * The problem this solves is specific and it is not about search engines.
 * Google renders JavaScript, so the client-side `useSeo` call is enough for
 * it. Nothing else does: Twitter, Slack, Telegram, WhatsApp, Discord, iMessage
 * and every LLM crawler read the HTML as served and never run a line of the
 * app. On a single-page app they all receive `index.html` — so every link to
 * every page previewed as the site's front door, with the front door's title,
 * the front door's description and the front door's image, no matter what was
 * shared.
 *
 * So each route gets a real file: a copy of the built `index.html` with its
 * own title, description, canonical URL and card tags substituted in, written
 * to `dist/<route>/index.html` where a static host serves it before falling
 * back to the SPA rewrite. The app still boots and takes over; the difference
 * is only in what a crawler is handed.
 *
 * Routes with runtime identity — a profile, a note, an article — cannot be
 * done this way, because their content is fetched from relays and there is no
 * build-time list of them. Those need a server that renders tags per request.
 * See docs/seo.md.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transform } from 'esbuild';
import { nip19 } from 'nostr-tools';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

const SITE_URL = 'https://www.nostrfeed.com';
const SITE_NAME = 'NostrFeed';
const OG_IMAGE = `${SITE_URL}/og-image.png`;

/**
 * The site-level JSON-LD, baked into every page's HTML.
 *
 * A copy of `siteSchema()` from `src/lib/structuredData.ts`. Duplicated
 * rather than imported: the build script already loads `siteRoutes.ts`
 * through an esbuild transform, and pulling in the app's `lib` would drag the
 * import graph along with it. The two are kept in step by
 * `scripts/seo-build.test.mjs`, which builds both and compares them.
 *
 * Baked rather than left to React because the readers that matter most for
 * this block — chat apps unfurling a link, assistants fetching a page — never
 * run the app, so a JSON-LD block only React writes is one they never see.
 */
export function siteJsonLd() {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${SITE_URL}/#website`,
        url: SITE_URL,
        name: SITE_NAME,
        alternateName: 'nostrfeed.com',
        description:
          'A fast, open Nostr client for reading and publishing on the decentralized social network.',
        keywords:
          'nostr, nostr client, decentralized social network, zaps, bitcoin lightning, censorship resistant social media',
        potentialAction: {
          '@type': 'SearchAction',
          target: {
            '@type': 'EntryPoint',
            urlTemplate: `${SITE_URL}/?q={search_term_string}`,
          },
          'query-input': 'required name=search_term_string',
        },
      },
      {
        '@type': 'WebApplication',
        '@id': `${SITE_URL}/#app`,
        name: SITE_NAME,
        url: SITE_URL,
        applicationCategory: 'SocialNetworkingApplication',
        operatingSystem: 'Any',
        browserRequirements: 'Requires JavaScript',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        featureList:
          'Nostr feed, short videos, long-form articles, Lightning wallet, zaps, live streams, marketplace, communities',
      },
    ],
  });
}

/**
 * Reads the route table out of the app's own source.
 *
 * Compiled rather than duplicated. A second copy of this data in a build
 * script is a copy that goes stale the first time somebody retitles a page,
 * and the failure is invisible — the app looks right and only the crawler
 * sees the old words. `siteRoutes.ts` is plain data with no imports, so
 * stripping its types is all it takes to load it here.
 */
async function loadRoutes() {
  const source = await readFile(join(root, 'src/lib/siteRoutes.ts'), 'utf8');
  const { code } = await transform(source, { loader: 'ts', format: 'esm' });
  const module = await import(
    `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  );

  return module.SITE_ROUTES;
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Titles read better with the brand appended — except where it is already there. */
function fullTitle(title) {
  return title.includes(SITE_NAME) ? title : `${title} · ${SITE_NAME}`;
}

/**
 * Replaces one tag's content, matched on the attribute that identifies it.
 *
 * Rewriting rather than appending: a second `og:title` does not override the
 * first, and which one a given crawler reads is not something to leave to
 * chance.
 */
function setMeta(html, attr, name, content) {
  const pattern = new RegExp(
    `(<meta\\s+${attr}="${name}"\\s+content=")[^"]*(")`,
    'i'
  );

  if (!pattern.test(html)) {
    return html.replace(
      '</head>',
      `    <meta ${attr}="${name}" content="${escapeHtml(content)}" />\n  </head>`
    );
  }

  return html.replace(pattern, `$1${escapeHtml(content)}$2`);
}

/**
 * Questions a person asks a search engine that the docs answer.
 *
 * Emitted as `FAQPage` JSON-LD on the docs page, which earns an expandable
 * listing on the search result — the question shows under the link with the
 * answer a tap away. Each answer is one honest line and a pointer to the doc
 * page, not the doc page repeated.
 */
const DOCS_FAQ = [
  {
    question: 'What is Nostr?',
    answer:
      'Nostr is an open protocol for social networking. Your account is a cryptographic key rather than a row in a company database, and your posts live on relays anyone can run — so no platform can suspend your account or own your audience.',
  },
  {
    question: 'What is a Nostr key?',
    answer:
      'A Nostr account is a keypair. The public key (npub) is your name — share it freely. The secret key (nsec) is your account — anyone holding it is you, and losing it is permanent, with no reset.',
  },
  {
    question: 'What is a zap?',
    answer:
      'A zap is a small bitcoin payment over the Lightning Network attached to a Nostr note or profile — a tip that is also a public signal of appreciation. NostrFeed has a Lightning wallet built in so zapping takes one tap.',
  },
  {
    question: 'What is a Nostr relay?',
    answer:
      'A relay is a server that stores and serves Nostr notes. Your posts go to the relays you choose and your feed comes from them, so picking good relays is what makes the network yours rather than a platform’s.',
  },
  {
    question: 'Is NostrFeed free to use?',
    answer:
      'Yes. Reading and publishing on NostrFeed is free — an account is a key, not a login, and the Lightning wallet, zaps, short videos and articles all work without payment.',
  },
];

function faqJsonLd() {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${SITE_URL}/docs#faq`,
    mainEntity: DOCS_FAQ.map(({ question, answer }) => ({
      '@type': 'Question',
      name: question,
      acceptedAnswer: { '@type': 'Answer', text: answer },
    })),
  });
}

/**
 * Exported for the tests: which tags a page ends up with — keywords replaced,
 * stripped, or left alone — is exactly the part that breaks silently when it
 * breaks, so it is checked rather than assumed.
 */
export function pageHtml(template, route) {
  const title = fullTitle(route.title);
  const url = `${SITE_URL}${route.path === '/' ? '/' : route.path}`;

  /*
   * An article's own cover, when it has one. Falling back to the site card is
   * right for a page about the site and wrong for a piece of writing — a
   * preview showing the NostrFeed logo says nothing about the article and is
   * indistinguishable from the generic preview this exists to replace.
   */
  const image = route.image || OG_IMAGE;

  let html = template;

  html = html.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(title)}</title>`);
  html = html.replace(
    /(<link rel="canonical" href=")[^"]*(")/i,
    `$1${url}$2`
  );

  html = setMeta(html, 'name', 'description', route.description);
  /*
   * Keywords belong to the page, so the template's own — the front page's,
   * which is what the built `index.html` carries — has to come out either
   * way: replaced where the route has a list, removed where it does not.
   * Left in, `/wallet` would tell a crawler it is about "nostr client" when
   * it is about somebody's balance.
   *
   * Google ignores the tag for ranking and says so; Bing and the smaller
   * engines still read it, and the list lives with the route so it cannot
   * drift from what the page is.
   */
  if (route.keywords?.length) {
    html = setMeta(html, 'name', 'keywords', route.keywords.join(', '));
  } else {
    html = html.replace(/[ \t]*<meta\s+name="keywords"\s[^>]*>\n?/i, '');
  }
  html = setMeta(html, 'property', 'og:title', title);
  html = setMeta(html, 'property', 'og:description', route.description);
  html = setMeta(html, 'property', 'og:url', url);
  html = setMeta(html, 'property', 'og:image', image);
  html = setMeta(html, 'name', 'twitter:title', title);
  html = setMeta(html, 'name', 'twitter:description', route.description);
  html = setMeta(html, 'name', 'twitter:image', image);

  /*
   * A page kept out of search still gets its card tags, because being
   * unlisted and being unshareable are different things: somebody pasting a
   * link to their wallet in a chat should still see what it is.
   */
  html = setMeta(
    html,
    'name',
    'robots',
    route.noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large'
  );

  /*
   * The site-level JSON-LD, baked in. A crawler that does not run JavaScript
   * — a chat app unfurling a link, an assistant fetching a page — never sees
   * the block React writes, so it is written here too. `JSON.stringify` never
   * emits `</script>`, so the inline block is safe as-is.
   */
  html = html.replace(
    '</head>',
    `    <script type="application/ld+json">${siteJsonLd()}</script>\n  </head>`
  );

  /* The docs page also carries the FAQ, for the expandable rich result. */
  if (route.path === '/docs') {
    html = html.replace(
      '</head>',
      `    <script type="application/ld+json">${faqJsonLd()}</script>\n  </head>`
    );
  }

  return html;
}

function sitemap(routes) {
  const today = new Date().toISOString().slice(0, 10);

  const entries = routes
    .filter((route) => !route.noindex)
    .map((route) => {
      const url = `${SITE_URL}${route.path === '/' ? '/' : route.path}`;

      return [
        '  <url>',
        `<loc>${url}</loc>`,
        `<lastmod>${route.lastmod ?? today}</lastmod>`,
        route.changefreq ? `<changefreq>${route.changefreq}</changefreq>` : '',
        route.priority ? `<priority>${route.priority}</priority>` : '',
        '</url>',
      ].join('');
    });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries,
    '</urlset>',
    '',
  ].join('\n');
}

/**
 * `llms.txt`: the site, in the form an assistant can actually use.
 *
 * A convention rather than a standard, and cheap enough to be worth following
 * on that basis alone — a plain-text map at a predictable path costs nothing
 * and is far more likely to be read correctly than a JavaScript application.
 * What it must not be is a second set of marketing claims: it says what each
 * page is, so an assistant answering a question about this site links to the
 * right one instead of guessing from the front page.
 */
function llmsTxt(routes) {
  const lines = [
    `# ${SITE_NAME}`,
    '',
    '> A Nostr client: read and publish notes, watch short video, and get paid in bitcoin over Lightning. Nostr is an open protocol — notes live on relays anyone can run, and an account is a keypair rather than a row in this site’s database.',
    '',
    'Nothing here requires an account to read. Publishing needs a Nostr key, which the reader holds; this site never receives one.',
    '',
    '## Pages',
    '',
  ];

  for (const route of routes) {
    if (route.noindex) continue;

    lines.push(
      `- [${route.title}](${SITE_URL}${route.path}): ${route.summary ?? route.description}`
    );
  }

  lines.push(
    '',
    '## Notes, profiles and articles',
    '',
    'Individual notes, profiles and articles are addressed by their NIP-19 identifier at the root of the site — `/npub1…` for a profile, `/note1…` or `/nevent1…` for a note, `/naddr1…` for an article. Their content is fetched from Nostr relays when the page opens, so it is not present in the HTML.',
    '',
    '## Elsewhere',
    '',
    `- [Lightning wallet](https://ln.nostrfeed.com): a custodial lightning wallet that opens with a Nostr key.`,
    `- [Names](https://getzap.me): lightning addresses and NIP-05 verified names.`,
    `- [Cashu mint](https://mint.nostrfeed.com): ecash, issued as blinded bearer tokens.`,
    `- [Standalone wallet](https://wallet.nostrfeed.com): the same wallet without the feed around it.`,
    ''
  );

  return lines.join('\n');
}

/**
 * Articles, baked the same way the static routes are.
 *
 * `/naddr1…` has no build-time list in the general case — the set is every
 * long-form post on Nostr — but it does not have to be general to be useful.
 * The articles anybody actually shares are recent ones, and recent ones can be
 * asked for. So the build fetches a page of them and writes a real file per
 * article, exactly as it does for `/docs` or `/trending`.
 *
 * This is not a replacement for `api/preview.ts`, which answers for anything
 * at any age. It is the half that keeps working with no server involved — on
 * a static host, on Blossom, on GitLab Pages — and the half that is already
 * on disk when a crawler asks, with no relay round trip in the request.
 *
 * It must never fail a build. A relay being down is not a reason to ship no
 * site, so everything here is wrapped and the worst case is the previous
 * behaviour.
 */
const ARTICLE_RELAYS = [
  'wss://relay.nostr.band',
  'wss://relay.damus.io',
  'wss://relay.primal.net',
];

/** Long-form content. Drafts (30024) are deliberately not published here. */
const ARTICLE_KIND = 30023;

/** How many to bake. Each is one small file and one sitemap entry. */
const MAX_ARTICLES = 250;

/** Per relay. The build should not hang on one that accepts and never answers. */
const RELAY_TIMEOUT = 10_000;

function collectFrom(url) {
  return new Promise((resolve) => {
    const events = [];
    let socket;
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket?.close();
      } catch {
        // Already closed, or never opened
      }
      resolve(events);
    };

    const timer = setTimeout(finish, RELAY_TIMEOUT);

    try {
      socket = new WebSocket(url);
    } catch {
      finish();
      return;
    }

    socket.onerror = finish;
    socket.onclose = finish;

    socket.onopen = () => {
      socket.send(
        JSON.stringify(['REQ', 'a', { kinds: [ARTICLE_KIND], limit: MAX_ARTICLES }])
      );
    };

    socket.onmessage = (message) => {
      try {
        const data = JSON.parse(String(message.data));
        if (data[0] === 'EVENT') events.push(data[2]);
        if (data[0] === 'EOSE') finish();
      } catch {
        // One unreadable frame is not a reason to abandon the rest
      }
    };
  });
}

const tag = (event, name) =>
  event.tags?.find((entry) => entry[0] === name)?.[1];

/**
 * The newest revision of each article, across every relay that answered.
 *
 * Addressable events are identified by author and `d` tag, and relays disagree
 * about which revision they hold — so the same piece arrives several times
 * with different ids and different titles.
 */
export function newestArticles(events) {
  const byAddress = new Map();

  for (const event of events) {
    if (event?.kind !== ARTICLE_KIND || !event.pubkey || !event.id) continue;

    const identifier = tag(event, 'd');
    const title = tag(event, 'title');

    // Untitled, or unaddressable, is not something to write a card for
    if (!identifier || !title) continue;

    const key = `${event.pubkey}:${identifier}`;
    const held = byAddress.get(key);

    if (!held || event.created_at > held.created_at) byAddress.set(key, event);
  }

  return [...byAddress.values()]
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, MAX_ARTICLES);
}

/**
 * The longest a single path component may be, in bytes.
 *
 * `NAME_MAX` on every filesystem this builds on. It bites here because an
 * `naddr` carries its `d` tag verbatim in the payload, and nothing stops a `d`
 * tag being long: RSS bridges such as atomstr use the source article's whole
 * URL as the identifier, which produces an `naddr` well past 255 characters
 * and a `mkdir` that fails with ENAMETOOLONG.
 */
const NAME_MAX = 255;

/** Whether every segment of a path can actually be a directory. */
export function isWritablePath(path) {
  return path
    .split('/')
    .filter(Boolean)
    .every((segment) => Buffer.byteLength(segment, 'utf8') <= NAME_MAX);
}

/** An article as a route, so it goes through the same page writer. */
export function articleRoute(event) {
  const identifier = tag(event, 'd');

  const naddr = nip19.naddrEncode({
    identifier,
    pubkey: event.pubkey,
    kind: ARTICLE_KIND,
  });

  const summary = (tag(event, 'summary') || event.content || '')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    path: `/${naddr}`,
    title: tag(event, 'title'),
    description: summary.length > 200 ? `${summary.slice(0, 199)}…` : summary,
    image: tag(event, 'image'),
    changefreq: 'monthly',
    priority: '0.6',
    lastmod: new Date(event.created_at * 1000).toISOString().slice(0, 10),
  };
}

async function loadArticles() {
  const answers = await Promise.all(
    ARTICLE_RELAYS.map((url) => collectFrom(url).catch(() => []))
  );

  const routes = newestArticles(answers.flat()).map(articleRoute);

  /*
   * Dropped rather than fatal, and dropped from the sitemap too.
   *
   * These pages still work — the SPA rewrite serves them and they render
   * client-side like any other route — so what is lost is the prerendered
   * card, not the article. Listing a URL in the sitemap that this build knows
   * it did not write would be inviting a crawler to the one version with no
   * metadata on it.
   *
   * A whole build used to fail on one of these, which is the wrong trade by a
   * distance: the identifiers come off public relays, so anybody publishing a
   * long enough `d` tag could stop the site deploying.
   */
  const writable = routes.filter((route) => isWritablePath(route.path));

  if (writable.length < routes.length) {
    console.warn(
      `seo: ${routes.length - writable.length} article(s) skipped — identifier too long for a path`
    );
  }

  return writable;
}

async function main() {
  const routes = await loadRoutes();
  const builtIndex = await readFile(join(dist, 'index.html'), 'utf8');

  /*
   * The built `index.html` is the front page — the words `/` describes —
   * and the template the other pages are written from. Those are different
   * jobs, so they get different files: `pageHtml` starts from the plain
   * build, because starting from the front page would put its keywords tag
   * on every page and its JSON-LD on twice. The front page gets its own
   * JSON-LD written over the built file afterwards, which the route loop
   * below deliberately leaves alone.
   */
  await writeFile(
    join(dist, 'index.html'),
    builtIndex.replace(
      '</head>',
      `    <script type="application/ld+json">${siteJsonLd()}</script>\n  </head>`
    )
  );

  let written = 0;

  for (const route of routes) {
    // The root is already `index.html`, and rewriting it would be a no-op at
    // best and a duplicate canonical at worst
    if (route.path === '/') continue;

    const directory = join(dist, route.path.replace(/^\//, ''));
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'index.html'), pageHtml(builtIndex, route));
    written += 1;
  }

  /*
   * Never fatal. A relay being unreachable during a build is not a reason to
   * ship no site — it is a reason to ship the one that was shipping before.
   */
  let articles = [];
  try {
    articles = await loadArticles();
  } catch (error) {
    console.warn(`seo: articles skipped (${error.message})`);
  }

  for (const article of articles) {
    const directory = join(dist, article.path.replace(/^\//, ''));
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'index.html'), pageHtml(builtIndex, article));
  }

  const indexed = [...routes, ...articles];

  await writeFile(join(dist, 'sitemap.xml'), sitemap(indexed));
  await writeFile(join(dist, 'llms.txt'), llmsTxt(routes));

  console.log(
    `seo: ${written} route pages, ${articles.length} articles, sitemap with ${indexed.filter((r) => !r.noindex).length} urls, llms.txt`
  );
}

/*
 * Only when run as a script. The article helpers above are exported so they
 * can be tested, and importing this file to reach them must not kick off a
 * build.
 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('seo build failed:', error);
    process.exit(1);
  });
}
