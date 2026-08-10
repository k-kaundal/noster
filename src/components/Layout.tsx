import { ReactNode, Suspense, lazy, useState } from 'react';
import { AppHeader } from '@/components/layout/AppHeader';
import { LoadingBar } from '@/components/layout/LoadingBar';
import { SideNav } from '@/components/layout/SideNav';
import { RightRail } from '@/components/layout/RightRail';
import { MobileNav } from '@/components/layout/MobileNav';
import { FloatingActionButton } from '@/components/FloatingActionButton';
import { BackToTop } from '@/components/BackToTop';
import { UpdatePrompt } from '@/components/UpdatePrompt';
import { SignerAlert } from '@/components/auth/SignerAlert';
import { KeyboardShortcutsDialog } from '@/components/KeyboardShortcutsDialog';
import { useIdlePrefetch, useOnceOpened } from '@/hooks/useDeferredDialog';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useOutboxDrain } from '@/hooks/useOutbox';
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

/**
 * The palette is the front door — one keystroke, and it answers from memory.
 * Loaded on idle for the same reason as search: it must be instant the first
 * time it is asked for, without being in the first paint.
 */
const loadPalette = () => import('@/components/CommandPalette');
const CommandPalette = lazy(() =>
  loadPalette().then((m) => ({ default: m.CommandPalette }))
);

interface LayoutProps {
  children: ReactNode;
  /** Drops the discovery rail — for pages that manage their own wide layout. */
  fullWidth?: boolean;
}

export function Layout({ children, fullWidth = false }: LayoutProps) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const searchMounted = useOnceOpened(searchOpen);
  const paletteMounted = useOnceOpened(paletteOpen);

  useIdlePrefetch(loadPalette);
  useIdlePrefetch(loadSearch);

  /**
   * One front door.
   *
   * Every way of asking for something — the key, the slash, the magnifier in
   * the header, the one in the mobile bar — opens the palette. Relay search is
   * inside it, as the answer for anything the browser does not already know.
   */
  const openPalette = () => setPaletteOpen(true);

  const searchNostr = (query: string) => {
    setSearchQuery(query);
    setSearchOpen(true);
  };

  // Here rather than on one page, so anything queued goes out as soon as
  // sending works again — whichever page the reader happens to be on
  useOutboxDrain();

  useKeyboardShortcuts({
    onSearch: openPalette,
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

      <AppHeader onSearch={openPalette} />

      {/* Under the header rather than over the page: a signer that has gone
          away only matters when you go to write, and reading works fine */}
      <SignerAlert />

      <div className="container flex gap-8 pb-24 pt-6 lg:gap-12 lg:pb-16 lg:pt-8">
        <aside className="hidden w-52 shrink-0 lg:block">
          <div className="sticky top-[calc(var(--header-height)+1.5rem)]">
            <SideNav />
          </div>
        </aside>

        <main
          id="main-content"
          /*
           * Deliberately not keyed on the route.
           *
           * It was, so that every navigation replayed an entrance animation —
           * which meant every click in the sidebar tore down the whole page
           * and built it again, skeletons and all, even for a page that was
           * already loaded and cached. That teardown is the flicker, and it
           * also undoes scroll restoration: there is nothing to scroll to at
           * the moment the position is restored. Pages animate their own
           * contents in; the shell does not need to flash to prove something
           * happened, and the loading bar at the top says so anyway.
           */
          className={cn(
            'min-w-0 flex-1',
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

      <MobileNav onSearch={openPalette} />
      <FloatingActionButton />
      <BackToTop />
      <UpdatePrompt />

      <Suspense fallback={null}>
        {paletteMounted && (
          <CommandPalette
            open={paletteOpen}
            onOpenChange={setPaletteOpen}
            onSearchNostr={searchNostr}
          />
        )}
        {searchMounted && (
          <SearchDialog
            open={searchOpen}
            onOpenChange={setSearchOpen}
            initialQuery={searchQuery}
          />
        )}
      </Suspense>
      <KeyboardShortcutsDialog
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
      />
    </div>
  );
}
