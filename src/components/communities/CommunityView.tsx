import { useState } from 'react';
import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';
import { Check, Loader2, Shield, Users, Edit } from 'lucide-react';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import {
  useApprovePost,
  useCommunityPosts,
  usePostToCommunity,
} from '@/hooks/useCommunities';
import { useSeo } from '@/hooks/useSeo';
import { genUserName } from '@/lib/genUserName';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Post } from '@/components/Post';
import { PostSkeletonList } from '@/components/PostSkeleton';
import { canModerate, type Community } from '@/lib/community';
import { CommunityEditor } from './CommunityEditor';
import { CommunityVerificationBadge } from './CommunityVerificationBadge';

/** A community: what it is, who runs it, and what has been approved into it. */
export function CommunityView({ community }: { community: Community }) {
  const { user } = useCurrentUser();
  const { approved, pending, isLoading } = useCommunityPosts(community);
  const isModerator = canModerate(community, user?.pubkey);
  const [isEditingCommunity, setIsEditingCommunity] = useState(false);

  useSeo({
    title: community.name,
    description:
      community.description || `A community on Nostr, moderated by its owners.`,
    image: community.image,
    path: `/${nip19.naddrEncode({
      kind: community.event.kind,
      pubkey: community.creator,
      identifier: community.slug,
    })}`,
  });

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden">
        {community.image && (
          <img
            src={community.image}
            alt=""
            className="h-32 w-full object-cover sm:h-44"
          />
        )}

        <CardContent className="space-y-3 pt-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight">
                {community.name}
              </h1>
              {community.description && (
                <p className="text-sm text-muted-foreground">
                  {community.description}
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-2 shrink-0 items-center">
              <CommunityVerificationBadge community={community} />
              {isModerator && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setIsEditingCommunity(true)}
                    className="gap-2"
                  >
                    <Edit className="h-4 w-4" />
                    Edit
                  </Button>
                  <Badge variant="secondary" className="gap-1">
                    <Shield className="h-3 w-3" />
                    You moderate this
                  </Badge>
                </>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
            <Users className="h-3.5 w-3.5" />
            <span>
              {community.moderators.length}{' '}
              {community.moderators.length === 1 ? 'moderator' : 'moderators'}
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              {community.moderators.slice(0, 6).map((pubkey) => (
                <ModeratorChip key={pubkey} pubkey={pubkey} />
              ))}
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Anyone can post here. A moderator has to approve a post before it
            shows in the main tab — that is what NIP-72 means by moderated, and
            nothing stops an unapproved post existing on relays.
          </p>
        </CardContent>
      </Card>

      {user && <ComposeToCommunity community={community} />}

      <Tabs defaultValue="approved">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="approved" className="flex-1 sm:flex-none">
            Posts {approved.length > 0 && `(${approved.length})`}
          </TabsTrigger>
          <TabsTrigger value="pending" className="flex-1 sm:flex-none">
            {isModerator ? 'Awaiting review' : 'Unapproved'}{' '}
            {pending.length > 0 && `(${pending.length})`}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="approved" className="mt-4 space-y-4">
          {isLoading ? (
            <PostSkeletonList count={3} />
          ) : approved.length === 0 ? (
            <EmptyTab message="Nothing approved yet." />
          ) : (
            approved.map((post) => <Post key={post.id} event={post} />)
          )}
        </TabsContent>

        <TabsContent value="pending" className="mt-4 space-y-4">
          {isLoading ? (
            <PostSkeletonList count={2} />
          ) : pending.length === 0 ? (
            <EmptyTab message="Nothing waiting." />
          ) : (
            pending.map((post) => (
              <PendingPost
                key={post.id}
                post={post}
                community={community}
                canApprove={isModerator}
              />
            ))
          )}
        </TabsContent>
      </Tabs>

      {isEditingCommunity && isModerator && (
        <CommunityEditor
          community={community}
          onClose={() => setIsEditingCommunity(false)}
        />
      )}
    </div>
  );
}

function EmptyTab({ message }: { message: string }) {
  return (
    <Card className="border-dashed">
      <CardContent className="py-10 text-center text-sm text-muted-foreground">
        {message}
      </CardContent>
    </Card>
  );
}

function ModeratorChip({ pubkey }: { pubkey: string }) {
  const author = useAuthor(pubkey);
  const metadata = author.data?.metadata;
  const name = metadata?.name || genUserName(pubkey);

  return (
    <Link
      to={`/${nip19.npubEncode(pubkey)}`}
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 hover:bg-muted"
    >
      <Avatar className="h-4 w-4">
        <AvatarImage src={metadata?.picture} alt="" />
        <AvatarFallback className="text-[8px]">
          {name.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <span className="max-w-[8rem] truncate">{name}</span>
    </Link>
  );
}

function ComposeToCommunity({ community }: { community: Community }) {
  const { post, isPosting } = usePostToCommunity(community);
  const [content, setContent] = useState('');

  return (
    <Card>
      <CardContent className="space-y-2 pt-5">
        <Textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder={`Post to ${community.name}…`}
          aria-label={`Post to ${community.name}`}
          className="min-h-[80px] resize-none"
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Goes to the moderators first.
          </p>
          <Button
            size="sm"
            disabled={isPosting || !content.trim()}
            onClick={() =>
              post(content).then(
                () => setContent(''),
                () => undefined
              )
            }
          >
            {isPosting && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            Post
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PendingPost({
  post,
  community,
  canApprove,
}: {
  post: NostrEvent;
  community: Community;
  canApprove: boolean;
}) {
  const { approve, isApproving } = useApprovePost(community);

  return (
    <div className="space-y-2">
      <Post event={post} showReplies={false} />

      {canApprove && (
        <div className="flex justify-end">
          <Button size="sm" disabled={isApproving} onClick={() => approve(post)}>
            {isApproving ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="mr-2 h-3.5 w-3.5" />
            )}
            Approve
          </Button>
        </div>
      )}
    </div>
  );
}
