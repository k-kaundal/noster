#!/usr/bin/env node
/**
 * Drive NostrFeed in a real browser: screenshot it, and audit its design.
 *
 * Usage (from the repo root):
 *
 *   node .claude/skills/run-nostrfeed/driver.mjs shots /studio /communities
 *   node .claude/skills/run-nostrfeed/driver.mjs audit /studio
 *   node .claude/skills/run-nostrfeed/driver.mjs flow /studio "7 days"
 *
 * Assumes the design dev server is already up on :8080 — see SKILL.md. It is
 * left to the caller rather than spawned here so a review session can reload
 * the same server dozens of times without paying Vite's cold start each time.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * playwright-core lives outside the project on purpose.
 *
 * `npm i` cannot run here at all — it re-resolves the whole tree, hits the
 * unreachable jsr registry and fails before it installs anything — so the
 * browser driver is installed into a scratch directory instead of into
 * node_modules. See SKILL.md for the one-line install.
 */
const PW_CANDIDATES = [
  process.env.NOSTRFEED_PW,
  path.resolve(process.cwd(), 'node_modules/playwright-core'),
  '/tmp/nostrfeed-pw/node_modules/playwright-core',
].filter(Boolean);

function loadPlaywright() {
  for (const candidate of PW_CANDIDATES) {
    try {
      return require(candidate);
    } catch {
      // Try the next one
    }
  }

  console.error(
    'playwright-core not found. Install it once:\n' +
      '  mkdir -p /tmp/nostrfeed-pw && cd /tmp/nostrfeed-pw && ' +
      "echo '{\"name\":\"pw\"}' > package.json && npm i playwright-core"
  );
  process.exit(2);
}

const { chromium } = loadPlaywright();

const BASE = process.env.NOSTRFEED_URL ?? 'http://127.0.0.1:8080';
const OUT = process.env.NOSTRFEED_SHOTS ?? 'design-shots';

/**
 * The executable the container already ships; never downloaded.
 *
 * `/opt/pw-browsers/chromium` is a symlink to the binary, not to the directory
 * containing it — so the usual `<dir>/chrome-linux/chrome` guess fails with
 * "Not a directory". The path below is the whole answer.
 */
const EXECUTABLE = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';

/** Set by --console-all; see `isOfflineNoise`. */
let CONSOLE_ALL = false;

const VIEWPORTS = {
  mobile: { width: 390, height: 844 },
  tablet: { width: 834, height: 1112 },
  desktop: { width: 1440, height: 900 },
};

/**
 * Chromium refuses to start as root without this, which is the whole container.
 * `--force-device-scale-factor=2` gives screenshots you can actually read type
 * in — a 1x shot of an 11px label is not reviewable.
 */
const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--force-device-scale-factor=2',
];

async function withBrowser(run) {
  const browser = await chromium.launch({
    executablePath: EXECUTABLE,
    args: LAUNCH_ARGS,
  });

  try {
    return await run(browser);
  } finally {
    await browser.close();
  }
}

/**
 * Opens a route and waits for it to actually be painted.
 *
 * `networkidle` is not usable here: the app holds websocket-shaped work open
 * and TanStack Query refetches on a timer, so it never goes idle. Waiting for
 * the app's own first content is both faster and more honest about when a
 * human would call the page loaded.
 */
async function open(browser, route, { viewport = 'desktop', theme = 'dark', signedOut = false } = {}) {
  const context = await browser.newContext({
    viewport: VIEWPORTS[viewport],
    deviceScaleFactor: 2,
    colorScheme: theme,
    reducedMotion: 'reduce',
  });

  const problems = [];
  const page = await context.newPage();

  /**
   * The harness has no network, so every relay socket and every remote image
   * fails — on every route, forever. Reporting those as findings buries the
   * one console error that is actually about your code under six that are
   * about the container. Pass `--console-all` when you are chasing a network
   * problem on purpose.
   */
  const isOfflineNoise = (text) =>
    !CONSOLE_ALL &&
    /ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION_|via proxy server failed|Failed to load resource/i.test(
      text
    );

  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (!isOfflineNoise(text)) problems.push(text);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));

  if (signedOut) {
    await context.addInitScript(() => {
      window.__NOSTRFEED_SIGNED_OUT__ = true;
    });
  }

  // The app stores its theme choice; set it before first paint so the
  // screenshot is not of a flash of the other palette.
  await context.addInitScript((chosen) => {
    try {
      localStorage.setItem('nostr:app-config', JSON.stringify({ theme: chosen }));
    } catch {
      /* storage disabled — the media query still applies */
    }
  }, theme);

  await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });

  // #root stays empty until React mounts; anything else screenshots a blank page
  await page.waitForFunction(
    () => (document.querySelector('#root')?.childElementCount ?? 0) > 0,
    { timeout: 20_000 }
  );

  // Let skeletons resolve into content. Fixture latency is ~120ms per query
  // and screens chain two or three of them.
  await page.waitForTimeout(1200);

  return { context, page, problems };
}

