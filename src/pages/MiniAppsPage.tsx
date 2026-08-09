import { Code } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { PageHeader } from '@/components/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MiniAppCard, type MiniApp } from '@/components/miniapps/MiniAppCard';
import { CreateMiniAppDialog } from '@/components/miniapps/CreateMiniAppDialog';
import { useSeo } from '@/hooks/useSeo';

/**
 * Mini Apps Page: Discover and manage community-built extensions.
 *
 * Features:
 * - Browse mini apps by category (Tools, Games, Utilities, Finance, Social)
 * - Rate and review mini apps
 * - Submit your own mini app to the ecosystem
 * - Manage permissions for installed apps
 * - Real-time updates as new apps are submitted
 */
export function MiniAppsPage() {
  useSeo({
    title: 'Mini Apps',
    description: 'Discover and install mini apps to extend NostrFeed.',
    path: '/mini-apps',
  });

  // Mock mini apps data
  const mockApps: MiniApp[] = [
    {
      id: '1',
      name: 'Bitcoin Price Ticker',
      description: 'Live BTC/USD price updates with 24h change and chart',
      developer: 'pricetracker',
      developerImage: 'https://i.pravatar.cc/150?u=pricetracker',
      rating: 4.8,
      reviews: 234,
      installs: 45000,
      category: 'Tools',
      permissions: ['read:global_feed', 'write:notes'],
      url: 'https://btc-ticker.example.com',
    },
    {
      id: '2',
      name: 'Lightning Dice Game',
      description: 'Roll the dice and earn sats! Fair gambling with provable fairness',
      developer: 'gamestudio',
      developerImage: 'https://i.pravatar.cc/150?u=gamestudio',
      rating: 4.5,
      reviews: 189,
      installs: 32000,
      category: 'Games',
      permissions: ['read:wallet', 'write:zaps'],
      url: 'https://lightning-dice.example.com',
    },
    {
      id: '3',
      name: 'Note Translator',
      description: 'Translate Nostr notes to any language with one click',
      developer: 'translatedev',
      developerImage: 'https://i.pravatar.cc/150?u=translatedev',
      rating: 4.6,
      reviews: 156,
      installs: 28000,
      category: 'Utilities',
      permissions: ['read:notes'],
      url: 'https://note-translator.example.com',
    },
    {
      id: '4',
      name: 'Portfolio Tracker',
      description: 'Track your crypto portfolio with real-time prices and alerts',
      developer: 'financedev',
      developerImage: 'https://i.pravatar.cc/150?u=financedev',
      rating: 4.7,
      reviews: 267,
      installs: 56000,
      category: 'Finance',
      permissions: ['read:wallet', 'read:global_feed'],
      url: 'https://portfolio-tracker.example.com',
    },
    {
      id: '5',
      name: 'Group Chat',
      description: 'Private encrypted group conversations for communities',
      developer: 'socialdev',
      developerImage: 'https://i.pravatar.cc/150?u=socialdev',
      rating: 4.9,
      reviews: 423,
      installs: 78000,
      category: 'Social',
      permissions: ['read:dms', 'write:dms', 'read:profile'],
      url: 'https://group-chat.example.com',
    },
    {
      id: '6',
      name: 'Media Gallery',
      description: 'Beautiful photo gallery for images and videos shared on Nostr',
      developer: 'mediadev',
      developerImage: 'https://i.pravatar.cc/150?u=mediadev',
      rating: 4.4,
      reviews: 112,
      installs: 21000,
      category: 'Utilities',
      permissions: ['read:notes'],
      url: 'https://media-gallery.example.com',
    },
    {
      id: '7',
      name: 'Habit Tracker',
      description: 'Build better habits and share your progress with the community',
      developer: 'habitdev',
      developerImage: 'https://i.pravatar.cc/150?u=habitdev',
      rating: 4.6,
      reviews: 98,
      installs: 15000,
      category: 'Tools',
      permissions: ['write:notes', 'read:profile'],
      url: 'https://habit-tracker.example.com',
    },
    {
      id: '8',
      name: 'Lightning Invoice Generator',
      description: 'Create and manage Lightning Network invoices for payments',
      developer: 'lntools',
      developerImage: 'https://i.pravatar.cc/150?u=lntools',
      rating: 4.8,
      reviews: 201,
      installs: 34000,
      category: 'Finance',
      permissions: ['read:wallet', 'write:wallet'],
      url: 'https://ln-invoice.example.com',
    },
    {
      id: '9',
      name: 'Word Game Arena',
      description: 'Multiplayer word games with leaderboards and sats prizes',
      developer: 'wordgames',
      developerImage: 'https://i.pravatar.cc/150?u=wordgames',
      rating: 4.3,
      reviews: 145,
      installs: 27000,
      category: 'Games',
      permissions: ['read:global_feed', 'write:zaps'],
      url: 'https://word-games.example.com',
    },
  ];

  const categories = ['All', 'Tools', 'Games', 'Utilities', 'Finance', 'Social'];

  const getAppsByCategory = (category: string) => {
    if (category === 'All') return mockApps;
    return mockApps.filter((app) => app.category === category);
  };

  const totalInstalls = mockApps.reduce((sum, app) => sum + app.installs, 0);
  const avgRating =
    (mockApps.reduce((sum, app) => sum + app.rating, 0) / mockApps.length).toFixed(1);

  return (
    <Layout>
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <PageHeader
            icon={Code}
            title="Mini Apps"
            description="Extend NostrFeed with community-built apps and tools."
          />
          <CreateMiniAppDialog />
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <StatCard
            label="Available Apps"
            value={String(mockApps.length)}
          />
          <StatCard
            label="Total Installs"
            value={`${(totalInstalls / 1000000).toFixed(1)}M`}
          />
          <StatCard
            label="Avg Rating"
            value={avgRating}
            subtitle="/ 5.0"
          />
        </div>

        {/* Browse Apps by Category */}
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground mb-4">
            Browse by Category
          </h2>
          <Tabs defaultValue="All" className="w-full">
            <TabsList className="grid w-full grid-cols-2 md:grid-cols-6">
              {categories.map((category) => (
                <TabsTrigger key={category} value={category}>
                  {category}
                </TabsTrigger>
              ))}
            </TabsList>

            {categories.map((category) => (
              <TabsContent key={category} value={category} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {getAppsByCategory(category).map((app) => (
                    <MiniAppCard key={app.id} app={app} />
                  ))}
                </div>
              </TabsContent>
            ))}
          </Tabs>
        </div>

        {/* Info Card */}
        <Card>
          <CardContent className="p-6">
            <h3 className="font-semibold mb-4">How Mini Apps Work</h3>
            <div className="space-y-3 text-sm text-muted-foreground">
              <div className="flex gap-3">
                <span className="font-bold text-foreground">1.</span>
                <span>
                  Browse mini apps in different categories (Tools, Games, Finance, etc.)
                </span>
              </div>
              <div className="flex gap-3">
                <span className="font-bold text-foreground">2.</span>
                <span>
                  Click "Install" to add an app to your NostrFeed dashboard
                </span>
              </div>
              <div className="flex gap-3">
                <span className="font-bold text-foreground">3.</span>
                <span>
                  Review what permissions the app needs to function
                </span>
              </div>
              <div className="flex gap-3">
                <span className="font-bold text-foreground">4.</span>
                <span>
                  Mini apps load securely with restricted access to your data
                </span>
              </div>
              <div className="flex gap-3">
                <span className="font-bold text-foreground">5.</span>
                <span>
                  Submit your own app to share with the community and earn tips
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Developer Guide */}
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="p-6">
            <h3 className="font-semibold mb-3">Build a Mini App</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Create interactive apps that extend NostrFeed functionality. Mini apps run in a
              secure sandbox with permission-based access to user data.
            </p>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>
                <strong>Technologies:</strong> React, TypeScript, Nostr-tools
              </p>
              <p>
                <strong>Access:</strong> Read profiles, notes, wallet info; write notes, zaps, DMs
              </p>
              <p>
                <strong>Revenue:</strong> Earn sats from tips, in-app purchases, or sponsorships
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}

function StatCard({ label, value, subtitle }: { label: string; value: string; subtitle?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          {label}
        </p>
        <div>
          <p className="text-2xl font-bold">{value}</p>
          {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

export default MiniAppsPage;
