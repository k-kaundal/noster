import { Compass, Flame, Home, PenSquare, Server, User } from 'lucide-react';
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
}

/**
 * Builds the primary navigation. The profile entry needs the signed-in pubkey,
 * so the list is derived rather than a static constant.
 */
export function getNavItems(pubkey?: string): NavItem[] {
  return [
    { href: '/', icon: Home, label: 'Home', shortcut: 'H' },
    { href: '/explore', icon: Compass, label: 'Explore', shortcut: 'E' },
    { href: '/trending', icon: Flame, label: 'Trending', shortcut: 'T' },
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
    { href: '/relays', icon: Server, label: 'Relays', shortcut: 'R' },
    { href: '/compose', icon: PenSquare, label: 'Compose', shortcut: 'C', requiresAuth: true },
  ];
}

/** True when `href` is the active route, treating "/" as an exact match only. */
export function isActiveRoute(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}
