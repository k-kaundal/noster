import { Link, useLocation } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { getNavItems, isActiveRoute } from '@/components/layout/navigation';
import { cn } from '@/lib/utils';

interface MobileNavProps {
  onSearch: () => void;
}

/**
 * Thumb-reachable bottom tab bar for small screens, replacing the old
 * hamburger-only navigation.
 */
export function MobileNav({ onSearch }: MobileNavProps) {
  const location = useLocation();
  const { user } = useCurrentUser();

  // Compose lives in the floating action button, and secondary destinations
  // live in the settings sheet, so the bar keeps a comfortable tap target size.
  const items = getNavItems(user?.pubkey).filter(
    (item) =>
      item.href !== '/compose' &&
      !item.secondary &&
      (!item.requiresAuth || user)
  );

  return (
    <nav
      className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t bg-background lg:hidden"
      aria-label="Primary"
    >
      <div className="flex items-stretch justify-around">
        {items.map((item) => {
          const active = isActiveRoute(location.pathname, item.href);
          return (
            <Link
              key={item.href}
              to={item.href}
              aria-current={active ? 'page' : undefined}
              aria-label={item.label}
              className={cn(
                'relative flex min-w-0 flex-1 flex-col items-center gap-1 px-1 py-2 text-[10px] font-medium transition-colors',
                active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {active && (
                <span className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-foreground" />
              )}
              <item.icon className="h-5 w-5" />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}

        <button
          type="button"
          onClick={onSearch}
          aria-label="Search"
          className="flex min-w-0 flex-1 flex-col items-center gap-1 px-1 py-2 text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <Search className="h-5 w-5" />
          <span className="truncate">Search</span>
        </button>
      </div>
    </nav>
  );
}
