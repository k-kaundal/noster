import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { List as ListIcon } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { AvatarStack } from '@/components/AvatarStack';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthor } from '@/hooks/useAuthor';
import { useLists } from '@/hooks/useLists';
import { useSeo } from '@/hooks/useSeo';
import { genUserName } from '@/lib/genUserName';
import { STARTER_PACK_KIND, type PeopleList } from '@/lib/lists';
import { timeAgo } from '@/lib/time';

/**
 * People lists other users have published.
 *
 * A list is worth opening because of who is in it, so the faces come before
 * anything else — a title and a count leave the one question that matters
 * unanswered.
 */
const ListsPage = () => {
  useSeo({
    title: 'Lists',
    description:
      'Curated groups of people on Nostr: follow sets and starter packs published by others.',
    path: '/lists',
  });

  const { data: lists, isLoading, error } = useLists();

  return (
    <Layout>
      <div className="space-y-5">
        <PageHeader
          icon={ListIcon}
          title="Lists"
          description="Groups of people someone thought belonged together."
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
            icon={ListIcon}
            title="Couldn't load lists"
            description="The relay didn't respond in time."
            showRelaySelector
          />
        ) : !lists?.length ? (
          <EmptyState
            icon={ListIcon}
            title="No lists here"
            description="This relay has no people lists on it. Another may."
            showRelaySelector
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {lists.map((list) => (
              <ListCard key={list.address} list={list} />
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
};

function ListCard({ list }: { list: PeopleList }) {
  const naddr = nip19.naddrEncode({
    kind: list.kind,
    pubkey: list.author,
    identifier: list.identifier,
  });

  return (
    <Card className="content-auto overflow-hidden hover-lift">
      <CardContent className="space-y-3 pt-6">
        <div className="flex items-start justify-between gap-3">
          <Link to={`/${naddr}`} className="min-w-0 flex-1">
            <h3 className="truncate font-semibold leading-snug hover:underline">
              {list.title}
            </h3>
          </Link>
          <span className="shrink-0 text-xs text-muted-foreground">
            {timeAgo(list.createdAt * 1000)}
          </span>
        </div>

        {list.description && (
          <p className="line-clamp-2 text-sm text-muted-foreground">
            {list.description}
          </p>
        )}

        <div className="flex items-center gap-2">
          <AvatarStack pubkeys={list.people} max={6} />
          <span className="text-xs text-muted-foreground">
            {list.people.length}{' '}
            {list.people.length === 1 ? 'person' : 'people'}
            {/* Only what is readable is counted; private members are
                encrypted to their author and cannot be seen from here */}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2 border-t pt-3">
          <Author pubkey={list.author} />
          {list.kind === STARTER_PACK_KIND && (
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              Starter pack
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Author({ pubkey }: { pubkey: string }) {
  const author = useAuthor(pubkey);
  const metadata = author.data?.metadata;
  const name = metadata?.display_name || metadata?.name || genUserName(pubkey);

  return (
    <Link
      to={`/${nip19.npubEncode(pubkey)}`}
      className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
    >
      <Avatar className="h-5 w-5 shrink-0">
        <AvatarImage src={metadata?.picture} alt="" />
        <AvatarFallback className="text-[9px]">
          {name.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <span className="truncate">{name}</span>
    </Link>
  );
}

export default ListsPage;
