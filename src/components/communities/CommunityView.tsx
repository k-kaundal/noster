import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  Check,
  Clock,
  Edit,
  Info,
  Loader2,
  MessageSquare,
  Shield,
  Users,
} from 'lucide-react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Post } from '@/components/Post';
import { PostSkeletonList } from '@/components/PostSkeleton';
import { RelaySelector } from '@/components/RelaySelector';
import { canModerate, type Community } from '@/lib/community';
import {
  describeActivity,
  ownPending,
  summarizeCommunity,
} from '@/lib/communityStats';
import { CommunityEditor } from './CommunityEditor';
import { CommunityComposer } from './CommunityComposer';
import { ZapButton } from '@/components/ZapButton';
import { ZapStats } from '@/components/ZapStats';
import { CommunityVerificationBadge } from './CommunityVerificationBadge';
import { cn } from '@/lib/utils';

/** A community: what it is, who runs it, and what has been approved into it. */
export function CommunityView({ community }: { community: Community }) {
  const { user } = useCurrentUser();
  const { approved, pending, isLoading } = useCommunityPosts(community);
  const isModerator = canModerate(community, user?.pubkey);
  const [isEditingCommunity, setIsEditingCommunity] = useState(false);

  const stats = useMemo(
    () => summarizeCommunity(approved, pending),
    [approved, pending]
  );

  /**
   * The reader's own posts still waiting on a moderator.
   *
   * The single most confusing thing about a moderated board: you post, you are
   * told a moderator has to approve it, and then your post is nowhere you
   * would look — filed in a tab called "Unapproved" among strangers'. Lifting
   * yours out is what makes the wait legible rather than alarming.
   */
  const mine = useMemo(
    () => ownPending(pending, user?.pubkey),
    [pending, user?.pubkey]
  );

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

  const activity = describeActivity(stats.lastPostAt);

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden">
        {/*
          Banner and identity mark, rather than a banner alone.

          A community had no avatar at all, so every one of them looked like
          whatever photograph its creator picked — and two boards with similar
          cover images were indistinguishable at a glance in a back-and-forth
          between them. The mark overlaps the banner in the pattern people
          already read as "this is the thing, that is its backdrop".
        */}
        <div className="relative">
          {community.image ? (
            <img
              src={community.image}
              alt=""
              className="h-32 w-full object-cover sm:h-44"
            />
          ) : (
            <div className="h-20 w-full bg-gradient-to-br from-primary/20 via-primary/5 to-transparent sm:h-24" />
          )}

          <div className="absolute -bottom-8 left-5">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl border-4 border-card bg-muted">
              {community.image ? (
                <img
                  src={community.image}
                  alt=""
                  className="h-full w-full rounded-xl object-cover"
                />
              ) : (
                <Users className="h-6 w-6 text-muted-foreground" />
              )}
            </div>
          </div>
        </div>

        <CardContent className="space-y-4 pt-11">
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

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <CommunityVerificationBadge community={community} />
              {isModerator && (
                <>
                  <Badge variant="secondary" className="gap-1">
                    <Shield className="h-3 w-3" />
                    You moderate this
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setIsEditingCommunity(true)}
                    className="gap-2"
                  >
                    <Edit className="h-4 w-4" />
                    Edit
                  </Button>
                </>
              )}
            </div>
          </div>

          {/*
            Whether the place is alive, which is what somebody deciding to post
            here is actually asking. A post count on its own cannot answer it:
            forty posts from one person is not forty people, and a board whose
            last post was in March is not active whatever its total says.
          */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3 text-xs text-muted-foreground">
            <Stat icon={MessageSquare} value={stats.approved} label="posts" />
            <Stat
              icon={Users}
              value={stats.contributors}
              label={stats.contributors === 1 ? 'poster' : 'posters'}
            />
            {activity && (
              <span className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                {activity}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Shield className="h-3.5 w-3.5" />
              Moderated by
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              {community.moderators.slice(0, 6).map((pubkey) => (
                <ModeratorChip key={pubkey} pubkey={pubkey} />
              ))}
              {community.moderators.length > 6 && (
                <span className="text-xs text-muted-foreground">
                  +{community.moderators.length - 6}
                </span>
              )}
            </div>
          </div>

          {/*
            Paying the place, not a post in it.

            A community is an addressable event whose author is whoever made
            it, so a zap here reaches the person keeping it running — which is
            the only way to support the work of moderating, since moderating
            produces no posts of its own to zap.
          */}
          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            <ZapButton target={community.event} />
            <ZapStats event={community.event} />
          </div>
        </CardContent>
      </Card>

      {user && <ComposeToCommunity community={community} />}

      {/*
        Your own posts in the queue, above the board rather than buried in it.
        Only ever shown to the person waiting.
      */}
      {mine.length > 0 && (
        <section className="space-y-2">
          <h2 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            {mine.length === 1
              ? 'Your post, waiting for a moderator'
              : `Your ${mine.length} posts, waiting for a moderator`}
          </h2>
          {mine.map((post) => (
            <PendingPost
              key={post.id}
              post={post}
              community={community}
              canApprove={isModerator}
              isOwn
            />
          ))}
        </section>
      )}

      <Tabs defaultValue="approved">
        <TabsList>
          <TabsTrigger value="approved" className="gap-1.5">
            Posts
            {stats.approved > 0 && (
              <span className="tabular-nums opacity-60">{stats.approved}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="pending" className="gap-1.5">
            {isModerator ? 'Awaiting review' : 'Unapproved'}
            {stats.pending > 0 && (
              <span className="tabular-nums opacity-60">{stats.pending}</span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="approved" className="mt-4 space-y-4">
          {isLoading ? (
            <PostSkeletonList count={3} />
          ) : approved.length === 0 ? (
            <EmptyTab
              message="Nothing approved yet."
              hint="Posts appear here once a moderator lets them in."
              offerRelays
            />
          ) : (
            approved.map((post) => <Post key={post.id} event={post} />)
          )}
        </TabsContent>

        <TabsContent value="pending" className="mt-4 space-y-4">
          {/*
            What this tab actually is, said where it is relevant rather than
            as a paragraph in the header everyone scrolls past. Non-moderators
            get the same explanation — previously they were shown a tab
            labelled "Unapproved" with no clue what that meant or why they
            could see it at all.
          */}
          <p className="flex items-start gap-2 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Anyone can address a post to this community, and NIP-72 leaves it
              here until a moderator approves it.{' '}
              {isModerator
                ? 'Approving publishes your signature saying it belongs — nothing here can be deleted from relays, only let in.'
                : 'These are real posts on the network; they just have not been let in yet.'}
            </span>
          </p>

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
                isOwn={post.pubkey === user?.pubkey}
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

function Stat({
  icon: Icon,
  value,
  label,
}: {
  icon: typeof Users;
  value: number;
  label: string;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <Icon className="h-3.5 w-3.5" />
      <span className="tabular-nums text-foreground">
        {value.toLocaleString()}
      </span>
      {label}
    </span>
  );
}

function EmptyTab({
  message,
  hint,
  offerRelays = false,
}: {
  message: string;
  hint?: string;
  offerRelays?: boolean;
}) {
  return (
    <Card className="border-dashed">
      <CardContent className="space-y-5 px-8 py-12 text-center">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">{message}</p>
          {hint && (
            <p className="text-xs text-muted-foreground/80">{hint}</p>
          )}
        </div>

        {/*
          An empty board may be an empty board, or it may be a relay that does
          not carry this community. The reader cannot tell those apart and the
          app should not pretend to — so it offers the one action that
          distinguishes them.
        */}
        {offerRelays && (
          <div className="mx-auto max-w-xs space-y-2">
            <p className="text-xs text-muted-foreground">
              Or try another relay.
            </p>
            <RelaySelector className="w-full" />
          </div>
        )}
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
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs transition-colors hover:border-primary/40 hover:bg-muted"
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

/**
 * The box for writing a post.
 *
 * The composer itself lives in `CommunityComposer`; this wires it to the
 * community it posts into.
 */
function ComposeToCommunity({ community }: { community: Community }) {
  const { post, isPosting } = usePostToCommunity(community);

  return (
    <CommunityComposer
      communityName={community.name}
      isPosting={isPosting}
      onPost={(content, images) => post({ content, images })}
    />
  );
}

/**
 * A post that is on the network but not yet on the board.
 *
 * Drawn as provisional rather than identically to an approved post, which is
 * what it was: the only thing distinguishing the two was which tab you happened
 * to be looking at, so a screenshot of either was a claim the community had not
 * made.
 */
function PendingPost({
  post,
  community,
  canApprove,
  isOwn = false,
}: {
  post: NostrEvent;
  community: Community;
  canApprove: boolean;
  isOwn?: boolean;
}) {
  const { approve, isApproving } = useApprovePost(community);

  return (
    <div
      className={cn(
        'relative space-y-2 rounded-xl border border-dashed p-1',
        isOwn && 'border-primary/40 bg-primary/[0.03]'
      )}
    >
      <div className="flex items-center justify-between gap-2 px-2 pt-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
              <Clock className="h-3 w-3" />
              {isOwn ? 'Yours · waiting' : 'Waiting'}
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            This post exists on the relays already. It appears on the board once
            a moderator publishes an approval for it.
          </TooltipContent>
        </Tooltip>

        {canApprove && (
          <Button
            size="sm"
            variant="outline"
            disabled={isApproving}
            onClick={() => approve(post)}
            className="h-7 gap-1.5 px-2.5 text-xs"
          >
            {isApproving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            Approve
          </Button>
        )}
      </div>

      <Post event={post} showReplies={false} />
    </div>
  );
}
