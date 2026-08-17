import { Link, useLocation } from 'react-router-dom';
import { PenSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import {
  getNavItems,
  groupNavItems,
  isActiveRoute,
  type NavItem,
} from '@/components/layout/navigation';
import { useNavBadges } from '@/hooks/useNavBadges';
import { cn } from '@/lib/utils';

/**
 * The left rail.
 *
 * Two things this has to survive that a flat list did not. It is taller than a
 * 13-inch laptop once every destination is signed in — nineteen rows plus a
 * button — so the links scroll and the compose button is pinned below them
 * rather than pushed off the bottom where nothing could reach it. And nineteen
 * rows in one column is a wall, so they are sectioned: a reader looking for
 * the wallet can stop scanning at "Sats".
 */
export function SideNav({
  className,
  /** Hides the keyboard hints and the compose button, for the mobile sheet. */
  compact = false,
  onNavigate,
}: {
  className?: string;
  compact?: boolean;
  onNavigate?: () => void;
}) {
  const location = useLocation();
  const { user } = useCurrentUser();
  const badges = useNavBadges();

  const navItems = getNavItems(user?.pubkey).filter(
    (item) => !item.requiresAuth || user
  );

  /**
   * Compose has its own button here and a floating one on mobile, so it never
   * needs a row of its own.
   */
  const sections = groupNavItems(
    navItems.filter((item) => item.href !== '/compose')
  );

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <nav
        className={cn(
          'flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto scrollbar-thin',
          // Room for the scrollbar so it never sits on top of a label
          !compact && 'pr-1'
        )}
        aria-label="Primary"
      >
        {sections.map((section) => (
          <div key={section.id} className="space-y-1">
            {section.label && (
              <p className="px-3 pb-0.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
                {section.label}
              </p>
            )}

            {section.items.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                active={isActiveRoute(location.pathname, item.href)}
                compact={compact}
                badge={item.badge ? badges[item.badge] : undefined}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        ))}
      </nav>

      {/*
        Outside the scrolling area on purpose. It is the one control here that
        is an action rather than a destination, and a primary action that
        scrolls away is one people conclude does not exist.
      */}
      {user && !compact && (
        <Button
          asChild
          size="lg"
          className="press mt-4 w-full shrink-0 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Link to="/compose">
            <PenSquare className="mr-2 h-4 w-4" />
            New post
          </Link>
        </Button>
      )}
    </div>
  );
}

function NavLink({
  item,
  active,
  compact,
  badge,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  compact: boolean;
  /** A live figure for the end of the row, when this destination has one. */
  badge?: string;
  onNavigate?: () => void;
}) {
  return (
    <Link
      to={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex items-center gap-3 rounded-lg px-3 text-sm transition-colors duration-150',
        // Bigger targets in the sheet, where this is being tapped
        compact ? 'py-2.5' : 'py-2',
        active
          ? 'bg-muted font-medium text-foreground'
          : 'font-normal text-muted-foreground hover:bg-muted/50 hover:text-foreground'
      )}
    >
      {/* A marker on the active row, so the eye finds it without reading */}
      {active && (
        <span
          aria-hidden="true"
          className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary"
        />
      )}

      <item.icon className="h-[18px] w-[18px] shrink-0" />
      <span className="flex-1 truncate">{item.label}</span>

      {/*
        The figure, and it displaces the shortcut rather than sitting beside
        it: both at the end of one row is two things competing for the same
        glance, and a hint about a key you already know is the one worth
        losing.

        Tabular numerals so a count that ticks 9 → 10 does not shift the row.
      */}
      {badge ? (
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/80">
          {badge}
        </span>
      ) : (
        /* Meaningless on a touch screen, so the sheet never shows them */
        item.shortcut &&
        !compact && (
          <kbd className="hidden rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 xl:inline-block">
            {item.shortcut}
          </kbd>
        )
      )}
    </Link>
  );
}
