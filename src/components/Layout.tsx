import { ReactNode, Suspense, lazy, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { AppHeader } from '@/components/layout/AppHeader';
import { LoadingBar } from '@/components/layout/LoadingBar';
import { SideNav } from '@/components/layout/SideNav';
import { RightRail } from '@/components/layout/RightRail';
import { MobileNav } from '@/components/layout/MobileNav';
import { FloatingActionButton } from '@/components/FloatingActionButton';
import { BackToTop } from '@/components/BackToTop';
import { KeyboardShortcutsDialog } from '@/components/KeyboardShortcutsDialog';
import { useIdlePrefetch, useOnceOpened } from '@/hooks/useDeferredDialog';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { cn } from '@/lib/utils';

/**
 * Search lives on every page but opens on a keystroke. Fetching it once the
 * page is idle keeps it out of the first paint without making the first press
 * of `/` wait for a download.
 */
const loadSearch = () => import('@/components/SearchDialog');
const SearchDialog = lazy(() =>
  loadSearch().then((m) => ({ default: m.SearchDialog }))
);

interface LayoutProps {
  children: ReactNode;
  /** Drops the discovery rail — for pages that manage their own wide layout. */
  fullWidth?: boolean;
}

export function Layout({ children, fullWidth = false }: LayoutProps) {
  const { pathname } = useLocation();
  const [searchOpen, setSearchOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const searchMounted = useOnceOpened(searchOpen);

  useIdlePrefetch(loadSearch);

  useKeyboardShortcuts({
    onSearch: () => setSearchOpen(true),
    onHelp: () => setShortcutsOpen((open) => !open),
  });

  return (
    <div className="min-h-screen bg-surface">
      <LoadingBar />

      <a
        href="#main-content"
        className="sr-only z-[60] rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:absolute focus:left-4 focus:top-4"
      >
        Skip to content
      </a>

      <AppHeader onSearch={() => setSearchOpen(true)} />

      <div className="container flex gap-8 pb-24 pt-6 lg:gap-12 lg:pb-16 lg:pt-8">
        <aside className="hidden w-52 shrink-0 lg:block">
          <div className="sticky top-[calc(var(--header-height)+1.5rem)]">
            <SideNav />
          </div>
        </aside>

        <main
          id="main-content"
          // Keyed on the route so each navigation replays the entrance
          key={pathname}
          className={cn(
            'min-w-0 flex-1 animate-slide-up',
            !fullWidth && 'mx-auto w-full max-w-2xl'
          )}
        >
          {children}
        </main>

        {!fullWidth && (
          <aside className="hidden w-80 shrink-0 xl:block">
            <div className="sticky top-[calc(var(--header-height)+1.5rem)] max-h-[calc(100vh-var(--header-height)-3rem)] overflow-y-auto scrollbar-thin pr-1">
              <RightRail />
            </div>
          </aside>
        )}
      </div>

      <MobileNav onSearch={() => setSearchOpen(true)} />
      <FloatingActionButton />
      <BackToTop />

      <Suspense fallback={null}>
        {searchMounted && (
          <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
        )}
      </Suspense>
      <KeyboardShortcutsDialog
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
      />
    </div>
  );
}