/** Screenshots one or more routes across viewports and both themes. */
async function shots(routes, options) {
  await fs.mkdir(OUT, { recursive: true });
  const written = [];

  await withBrowser(async (browser) => {
    for (const route of routes) {
      for (const viewport of options.viewports) {
        for (const theme of options.themes) {
          const { context, page, problems } = await open(browser, route, {
            viewport,
            theme,
            signedOut: options.signedOut,
          });

          const slug = route.replace(/^\/$/, 'home').replace(/[/]/g, '-').replace(/^-/, '');
          const file = path.join(OUT, `${slug}.${viewport}.${theme}.png`);

          await page.screenshot({ path: file, fullPage: options.fullPage });
          written.push(file);

          console.log(
            `${file}${problems.length ? `  ⚠ ${problems.length} console error(s)` : ''}`
          );
          for (const problem of problems.slice(0, 3)) {
            console.log(`    ${problem.slice(0, 160)}`);
          }

          await context.close();
        }
      }
    }
  });

  return written;
}

/**
 * Design checks that a screenshot cannot make for you.
 *
 * Everything here is a rule this project already committed to — in CLAUDE.md,
 * in the theme system, or in the layout — and which nothing enforces. A human
 * looking at a screenshot will not notice a 320px-wide phone scrolling
 * sideways by 4px, and will not notice that one card kept its colour when the
 * theme flipped.
 */
