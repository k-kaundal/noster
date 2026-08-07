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
              'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-150',
              active
                ? 'bg-muted font-medium text-foreground'
                : 'font-normal text-muted-foreground hover:bg-muted/50 hover:text-foreground'
            )}
          >
            <item.icon className="h-[18px] w-[18px] shrink-0" />
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
          className="press mt-5 w-full rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
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
