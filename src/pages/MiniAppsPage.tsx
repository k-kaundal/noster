import { useState } from 'react';
import { Code, Search } from 'lucide-react';

import { Layout } from '@/components/Layout';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useAppDirectory, useAppSearch } from '@/hooks/useAppDirectory';
import { useSeo } from '@/hooks/useSeo';
import { AppCard } from '@/components/apps';

/**
 * Mini apps: what other people use to open Nostr content.
 *
 * The directory is built from NIP-89 — handlers developers announced, and
 * recommendations from people who actually run them. An app with no
 * recommendations is not listed, which keeps the page about what works rather
 * than what was announced.
 *
 * This is not an app store. Nothing here runs inside NostrFeed; each entry is
 * a link out to wherever that app lives.
 */
export function MiniAppsPage() {
  useSeo({
    title: 'Mini Apps',
    description:
      'Apps people on Nostr use to open different kinds of content, read off the network.',
    path: '/mini-apps',
  });

  const { apps, isLoading, error } = useAppDirectory();
  const [search, setSearch] = useState('');
  const filtered = useAppSearch(apps, search);

  return (
    <Layout>
      <div className="space-y-6">
        <PageHeader
          icon={Code}
          title="Mini Apps"
          description="Apps people on Nostr use, read off the network. Each opens a different kind of content."
        />

        {apps.length > 0 && (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search apps…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pl-9"
            />
          </div>
        )}

        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Card key={index}>
                <CardContent className="space-y-3 pt-6">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-24" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : error ? (
          <EmptyState
            icon={Code}
            title="Couldn't load apps"
            description="The relay didn't respond in time."
            showRelaySelector
          />
        ) : !filtered.length ? (
          <EmptyState
            icon={Code}
            title={search ? 'No apps match' : 'No apps here'}
            description={
              search
                ? 'Try a different search.'
                : 'No app handlers with recommendations on this relay.'
            }
            showRelaySelector={!search}
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {filtered.map((app) => (
              <AppCard key={app.handler.address} app={app} />
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}

export default MiniAppsPage;
