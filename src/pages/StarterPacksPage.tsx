import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { UserPlus, Check, Sparkles } from 'lucide-react';

import { Layout } from '@/components/Layout';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { AvatarStack } from '@/components/AvatarStack';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useStarterPacks } from '@/hooks/useStarterPacks';
import { useFollowAll } from '@/hooks/useFollowAll';
import { useSeo } from '@/hooks/useSeo';
import { genUserName } from '@/lib/genUserName';
import type { PeopleList } from '@/lib/starterPacks';
import { timeAgo } from '@/lib/time';

/**
 * Starter packs: one-tap follow lists for people new to Nostr.
 *
 * A starter pack is a kind 39089 follow set, but the job it does is different
 * from a list you keep for yourself. It is the answer to "I just joined, who
 * do I follow" — a curated group someone else already vetted, published so a
 * stranger can follow all of them at once.
 *
 * The page only shows packs, not every follow set. A list of your own muted
 * accounts is not a starter pack, and mixing them here would make the page
 * about list management rather than onboarding.
 */
export function StarterPacksPage() {
  useSeo({
    title: 'Starter Packs',
    description:
      'Curated groups of people to follow when you are new to Nostr. One tap follows the whole pack.',
    path: '/starter-packs',
  });

  const { packs, isLoading, error } = useStarterPacks();

  return (
    <Layout>
      <div className="space-y-6">
        <PageHeader
          icon={Sparkles}
          title="Starter Packs"
          description="Curated groups to follow when you are new. One tap follows the whole pack."
        />

        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Card key={index}>
                <CardContent className="space-y-3 pt-6">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-7 w-32 rounded-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : error ? (
          <EmptyState
            icon={Sparkles}
            title="Couldn't load starter packs"
            description="The relay didn't respond in time."
            showRelaySelector
          />
        ) : !packs.length ? (
          <EmptyState
            icon={Sparkles}
            title="No starter packs here"
            description="This relay has no starter packs on it. Another may."
            showRelaySelector
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {packs.map((pack) => (
              <PackCard key={pack.address} pack={pack} />
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}

function PackCard({ pack }: { pack: PeopleList }) {
  const { user } = useCurrentUser();
  const { followAll, isFollowing, isDone } = useFollowAll();

  const author = useAuthor(pack.author);
  const metadata = author.data?.metadata;
  const authorName =
    metadata?.display_name || metadata?.name || genUserName(pack.author);
  const authorNpub = nip19.npubEncode(pack.author);

  const done = isDone(pack.address);

  return (
    <Card className="overflow-hidden">
      {pack.image && (
        <div className="aspect-[3/1] w-full overflow-hidden bg-muted">
          <img
            src={pack.image}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        </div>
      )}

      <CardContent className="space-y-4 p-4">
        <div className="space-y-1">
          <h3 className="font-semibold leading-snug">{pack.title}</h3>
          {pack.description && (
            <p className="line-clamp-2 text-sm text-muted-foreground">
              {pack.description}
            </p>
          )}
        </div>

        <div className="flex items-center gap-3">
          <AvatarStack pubkeys={pack.people} max={8} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {pack.people.length} {pack.people.length === 1 ? 'person' : 'people'}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t pt-3">
          <Link
            to={`/${authorNpub}`}
            className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
          >
            <Avatar className="h-5 w-5 shrink-0">
              <AvatarImage src={metadata?.picture} alt="" />
              <AvatarFallback className="text-[9px]">
                {authorName.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="truncate">{authorName}</span>
          </Link>

          <span className="shrink-0 text-xs text-muted-foreground">
            {timeAgo(pack.createdAt * 1000)}
          </span>
        </div>

        <Button
          className="w-full"
          onClick={() => followAll(pack)}
          disabled={isFollowing || done || !user}
          variant={done ? 'outline' : 'default'}
        >
          {done ? (
            <>
              <Check className="mr-2 h-4 w-4" />
              Following
            </>
          ) : isFollowing ? (
            'Following…'
          ) : (
            <>
              <UserPlus className="mr-2 h-4 w-4" />
              Follow all {pack.people.length}
            </>
          )}
        </Button>

        {!user && (
          <p className="text-center text-xs text-muted-foreground">
            Log in to follow this pack
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default StarterPacksPage;