const AUDIT = `() => {
  const findings = [];

  const add = (rule, detail, sample) => findings.push({ rule, detail, sample });

  /* 1. The body must never scroll sideways. Wide content scrolls inside its
        own container; a page that pans is a broken layout on a phone. */
  if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) {
    const overflowing = [...document.querySelectorAll('*')]
      .filter((el) => el.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
      .slice(0, 4)
      .map((el) => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').slice(0, 3).join('.') : ''));

    add('horizontal-scroll',
        document.documentElement.scrollWidth + 'px wide in a ' + document.documentElement.clientWidth + 'px viewport',
        overflowing.join(', '));
  }

  /* Visually-hidden things are not design. A skip link is 1x1 and clipped
     until focused, so every check below would flag it forever. */
  const hidden = (el) => {
    if (el.closest('.sr-only')) return true;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') return true;
    return style.clip === 'rect(0px, 0px, 0px, 0px)';
  };

  /* 2. Tap targets. 32px is the floor below which a control is hard to hit
        with a thumb, so this only applies at touch widths — a 28px button is
        fine under a mouse, and flagging every desktop toolbar produced far
        more noise than signal. Inline links inside prose are excluded too:
        they are text, and text is allowed to be text. */
  const touch = window.innerWidth < 900;
  const small = !touch ? [] : [...document.querySelectorAll('button, a[href], [role="button"]')]
    .filter((el) => {
      if (hidden(el)) return false;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      if (getComputedStyle(el).display === 'inline') return false;
      return r.height < 32 || r.width < 32;
    });
  if (small.length) {
    add('small-tap-target', small.length + ' interactive element(s) under 32px',
        small.slice(0, 4).map((el) => (el.innerText || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 24)).join(' | '));
  }

  /* 3. Text contrast, against whatever is actually painted behind it.

        Alpha is composited rather than discarded, which took two attempts to
        get right: this app tints backgrounds with things like
        \`bg-repost/5\` and text with \`text-repost/70\`, so reading the raw RGB
        of a 5%-opacity layer reports a green label on a green background at
        exactly 1.00:1 — a false alarm that would have buried the real ones. */
  const luminance = ([r, g, b]) => {
    const [lr, lg, lb] = [r, g, b].map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
  };

  /** \`rgb()\`/\`rgba()\` -> [r, g, b, a], or null when there is no colour. */
  const parse = (value) => {
    const m = value.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const parts = m[1].split(/[,\\s/]+/).filter(Boolean).map(parseFloat);
    return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
  };

  /** Paint \`over\` on top of \`under\`, both [r,g,b,a]. */
  const composite = (over, under) => [
    over[0] * over[3] + under[0] * (1 - over[3]),
    over[1] * over[3] + under[1] * (1 - over[3]),
    over[2] * over[3] + under[2] * (1 - over[3]),
    1,
  ];

  /* What the page is painted on when every layer above is translucent. */
  const rootBg = parse(getComputedStyle(document.body).backgroundColor);
  const base = rootBg && rootBg[3] === 1 ? rootBg : [255, 255, 255, 1];

  /** The opaque colour actually behind this element's text. */
  const backdrop = (el) => {
    const layers = [];
    let node = el;

    while (node && node !== document.documentElement) {
      const bg = parse(getComputedStyle(node).backgroundColor);
      if (bg && bg[3] > 0) {
        layers.push(bg);
        if (bg[3] === 1) break;
      }
      node = node.parentElement;
    }

    // Innermost layer is painted last, so composite from the back forward
    let result = base;
    for (let i = layers.length - 1; i >= 0; i -= 1) {
      result = composite(layers[i], result);
    }
    return result;
  };

  const seen = new Set();
  const low = [];
  for (const el of document.querySelectorAll('p, span, h1, h2, h3, h4, li, td, th, label, button, a')) {
    const text = (el.innerText || '').trim();
    if (!text || el.childElementCount > 0 || hidden(el)) continue;

    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;

    const style = getComputedStyle(el);
    const fgRaw = parse(style.color);
    if (!fgRaw || fgRaw[3] === 0) continue;

    const bg = backdrop(el);
    const fg = composite(fgRaw, bg);

    const size = parseFloat(style.fontSize);
    const bold = parseInt(style.fontWeight, 10) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const need = large ? 3 : 4.5;

    const l1 = luminance(fg);
    const l2 = luminance(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

    if (ratio < need) {
      // One row per distinct style, not per occurrence: a token used in
      // eighty places is one thing to fix, not eighty
      const key = style.color + '|' + Math.round(size) + '|' + bg.join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      low.push(text.slice(0, 26) + ' (' + ratio.toFixed(2) + ':1, needs ' + need + ')');
    }
  }
  if (low.length) add('low-contrast', low.length + ' distinct low-contrast text style(s)', low.slice(0, 5).join(' | '));

  /* 4. Images need alt text, even if empty — a decorative image with no alt
        attribute at all is read aloud as its filename. */
  const noAlt = [...document.querySelectorAll('img:not([alt])')];
  if (noAlt.length) add('missing-alt', noAlt.length + ' <img> without an alt attribute',
      noAlt.slice(0, 3).map((el) => (el.getAttribute('src') || '').slice(0, 40)).join(' | '));

  /* 5. An icon-only button with no accessible name is a mystery to a screen
        reader, and this app has a lot of icon-only buttons. */
  const nameless = [...document.querySelectorAll('button, [role="button"]')]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || hidden(el)) return false;
      return !(el.innerText || '').trim()
        && !el.getAttribute('aria-label')
        && !el.getAttribute('aria-labelledby')
        && !el.getAttribute('title')
        && !el.querySelector('.sr-only')
        // A Radix trigger is named by the content it opens
        && !el.getAttribute('aria-haspopup');
    });
  if (nameless.length) add('unnamed-control', nameless.length + ' control(s) with no accessible name', '');

  /* 6. A transparent body borrows the host page's colour. The published-page
        rule, but it bites in the app too when a token is missing. */
  const bodyBg = getComputedStyle(document.body).backgroundColor;
  if (!parse(bodyBg)) add('transparent-body', 'body has no painted background', bodyBg);

  return {
    findings,
    theme: document.documentElement.getAttribute('data-theme')
      || (document.documentElement.classList.contains('dark') ? 'dark' : 'light'),
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  };
}`;

