import { ReactNode, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { LoginArea } from '@/components/auth/LoginArea';
import { ThemeToggle } from '@/components/ThemeToggle';
import { RelaySelector } from '@/components/RelaySelector';
import { ConnectionStatus } from '@/components/ConnectionStatus';
import { FloatingActionButton } from '@/components/FloatingActionButton';
import { SearchDialog } from '@/components/SearchDialog';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { NotificationBadge } from '@/components/NotificationBadge';
import { SuggestedFollows } from '@/components/SuggestedFollows';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { Home, User, PenTool, Search, Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { nip19 } from 'nostr-tools';

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const { user } = useCurrentUser();
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useKeyboardShortcuts({
    onSearch: () => setSearchOpen(true),
  });

  const navItems = [
    { href: '/', icon: Home, label: 'Home' },
    ...(user ? [{ href: `/${nip19.npubEncode(user.pubkey)}`, icon: User, label: 'Profile' }] : []),
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 animate-slide-up">
        <div className="container flex h-14 items-center justify-between px-4">
          <div className="flex items-center">
            <Link to="/" className="flex items-center space-x-2 hover-lift transition-all duration-200">
              <div className="h-6 w-6 bg-gradient-to-br from-purple-500 to-blue-600 rounded-full animate-pulse-slow" />
              <span className="hidden font-bold sm:inline-block bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
                NostrFeed
              </span>
            </Link>
          </div>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center space-x-6 text-sm font-medium">
            {navItems.map((item) => (
              <Link
                key={item.href}
                to={item.href}
                className={cn(
                  'transition-all duration-200 hover:text-foreground/80 hover:scale-105',
                  location.pathname === item.href
                    ? 'text-foreground font-semibold'
                    : 'text-foreground/60'
                )}
              >
                <span className="flex items-center space-x-2">
                  <item.icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{item.label}</span>
                </span>
              </Link>
            ))}
          </nav>

          {/* Mobile Menu Button */}
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>

          {/* Right-side Controls */}
          <div className="hidden md:flex items-center space-x-2">
            <RelaySelector className="w-[200px]" />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSearchOpen(true)}
              className="hover-lift transition-all duration-200"
            >
              <Search className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="hover-lift transition-all duration-200"
            >
              <NotificationBadge />
            </Button>
            <ConnectionStatus />
            <ThemeToggle />
            <LoginArea className="max-w-60" />
          </div>
        </div>

        {/* Mobile Navigation Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden bg-background border-b px-4 py-4 animate-slide-down">
            <nav className="flex flex-col space-y-4">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  to={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={cn(
                    'flex items-center space-x-2 text-sm font-medium transition-all duration-200 hover:text-foreground/80',
                    location.pathname === item.href
                      ? 'text-foreground font-semibold'
                      : 'text-foreground/60'
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </Link>
              ))}
              <RelaySelector className="w-full" />
              <div className="flex items-center space-x-2">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setSearchOpen(true);
                    setMobileMenuOpen(false);
                  }}
                >
                  <Search className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon">
                  <NotificationBadge />
                </Button>
                <ConnectionStatus />
                <ThemeToggle />
              </div>
              <LoginArea className="w-full" />
            </nav>
          </div>
        )}
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-6">
        <div className="flex flex-col lg:grid lg:grid-cols-4 gap-6">
          {/* Sidebar */}
          <aside className="lg:col-span-1 order-2 lg:order-1">
            <div className="sticky top-20 space-y-4">
              {user && (
                <div className="space-y-2">
                  <Link to="/compose">
                    <Button
                      className="w-full hover-lift transition-all duration-200 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
                      size="lg"
                    >
                      <PenTool className="h-4 w-4 mr-2" />
                      New Post
                    </Button>
                  </Link>
                </div>
              )}
              <SuggestedFollows />
              <div className="rounded-lg border bg-card p-4 hover-lift transition-all duration-200">
                <h3 className="font-semibold mb-2">Quick Actions</h3>
                <div className="space-y-2 text-sm">
                  <Link
                    to="/trending"
                    className="block text-muted-foreground hover:text-foreground transition-all duration-200 hover:translate-x-1"
                  >
                    🔥 Trending
                  </Link>
                  <Link
                    to="/explore"
                    className="block text-muted-foreground hover:text-foreground transition-all duration-200 hover:translate-x-1"
                  >
                    🧭 Explore
                  </Link>
                </div>
              </div>
            </div>
          </aside>

          {/* Main Content */}
          <div className="lg:col-span-3 order-1 lg:order-2">{children}</div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t py-6">
        <div className="container flex justify-center text-center text-sm text-muted-foreground">
          <p>&copy; {new Date().getFullYear()} nostrfeed.com</p>
        </div>
      </footer>

      {/* Floating Action Button */}
      <FloatingActionButton />

      {/* Search Dialog */}
      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}