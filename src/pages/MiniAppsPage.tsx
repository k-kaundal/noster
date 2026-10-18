import { useState } from 'react';
import { Code, ExternalLink, Search } from 'lucide-react';

import { Layout } from '@/components/Layout';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthor } from '@/hooks/useAuthor';
import { useAppDirectory } from '@/hooks/useAppDirectory';
import { useSeo } from '@/hooks/useSeo';
import { genUserName } from '@/lib/genUserName';

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

  const filtered = apps.filter(
    ({ handler }) =>
      handler.name.toLowerCase().includes(search.toLowerCase()) ||
      handler.about?.toLowerCase().includes(search.toLowerCase())
  );

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
            {filtered.map(({ handler, recommendations, recommendedFor }) => (
              <AppCard
                key={handler.address}
                handler={handler}
                recommendations={recommendations}
                recommendedFor={recommendedFor}
              />
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}

function AppCard({
  handler,
  recommendations,
}: {
  handler: ReturnType<typeof useAppDirectory>['apps'][number]['handler'];
  recommendations: number;
  recommendedFor: number[];
}) {
  const author = useAuthor(handler.author);
  const metadata = author.data?.metadata;
  const authorName =
    metadata?.display_name || metadata?.name || genUserName(handler.author);

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex items-start gap-3">
          <Avatar className="h-10 w-10 shrink-0 rounded-lg">
            <AvatarImage src={handler.picture} alt="" className="rounded-lg" />
            <AvatarFallback className="rounded-lg text-sm">
              {handler.name.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>

          <div className="min-w-0 flex-1 space-y-1">
            <h3 className="font-semibold leading-tight">{handler.name}</h3>
            <p className="text-xs text-muted-foreground">
              by {authorName}
            </p>
          </div>
        </div>

        {handler.about && (
          <p className="line-clamp-2 text-sm text-muted-foreground">
            {handler.about}
          </p>
        )}

        <div className="flex flex-wrap gap-1">
          {handler.kinds.slice(0, 4).map((kind) => (
            <Badge key={kind} variant="secondary" className="text-xs">
              kind {kind}
            </Badge>
          ))}
          {handler.kinds.length > 4 && (
            <Badge variant="outline" className="text-xs">
              +{handler.kinds.length - 4} more
            </Badge>
          )}
        </div>

        <div className="flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
          <span>
            {recommendations} {recommendations === 1 ? 'person uses' : 'people use'} this
          </span>

          {handler.urlTemplate && (
            <a
              href={handler.urlTemplate.replace('<bech32>', '')}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-primary hover:underline"
            >
              Open
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default MiniAppsPage;
