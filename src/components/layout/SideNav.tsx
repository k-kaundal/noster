import { Link, useLocation } from 'react-router-dom';
import { PenSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { getNavItems, isActiveRoute } from '@/components/layout/navigation';
import { cn } from '@/lib/utils';

/** Persistent left rail shown from the `lg` breakpoint up. */
export function SideNav({ className }: { className?: string }) {
  const location = useLocation();
  const { user } = useCurrentUser();
  const navItems = getNavItems(user?.pubkey).filter(
    (item) => !item.requiresAuth || user
  );

  return (
    <nav className={cn('flex flex-col gap-1', className)} aria-label="Primary">
      {navItems.map((item) => {
        const active = isActiveRoute(location.pathname, item.href);
        return (
          <Link
            key={item.href}
            to={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
              active
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
            )}
          >
            <item.icon
              className={cn(
                'h-5 w-5 shrink-0 transition-colors',
                active && 'text-primary'
              )}
            />
            <span className="flex-1">{item.label}</span>
            {item.shortcut && (
              <kbd className="hidden rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 xl:inline-block">
                {item.shortcut}
              </kbd>
            )}
          </Link>
        );
      })}

      {user && (
        <Button asChild size="lg" className="mt-4 w-full bg-brand-gradient shadow-sm hover:opacity-90">
          <Link to="/compose">
            <PenSquare className="mr-2 h-4 w-4" />
            New post
          </Link>
        </Button>
      )}
    </nav>
  );
}
