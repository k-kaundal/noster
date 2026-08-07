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
              'group relative flex items-center gap-3 rounded-full px-3.5 py-2.5 text-sm font-medium transition-all duration-200 ease-quart',
              active
                ? 'bg-primary/10 text-foreground ring-1 ring-inset ring-primary/15'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
            )}
          >
            {/* A short bar marks the active route without a heavy filled pill */}
            {active && (
              <span
                aria-hidden
                className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-brand-gradient"
              />
            )}
            <item.icon
              className={cn(
                'h-5 w-5 shrink-0 transition-transform duration-200 ease-spring group-hover:scale-110',
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
        <Button
          asChild
          size="lg"
          className="press mt-4 w-full rounded-full bg-brand-gradient shadow-glow transition-opacity hover:opacity-90"
        >
          <Link to="/compose">
            <PenSquare className="mr-2 h-4 w-4" />
            New post
          </Link>
        </Button>
      )}
    </nav>
  );
}