async function audit(routes, options) {
  let total = 0;

  await withBrowser(async (browser) => {
    for (const route of routes) {
      for (const viewport of options.viewports) {
        for (const theme of options.themes) {
          const { context, page, problems } = await open(browser, route, {
            viewport,
            theme,
            signedOut: options.signedOut,
          });

          /*
           * Invoked, not just named. Playwright evaluates a string argument as
           * an *expression* — passing the arrow function's source alone
           * evaluates to a function object, which does not serialise, and the
           * call quietly returns undefined.
           */
          const result = await page.evaluate(`(${AUDIT})()`);

          const header = `${route}  [${viewport} · ${theme}]`;
          if (!result.findings.length && !problems.length) {
            console.log(`✓ ${header}`);
          } else {
            console.log(`\n${header}`);
            for (const finding of result.findings) {
              console.log(`  ✗ ${finding.rule}: ${finding.detail}`);
              if (finding.sample) console.log(`      ${finding.sample}`);
            }
            for (const problem of problems.slice(0, 3)) {
              console.log(`  ✗ console: ${problem.slice(0, 160)}`);
            }
            total += result.findings.length + problems.length;
          }

          await context.close();
        }
      }
    }
  });

  console.log(`\n${total} finding(s).`);
  return total;
}

/**
 * Click something, then screenshot what happened.
 *
 * The reason a screenshot-only tool is not enough: dialogs, popovers, tabs and
 * empty-vs-filled states are most of the design surface, and none of them are
 * at a URL.
 */
async function flow(route, selectors, options) {
  await fs.mkdir(OUT, { recursive: true });

  await withBrowser(async (browser) => {
    const { context, page, problems } = await open(browser, route, {
      viewport: options.viewports[0],
      theme: options.themes[0],
      signedOut: options.signedOut,
    });

    const slug = route.replace(/^\/$/, 'home').replace(/[/]/g, '-').replace(/^-/, '');
    let step = 0;

    for (const selector of selectors) {
      step += 1;

      // Plain text is treated as a visible-label lookup, which is how a person
      // describes a button — CSS selectors only when they start with . # or [
      const locator = /^[.#[]/.test(selector)
        ? page.locator(selector).first()
        : page.getByText(selector, { exact: false }).first();

      try {
        await locator.click({ timeout: 5000 });
      } catch (error) {
        console.log(`  ! could not click ${JSON.stringify(selector)}: ${String(error).split('\n')[0]}`);
      }

      await page.waitForTimeout(700);

      const file = path.join(OUT, `${slug}.step${step}.png`);
      await page.screenshot({ path: file });
      console.log(`${file}   after clicking ${JSON.stringify(selector)}`);
    }

    for (const problem of problems.slice(0, 5)) {
      console.log(`  console: ${problem.slice(0, 160)}`);
    }

    await context.close();
  });
}

/* ---- argv ------------------------------------------------------------- */

const argv = process.argv.slice(2);
const command = argv.shift();

const options = {
  viewports: ['desktop'],
  themes: ['dark'],
  fullPage: false,
  signedOut: false,
};

const positional = [];
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === '--viewports') options.viewports = argv[++i].split(',');
  else if (arg === '--themes') options.themes = argv[++i].split(',');
  else if (arg === '--full') options.fullPage = true;
  else if (arg === '--signed-out') options.signedOut = true;
  else if (arg === '--console-all') CONSOLE_ALL = true;
  else if (arg === '--all') {
    options.viewports = ['mobile', 'desktop'];
    options.themes = ['light', 'dark'];
  } else positional.push(arg);
}

const routes = positional.length ? positional : ['/'];

switch (command) {
  case 'shots':
    await shots(routes, options);
    break;

  case 'audit': {
    const findings = await audit(routes, options);
    process.exit(findings > 0 ? 1 : 0);
    break;
  }

  case 'flow':
    await flow(routes[0], routes.slice(1), options);
    break;

  default:
    console.error(
      'usage: driver.mjs <shots|audit|flow> [routes…] ' +
        '[--viewports mobile,tablet,desktop] [--themes light,dark] [--all] [--full] [--signed-out] [--console-all]'
    );
    process.exit(2);
}
