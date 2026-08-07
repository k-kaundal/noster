import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { Logo } from '@/components/Logo';
import { LoginArea } from '@/components/auth/LoginArea';
import { ThemeToggle } from '@/components/ThemeToggle';
import { AccentPicker } from '@/components/AccentPicker';
import { RelaySelector } from '@/components/RelaySelector';
import { ConnectionStatus } from '@/components/ConnectionStatus';
import { NotificationBadge } from '@/components/NotificationBadge';
import { SideNav } from '@/components/layout/SideNav';

interface AppHeaderProps {
  onSearch: () => void;
}

/** Sticky top bar: brand, search entry point, and account controls. */
export function AppHeader({ onSearch }: AppHeaderProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/70">
      <div className="container flex h-14 items-center gap-3">
        <Link
          to="/"
          className="flex shrink-0 items-center rounded-md"
          aria-label="NostrFeed home"
        >
          <Logo markOnly className="sm:hidden" />
          <Logo className="hidden sm:flex" />
        </Link>

        {/* Search opens the command dialog; styled as a field so it reads as one */}
        <button
          type="button"
          onClick={onSearch}
          className="ml-auto hidden h-9 w-full max-w-xs items-center gap-2 rounded-lg border bg-muted/50 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted md:flex lg:ml-4 lg:mr-auto"
        >
          <Search className="h-4 w-4 shrink-0" />
          <span className="flex-1 text-left">Search Nostr…</span>
          <kbd className="hidden rounded border bg-background px-1.5 font-mono text-[10px] font-medium lg:inline-block">
            ⌘K
          </kbd>
        </button>

        <div className="ml-auto flex items-center gap-0.5 md:ml-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={onSearch}
            aria-label="Search"
            className="md:hidden"
          >
            <Search className="h-[1.2rem] w-[1.2rem]" />
          </Button>

          <NotificationBadge />

          <div className="hidden items-center gap-0.5 md:flex">
            <ConnectionStatus />
            <AccentPicker />
            <ThemeToggle />
          </div>

          {/* Relay + theme controls live in a sheet on small screens */}
          <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Menu and settings" className="lg:hidden">
                <Settings2 className="h-[1.2rem] w-[1.2rem]" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[85vw] max-w-sm">
              <SheetHeader className="text-left">
                <SheetTitle>
                  <Logo />
                </SheetTitle>
              </SheetHeader>

              <div className="mt-6 space-y-6">
                <div onClick={() => setSettingsOpen(false)} role="presentation">
                  <SideNav />
                </div>

                <Separator />

                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Relay
                  </p>
                  <div className="flex items-center gap-2">
                    <RelaySelector className="flex-1" />
                    <ConnectionStatus />
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Appearance
                  </p>
                  <div className="flex items-center gap-1">
                    <AccentPicker />
                    <ThemeToggle />
                  </div>
                </div>
              </div>
            </SheetContent>
          </Sheet>

          <LoginArea className="ml-1 max-w-52" />
        </div>
      </div>
    </header>
  );
}
