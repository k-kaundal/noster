import {
  Bell,
  Bookmark,
  Compass,
  Film,
  Flame,
  Home,
  MessagesSquare,
  PenSquare,
  Server,
  Settings,
  User,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { nip19 } from 'nostr-tools';

export interface NavItem {
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
    { href: '/', icon: Home, label: 'Home', shortcut: 'H' },
    { href: '/reels', icon: Film, label: 'Reels', shortcut: 'V' },
    { href: '/explore', icon: Compass, label: 'Explore', shortcut: 'E' },
    {
      href: '/chat',
      icon: MessagesSquare,
      label: 'Messages',
      shortcut: 'M',
      requiresAuth: true,
    },
    {
      href: '/notifications',
      icon: Bell,
      label: 'Notifications',
      shortcut: 'N',
      requiresAuth: true,
      secondary: true,
    },
    { href: '/trending', icon: Flame, label: 'Trending', shortcut: 'T', secondary: true },
    ...(pubkey
      ? [
          {
            href: `/${nip19.npubEncode(pubkey)}`,
            icon: User,
            label: 'Profile',
            requiresAuth: true,
          } satisfies NavItem,
        ]
      : []),
    {
      href: '/bookmarks',
      icon: Bookmark,
      label: 'Bookmarks',
      shortcut: 'B',
      requiresAuth: true,
      secondary: true,
    },
    { href: '/relays', icon: Server, label: 'Relays', shortcut: 'R', secondary: true },
    { href: '/settings', icon: Settings, label: 'Settings', shortcut: ',', secondary: true },
    { href: '/compose', icon: PenSquare, label: 'Compose', shortcut: 'C', requiresAuth: true },
  ];
}

/** True when `href` is the active route, treating "/" as an exact match only. */
export function isActiveRoute(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}
