import {
  ArrowLeftRight,
  Banknote,
  Bell,
  BookOpen,
  Bookmark,
  CalendarDays,
  Compass,
  Film,
  Flame,
  Home,
  KeyRound,
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

/**
 * Which part of the rail an entry belongs to.
 *
 * Nineteen destinations in one flat column is a wall a reader has to scan
 * rather than a menu they can use — and on a 13-inch laptop it is also taller
 * than the viewport, which used to put Settings below the fold with nothing to
 * scroll. Sections give the eye somewhere to stop.
 */
export type NavSection = 'main' | 'discover' | 'money' | 'manage';

export interface NavItem {
  section?: NavSection;
  href: string;
  icon: LucideIcon;
  label: string;
  /** Keyboard shortcut hint shown in the desktop rail. */
  shortcut?: string;
  /** Only reachable while logged in. */
  requiresAuth?: boolean;
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
    },
    { section: 'discover', href: '/trending', icon: Flame, label: 'Trending', shortcut: 'T', secondary: true },
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
    { section: 'manage', href: '/relays', icon: Server, label: 'Relays', shortcut: 'R', secondary: true },
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
    { section: 'manage', href: '/docs', icon: BookOpen, label: 'Help', secondary: true },
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
