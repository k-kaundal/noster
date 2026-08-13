/**
 * Every page of this site a crawler should know about, and what it says.
 *
 * One table, read by three things that used to disagree: the `useSeo` call on
 * the page itself, the sitemap, and the static metadata baked into each
 * route's HTML at build time. Written separately, those three drift within a
 * release — a page gets retitled, the sitemap keeps the old URL set, and the
 * card a link shows in a chat app is whatever `index.html` happened to say.
 *
 * Deliberately free of imports and of anything but data, because the build
 * script reads this file directly. Nothing here may depend on the app.
 */

export interface SiteRoute {
  path: string;
  title: string;
  description: string;
  /**
   * Sitemap priority, and the rough order of importance. Left off a route
   * that should not be in the sitemap at all.
   */
  priority?: number;
  changefreq?: 'hourly' | 'daily' | 'weekly' | 'monthly';
  /**
   * A page behind a login, or one whose content is somebody's private
   * business. Kept out of the sitemap and marked `noindex` — and still given
   * a title and description, because those are what a link preview shows
   * whether or not the page is indexable.
   */
  noindex?: boolean;
  /** One line for `llms.txt`, where the description is a claim about content. */
  summary?: string;
}

/**
 * The public pages, best first.
 *
 * Descriptions are written for a search result rather than for the page: they
 * have to make sense on their own, next to nine other results, to somebody who
 * has never heard of this site.
 */
export const SITE_ROUTES: SiteRoute[] = [
  {
    path: '/',
    title: 'NostrFeed — Decentralized Social Network on Nostr',
    description:
      'A fast, open Nostr client. Read and publish notes, watch short videos, zap creators over Lightning, and control exactly which relays you use.',
    priority: 1,
    changefreq: 'hourly',
    summary: 'The feed: notes from the relays you choose.',
  },
  {
    path: '/explore',
    title: 'Explore Nostr',
    description:
      'Find people, hashtags and communities across the Nostr network. Search runs against the relays you have chosen, not a company index.',
    priority: 0.8,
    changefreq: 'hourly',
    summary: 'Search people, hashtags and communities.',
  },
  {
    path: '/trending',
    title: 'Trending on Nostr',
    description:
      'What is being read and zapped on Nostr right now, ranked from the relays you connect to rather than from an advertising feed.',
    priority: 0.8,
    changefreq: 'hourly',
    summary: 'Notes being read and zapped right now.',
  },
  {
    path: '/discovery',
    title: 'Discover people on Nostr',
    description:
      'People worth following on Nostr, drawn from who your follows read rather than from a recommendation engine you cannot inspect.',
    priority: 0.7,
    changefreq: 'daily',
    summary: 'People worth following, from your own network.',
  },
  {
    path: '/reels',
    title: 'Short videos on Nostr',
    description:
      'Short vertical videos published to Nostr. No account needed to watch, and no algorithm deciding what comes next.',
    priority: 0.9,
    changefreq: 'hourly',
    summary: 'Short vertical video, published to relays.',
  },
  {
    path: '/services',
    title: 'What NostrFeed runs',
    description:
      'A name people can zap you at, a lightning wallet, a Cashu mint, and the wallet on a page of its own. Every one of them works with or without this app.',
    priority: 0.8,
    changefreq: 'weekly',
    summary:
      'The lightning wallet, Cashu mint, standalone wallet and names at getzap.me.',
  },
  {
    path: '/premium',
    title: 'Premium relay access',
    description:
      'Paid access to a relay that keeps your notes, served without ads. Bought with sats over Lightning, by the month or once.',
    priority: 0.7,
    changefreq: 'weekly',
    summary: 'Paid relay access, bought in sats.',
  },
  {
    path: '/relays',
    title: 'Relays',
    description:
      'Choose which Nostr relays this client reads from and publishes to. Relays are the servers that hold notes, and picking them is what makes the network yours.',
    priority: 0.5,
    changefreq: 'weekly',
    summary: 'Pick the servers your notes come from and go to.',
  },
  {
    path: '/calendar',
    title: 'Nostr calendar',
    description:
      'Events published to Nostr as NIP-52 calendar entries: meetups, streams and conferences anyone can host without a platform.',
    priority: 0.6,
    changefreq: 'daily',
    summary: 'Events published to Nostr, NIP-52.',
  },
  {
    path: '/market',
    title: 'Nostr marketplace',
    description:
      'Classified listings published to Nostr and paid in sats. Peer to peer, with no marketplace in the middle taking a cut.',
    priority: 0.6,
    changefreq: 'daily',
    summary: 'Classified listings paid in sats.',
  },
  {
    path: '/communities',
    title: 'Nostr communities',
    description:
      'Communities on Nostr: open groups anyone can read, join and post to, moderated by their own members rather than by a platform.',
    priority: 0.6,
    changefreq: 'daily',
    summary: 'Open groups, moderated by their members.',
  },
  {
    path: '/live',
    title: 'Live on Nostr',
    description:
      'Live streams announced on Nostr, with a chat that lives on relays rather than on the streaming platform.',
    priority: 0.6,
    changefreq: 'hourly',
    summary: 'Live streams and their relay-hosted chat.',
  },
  {
    path: '/ecash',
    title: 'Ecash wallet',
    description:
      'Hold sats as Cashu ecash: bearer tokens a mint signs without being able to read, so it cannot tell who spent what.',
    // Somebody's balance, like the wallet — the mint is sold on /services
    noindex: true,
  },
  {
    path: '/p2p',
    title: 'Peer-to-peer sats',
    description:
      'Buy and sell sats directly with other people over Nostr, with no exchange holding the funds in between.',
    priority: 0.5,
    changefreq: 'daily',
    summary: 'Buy and sell sats directly with people.',
  },
  {
    path: '/write',
    title: 'Write on Nostr',
    description:
      'Publish long-form articles to Nostr as NIP-23 events. Your writing lives on relays you choose and stays readable if this site disappears.',
    // A composer, not content. The articles it produces are what gets indexed.
    noindex: true,
  },
  {
    path: '/mini-apps',
    title: 'Nostr mini apps',
    description:
      'Small apps that run on Nostr data and sign with your key, listed in one place.',
    priority: 0.4,
    changefreq: 'weekly',
    summary: 'Small apps built on Nostr data.',
  },

  /* Everything below is signed-in territory. Titled for the tab and for a
     link preview, kept out of the sitemap, and marked noindex — a search
     result promising somebody's wallet or notifications is a bad result. */
  {
    path: '/wallet',
    title: 'Wallet',
    description:
      'Your NostrFeed lightning wallet: send, receive and get zapped.',
    noindex: true,
  },
  {
    path: '/notifications',
    title: 'Notifications',
    description: 'Replies, mentions, reposts and zaps aimed at you.',
    noindex: true,
  },
  {
    path: '/bookmarks',
    title: 'Bookmarks',
    description: 'Notes you saved, held in your own bookmark list on relays.',
    noindex: true,
  },
  {
    path: '/chat',
    title: 'Messages',
    description: 'Private messages, encrypted to the recipient’s key.',
    noindex: true,
  },
  {
    path: '/settings',
    title: 'Settings',
    description: 'Theme, relays, currency and the rest of how this app behaves.',
    noindex: true,
  },
];

/** The metadata for one route, when it is one we describe. */
export function routeSeo(path: string): SiteRoute | undefined {
  return SITE_ROUTES.find((route) => route.path === path);
}

/** The routes that belong in a sitemap: public, and worth crawling. */
export function indexableRoutes(): SiteRoute[] {
  return SITE_ROUTES.filter((route) => !route.noindex);
}
