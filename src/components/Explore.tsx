import { Compass, Image as ImageIcon, Link as LinkIcon, Users } from 'lucide-react';
import type { NostrEvent } from '@nostrify/nostrify';
import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { useExplore } from '@/hooks/useExplore';
import { useAuthor } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';
import { Post } from '@/components/Post';
import { PageHeader } from '@/components/PageHeader';
import { PostSkeletonList } from '@/components/PostSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { FollowButton } from '@/components/FollowButton';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export function Explore() {
  const { data, isLoading, error } = useExplore();

  const {
    recentPosts = [],
    postsWithImages = [],
    postsWithLinks = [],
    uniqueAuthors = [],
  } = data || {};

  return (
    <div className="space-y-5">
      <PageHeader
        icon={Compass}
        title="Explore"
        description="A cross-section of what's being posted right now."
      />

      {error ? (
        <EmptyState
          icon={Compass}
          title="Couldn't load explore content"
          description="The relay didn't respond in time."
          showRelaySelector
        />
      ) : (
        <Tabs defaultValue="latest" className="space-y-4">
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="latest" className="flex-1 sm:flex-none">
              Latest
            </TabsTrigger>
            <TabsTrigger value="media" className="flex-1 sm:flex-none">
              <ImageIcon className="mr-1.5 h-3.5 w-3.5" />
              Media
            </TabsTrigger>
            <TabsTrigger value="links" className="flex-1 sm:flex-none">
              <LinkIcon className="mr-1.5 h-3.5 w-3.5" />
              Links
            </TabsTrigger>
            <TabsTrigger value="people" className="flex-1 sm:flex-none">
              <Users className="mr-1.5 h-3.5 w-3.5" />
              People
            </TabsTrigger>
          </TabsList>

          <TabsContent value="latest" className="space-y-4">
            <PostList
              posts={recentPosts}
              isLoading={isLoading}
              emptyTitle="No posts found"
            />
          </TabsContent>

          <TabsContent value="media" className="space-y-4">
            <PostList
              posts={postsWithImages}
              isLoading={isLoading}
              emptyTitle="No posts with media"
            />
          </TabsContent>

          <TabsContent value="links" className="space-y-4">
            <PostList
              posts={postsWithLinks}
              isLoading={isLoading}
              emptyTitle="No posts with links"
            />
          </TabsContent>

          <TabsContent value="people">
            <Card>
              <CardContent className="divide-y p-0">
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 p-4">
                      <Skeleton className="h-10 w-10 rounded-full" />
                      <div className="flex-1 space-y-1.5">
                        <Skeleton className="h-3.5 w-32" />
                        <Skeleton className="h-3 w-48" />
                      </div>
                      <Skeleton className="h-8 w-20" />
                    </div>
                  ))
                ) : uniqueAuthors.length === 0 ? (
                  <p className="p-8 text-center text-sm text-muted-foreground">
                    No people found on this relay.
                  </p>
                ) : (
                  uniqueAuthors.map((pubkey) => (
                    <PersonRow key={pubkey} pubkey={pubkey} />
                  ))
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function PostList({
  posts,
  isLoading,
  emptyTitle,
}: {
  posts: NostrEvent[];
  isLoading: boolean;
  emptyTitle: string;
}) {
  if (isLoading) return <PostSkeletonList count={4} />;
  if (posts.length === 0) {
    return (
      <EmptyState
        icon={Compass}
        title={emptyTitle}
        description="Nothing matching on this relay right now."
        showRelaySelector
      />
    );
  }
  return (
    <>
      {posts.map((post) => (
        <Post key={post.id} event={post} />
      ))}
    </>
  );
}

function PersonRow({ pubkey }: { pubkey: string }) {
  const author = useAuthor(pubkey);
  const metadata = author.data?.metadata;
  const displayName =
    metadata?.display_name || metadata?.name || genUserName(pubkey);
  const npub = nip19.npubEncode(pubkey);

  return (
    <div className="flex items-center gap-3 p-4">
      <Link to={`/${npub}`} className="shrink-0">
        <Avatar className="h-10 w-10">
          <AvatarImage src={metadata?.picture} alt="" />
          <AvatarFallback className="text-xs">
            {displayName.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      </Link>

      <div className="min-w-0 flex-1">
        <Link
          to={`/${npub}`}
          className="block truncate text-sm font-semibold hover:underline"
        >
          {displayName}
        </Link>
        {metadata?.about && (
          <p className="line-clamp-1 text-xs text-muted-foreground">
            {metadata.about}
          </p>
        )}
      </div>

      <FollowButton pubkey={pubkey} />
    </div>
  );
}
