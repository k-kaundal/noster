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
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

const SITE_URL = 'https://www.nostrfeed.com';
const SITE_NAME = 'NostrFeed';
const OG_IMAGE = `${SITE_URL}/og-image.png`;

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

function pageHtml(template, route) {
  const title = fullTitle(route.title);
  const url = `${SITE_URL}${route.path === '/' ? '/' : route.path}`;

  let html = template;

  html = html.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(title)}</title>`);
  html = html.replace(
    /(<link rel="canonical" href=")[^"]*(")/i,
    `$1${url}$2`
  );

  html = setMeta(html, 'name', 'description', route.description);
  html = setMeta(html, 'property', 'og:title', title);
  html = setMeta(html, 'property', 'og:description', route.description);
  html = setMeta(html, 'property', 'og:url', url);
  html = setMeta(html, 'property', 'og:image', OG_IMAGE);
  html = setMeta(html, 'name', 'twitter:title', title);
  html = setMeta(html, 'name', 'twitter:description', route.description);
  html = setMeta(html, 'name', 'twitter:image', OG_IMAGE);

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
        `<lastmod>${today}</lastmod>`,
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

async function main() {
  const routes = await loadRoutes();
  const template = await readFile(join(dist, 'index.html'), 'utf8');

  let written = 0;

  for (const route of routes) {
    // The root is already `index.html`, and rewriting it would be a no-op at
    // best and a duplicate canonical at worst
    if (route.path === '/') continue;

    const directory = join(dist, route.path.replace(/^\//, ''));
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'index.html'), pageHtml(template, route));
    written += 1;
  }

  await writeFile(join(dist, 'sitemap.xml'), sitemap(routes));
  await writeFile(join(dist, 'llms.txt'), llmsTxt(routes));

  console.log(
    `seo: ${written} route pages, sitemap with ${routes.filter((r) => !r.noindex).length} urls, llms.txt`
  );
}

main().catch((error) => {
  console.error('seo build failed:', error);
  process.exit(1);
});
