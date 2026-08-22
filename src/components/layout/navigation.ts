import {
  ArrowLeftRight,
  Banknote,
  Bell,
  BookOpen,
  CircleHelp,
  LifeBuoy,
  Bookmark,
  CalendarDays,
  ChartLine,
  Compass,
  Film,
  Flame,
  Home,
  KeyRound,
  Radio,
  List,
  MessagesSquare,
  PenSquare,
  Server,
  PenLine,
  Settings,
  Sparkles,
  Store,
  User,
  Users,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { nip19 } from 'nostr-tools';
import { COMMUNITY } from '@/components/layout/SiteFooter';

/**
 * Which part of the rail an entry belongs to.
 *
 * Nineteen destinations in one flat column is a wall a reader has to scan
 * rather than a menu they can use — and on a 13-inch laptop it is also taller
 * than the viewport, which used to put Settings below the fold with nothing to
 * scroll. Sections give the eye somewhere to stop.
 */
export type NavSection = 'main' | 'discover' | 'money' | 'manage';

/**
 * A live figure shown at the end of a row.
 *
 * Named rather than carried as a value, because the table is a static list and
 * these are read from hooks. The point is information scent: a rail that says
 * "Relays 6/7" answers the question that would otherwise take a click, and a
 * count beside Notifications is the difference between a menu and a dashboard.
 *
 * Deliberately only the two that cost nothing to know. A wallet balance would
 * be the obvious third and it is not here on purpose — reading it means an
 * authenticated request to LNbits, and putting that in the rail would make
 * every page in the app fetch a wallet nobody asked to see.
 */
export type NavBadge = 'unread' | 'relays';

export interface NavItem {
  section?: NavSection;
  /** A live figure to show at the end of the row. */
  badge?: NavBadge;
  href: string;
  icon: LucideIcon;
  label: string;
  /** Keyboard shortcut hint shown in the desktop rail. */
  shortcut?: string;
  /** Only reachable while logged in. */
  requiresAuth?: boolean;
  /**
   * Leaves the app.
   *
   * Needed because the rail renders a router `Link`, which treats an absolute
   * URL as a path and routes `https://discord.gg/...` straight to the 404
   * page. An external row is an `<a>`, and says so with an icon rather than
   * surprising somebody with a new tab.
   */
  external?: boolean;
  /**
   * Kept out of the mobile tab bar, which only has room for a few
   * destinations. These stay reachable from the desktop rail and the
   * mobile settings sheet.
   */
  secondary?: boolean;
}

/**
 * Builds the primary navigation. The profile entry needs the signed-in pubkey,
 * so the list is derived rather than a static constant.
 */
export function getNavItems(pubkey?: string): NavItem[] {
  return [
    { section: 'main', href: '/', icon: Home, label: 'Home', shortcut: 'H' },
    { section: 'main', href: '/reels', icon: Film, label: 'Reels', shortcut: 'V' },
    { section: 'main', href: '/explore', icon: Compass, label: 'Explore', shortcut: 'E' },
    {
      section: 'main',
      href: '/chat',
      icon: MessagesSquare,
      label: 'Messages',
      shortcut: 'M',
      requiresAuth: true,
    },
    {
      section: 'main',
      href: '/notifications',
      icon: Bell,
      label: 'Notifications',
      shortcut: 'N',
      requiresAuth: true,
      secondary: true,
      badge: 'unread',
    },
    { section: 'discover', href: '/trending', icon: Flame, label: 'Trending', shortcut: 'T', secondary: true },
    {
      section: 'discover',
      href: '/articles',
      icon: BookOpen,
      label: 'Articles',
      secondary: true,
    },
    { section: 'discover', href: '/lists', icon: List, label: 'Lists', secondary: true },
    { section: 'discover', href: '/calendar', icon: CalendarDays, label: 'Calendar', secondary: true },
    {
      section: 'discover',
      href: '/communities',
      icon: Users,
      label: 'Communities',
      shortcut: 'G',
      secondary: true,
    },
    // NIP-29: hosted by one relay, unlike the communities above
    { section: 'discover', href: '/groups', icon: MessagesSquare, label: 'Groups', secondary: true },
    // NIP-53. Linked now that it reads real activities rather than a
    // hardcoded list of streams that did not exist
    { section: 'discover', href: '/live', icon: Radio, label: 'Live', secondary: true },
    {
      section: 'main',
      href: '/write',
      icon: PenLine,
      label: 'Write',
      shortcut: 'W',
      requiresAuth: true,
      secondary: true,
    },
    ...(pubkey
      ? [
          {
            section: 'main',
            href: `/${nip19.npubEncode(pubkey)}`,
            icon: User,
            label: 'Profile',
            requiresAuth: true,
          } satisfies NavItem,
        ]
      : []),
    {
      section: 'discover',
      href: '/bookmarks',
      icon: Bookmark,
      label: 'Bookmarks',
      shortcut: 'B',
      requiresAuth: true,
      secondary: true,
    },
    /*
     * Filed under Sats rather than beside Write: it is about what the writing
     * earned, and somebody looking for their earnings looks where the money
     * is.
     */
    {
      section: 'money',
      href: '/studio',
      icon: ChartLine,
      label: 'Studio',
      requiresAuth: true,
      secondary: true,
    },
    {
      section: 'money',
      href: '/wallet',
      icon: Wallet,
      label: 'Wallet',
      shortcut: 'W',
      requiresAuth: true,
      secondary: true,
    },
    {
      section: 'money',
      href: '/ecash',
      icon: Banknote,
      label: 'Ecash',
      requiresAuth: true,
      secondary: true,
    },
    /*
     * Both were built, routed and then reachable only by typing the URL.
     * Neither needs an account to look at — a marketplace nobody can browse
     * without signing up is a marketplace with no sellers.
     */
    { section: 'money', href: '/market', icon: Store, label: 'Market', secondary: true },
    {
      section: 'money',
      href: '/p2p',
      icon: ArrowLeftRight,
      label: 'P2P',
      secondary: true,
    },
    {
      section: 'manage',
      href: '/relays',
      icon: Server,
      label: 'Relays',
      shortcut: 'R',
      secondary: true,
      badge: 'relays',
    },
    {
      section: 'manage',
      href: '/identity',
      icon: KeyRound,
      label: 'Identity',
      requiresAuth: true,
      secondary: true,
    },
    { section: 'money', href: '/premium', icon: Sparkles, label: 'Relay access', secondary: true },
    { section: 'manage', href: '/settings', icon: Settings, label: 'Settings', shortcut: ',', secondary: true },
    // The manual was reachable from the footer alone, which is the one place
    // somebody stuck on a page does not look
    { section: 'manage', href: '/docs', icon: CircleHelp, label: 'Help', secondary: true },
    {
      section: 'manage',
      href: COMMUNITY.url,
      icon: LifeBuoy,
      label: COMMUNITY.name,
      secondary: true,
      external: true,
    },
    { href: '/compose', icon: PenSquare, label: 'Compose', shortcut: 'C', requiresAuth: true },
  ];
}

/** True when `href` is the active route, treating "/" as an exact match only. */
export function isActiveRoute(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The order sections appear in, with the label shown above each. */
export const NAV_SECTIONS: { id: NavSection; label: string }[] = [
  { id: 'main', label: '' },
  { id: 'discover', label: 'Discover' },
  { id: 'money', label: 'Sats' },
  { id: 'manage', label: 'Manage' },
];

/**
 * Groups nav items for display, dropping empty sections.
 *
 * The first section is deliberately unlabelled: a heading above Home is noise,
 * and the items below it are the ones people came for.
 */
export function groupNavItems(
  items: NavItem[]
): { id: NavSection; label: string; items: NavItem[] }[] {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: items.filter((item) => (item.section ?? 'main') === section.id),
  })).filter((section) => section.items.length > 0);
}
