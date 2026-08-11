import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';
import { Spotlight } from '@/components/Spotlight';
import { formatMonthYear } from '@/lib/time';
import {
  BadgeCheck,
  Calendar,
  Copy,
  Link as LinkIcon,
  MapPin,
  PenSquare,
  MessagesSquare,
  QrCode,
  UserRound,
  Zap,
} from 'lucide-react';
import { useProfile } from '@/hooks/useProfile';
import { readAuthorEvent, useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useFollows } from '@/hooks/useFollows';
import { useFollowers } from '@/hooks/useFollowers';
import { useToast } from '@/hooks/useToast';
import { useSeo } from '@/hooks/useSeo';
import { genUserName } from '@/lib/genUserName';
import { Post } from '@/components/Post';
import { NoteContent } from '@/components/NoteContent';
import { EmptyState } from '@/components/EmptyState';
import { PostSkeletonList } from '@/components/PostSkeleton';
import { FollowButton } from '@/components/FollowButton';
import { ZapDialog } from '@/components/ZapDialog';
import { VerificationMark } from '@/components/VerificationBadge';
import { tierOf } from '@/lib/tiers';
import { EditProfileForm } from '@/components/EditProfileForm';
import {
  ArticleCard,
  ArticleCardSkeleton,
  NoArticles,
} from '@/components/articles/ArticleCard';
import { useArticles } from '@/hooks/useArticles';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { QRCodeSVG } from 'qrcode.react';
import { cn } from '@/lib/utils';

interface ProfileProps {
  pubkey: string;
}

const IMAGE_URL = /https?:\/\/\S+\.(?:jpe?g|png|gif|webp|avif|mp4|webm|mov)/i;

export function Profile({ pubkey }: ProfileProps) {
  const { data: profileData, isLoading, error } = useProfile(pubkey);
  const author = useAuthor(pubkey);
  const { user } = useCurrentUser();
  const { followingCount } = useFollows(pubkey);
  const { followerCount } = useFollowers(pubkey);
  const { toast } = useToast();
  const [isEditProfileOpen, setIsEditProfileOpen] = useState(false);

  /**
   * The profile page asks the relays for a kind 0 of its own, and used to
   * discard it — the header read only the shared author cache, so a profile
   * that cache had never found stayed blank on the one page that had just
   * fetched it. Preferring the cache keeps names consistent with the rest of
   * the app; falling back to this fills in the case it could not answer.
   */
  const metadata =
    author.data?.metadata ??
    (profileData?.metadata ? readAuthorEvent(profileData.metadata).metadata : undefined);

  const displayName =
    metadata?.display_name || metadata?.name || genUserName(pubkey);
  const username = metadata?.name || genUserName(pubkey);
  const lightningAddress = metadata?.lud16 || metadata?.lud06;
  /**
   * Which of our tiers the address on their profile belongs to, if any.
   *
   * Null for somebody paid at a wallet from elsewhere, which is deliberate:
   * that address is real and works, and badging it as one of ours would claim
   * a relationship that does not exist.
   */
  const payTier = lightningAddress ? tierOf(lightningAddress) : null;
  const isCurrentUser = user?.pubkey === pubkey;
  const npub = nip19.npubEncode(pubkey);

  const posts = useMemo(() => profileData?.posts ?? [], [profileData]);

  const { notes, replies, media } = useMemo(() => {
    const notes = posts.filter(
      (post) => !post.tags.some(([name]) => name === 'e')
    );
    const replies = posts.filter((post) =>
      post.tags.some(([name]) => name === 'e')
    );
    const media = posts.filter((post) => IMAGE_URL.test(post.content));
    return { notes, replies, media };
  }, [posts]);

  const joinedDate = useMemo(() => {
    const timestamps = posts.map((post) => post.created_at).filter((t) => t > 0);
    if (!timestamps.length) return null;
    const oldest = Math.min(...timestamps) * 1000;
    return oldest > 0 && oldest <= Date.now() ? new Date(oldest) : null;
  }, [posts]);

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: `${label} copied`, duration: 2000 });
    } catch {
      toast({
        title: 'Copy failed',
        description: 'Your browser blocked clipboard access.',
        variant: 'destructive',
      });
    }
  };

  // Social previews use the profile's own name, bio and avatar
  useSeo({
    title: displayName,
    description:
      metadata?.about?.slice(0, 200) ||
      `${displayName} on Nostr — notes, replies and media.`,
    image: metadata?.picture,
    path: `/${npub}`,
    type: 'profile',
  });

  /**
   * Both gates below used to be page-wide, and both were reading the wrong
   * query. `isLoading` and `error` come from the *notes* request, so a relay
   * that was slow to return someone's posts — or returned none, or timed out —
   * replaced their entire profile with a spinner or with "couldn't load this
   * profile". For a new account with nothing published yet, that is every
   * visit: the person clicks through to their own profile and finds no name,
   * no avatar and an error about a key that is perfectly fine.
   *
   * Whether the notes arrived says nothing about who this is. So the identity
   * block renders as soon as anything is known about them, and the notes
   * report their own trouble in the tab where the notes would have been.
   */
  if (isLoading && !metadata && !author.isFetched) {
    return <ProfileSkeleton />;
  }

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden">
        <div className="relative">
          <div className="h-32 bg-muted sm:h-44">
            {metadata?.banner && (
              <img
                src={metadata.banner}
                alt=""
                className="h-full w-full object-cover"
              />
            )}
          </div>

          <div className="absolute -bottom-12 left-4 sm:left-6">
            <Avatar className="h-24 w-24 border-4 border-card shadow-md">
              <AvatarImage src={metadata?.picture} alt="" className="object-cover" />
              <AvatarFallback className="text-xl">
                {displayName.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </div>
        </div>

        <CardContent className="space-y-4 px-4 pb-5 pt-4 sm:px-6">
          <div className="flex justify-end gap-2">
            {isCurrentUser ? (
              <Dialog open={isEditProfileOpen} onOpenChange={setIsEditProfileOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm">
                    <PenSquare className="mr-2 h-4 w-4" />
                    Edit profile
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
                  <DialogHeader>
                    <DialogTitle>Edit profile</DialogTitle>
                  </DialogHeader>
                  <EditProfileForm onSuccess={() => setIsEditProfileOpen(false)} />
                </DialogContent>
              </Dialog>
            ) : (
              <>
                {/* Zapping a person rather than a note. Hidden by the dialog
                    itself when they have no lightning address, so it never
                    offers to pay somebody who cannot be paid. */}
                {user && author.data?.event && (
                  <ZapDialog target={author.data.event}>
                    <Button variant="outline" size="sm">
                      <Zap className="mr-2 h-4 w-4 text-zap" />
                      Zap
                    </Button>
                  </ZapDialog>
                )}
                {user && (
                  <Button asChild variant="outline" size="sm">
                    <Link to={`/chat/${npub}`}>
                      <MessagesSquare className="mr-2 h-4 w-4" />
                      Message
                    </Link>
                  </Button>
                )}
                <FollowButton pubkey={pubkey} size="default" variant="default" />
              </>
            )}

            <ShareProfileDialog
              npub={npub}
              displayName={displayName}
              lightningAddress={lightningAddress}
              onCopy={copy}
            />
          </div>

          {/* Identity block sits below the avatar overhang */}
          <div className="space-y-1 pt-6 sm:pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold sm:text-2xl">{displayName}</h1>

              {/* A ✓ for a nip05 anyone can self-host, and separately the tier
                  of the address they are paid at. Two different claims, so two
                  different marks — one mark doing both jobs would tell a
                  reader neither. */}
              {metadata?.nip05 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <BadgeCheck
                      className="h-5 w-5 text-primary"
                      aria-label="Verified NIP-05 address"
                    />
                  </TooltipTrigger>
                  <TooltipContent>{metadata.nip05}</TooltipContent>
                </Tooltip>
              )}

              {payTier && <VerificationMark tier={payTier} className="h-5 w-5" />}
            </div>
            <p className="text-sm text-muted-foreground">@{username}</p>
          </div>

          {metadata?.about && (
            /* The bio is plaintext, so it gets the same link/mention treatment as notes */
            <NoteContent
              className="text-sm"
              event={{
                id: `${pubkey}-about`,
                pubkey,
                kind: 0,
                tags: [],
                content: metadata.about,
                created_at: 0,
                sig: '',
              }}
            />
          )}

          <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
            {typeof (metadata as Record<string, unknown>)?.location ===
              'string' && (
              <span className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" />
                {(metadata as Record<string, unknown>).location as string}
              </span>
            )}
            {metadata?.website && (
              <a
                href={metadata.website}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-primary hover:underline"
              >
                <LinkIcon className="h-3.5 w-3.5" />
                {metadata.website.replace(/^https?:\/\//, '')}
              </a>
            )}
            {lightningAddress && (
              <span className="flex items-center gap-1.5">
                <Zap className="h-3.5 w-3.5 text-zap" />
                {lightningAddress}
              </span>
            )}
            {joinedDate && (
              <span className="flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" />
                Active since {formatMonthYear(joinedDate)}
              </span>
            )}
          </div>

          <div className="flex gap-5 text-sm">
            <Stat label="Notes" value={posts.length} />
            <Stat
              label="Following"
              value={followingCount}
              to={`/${npub}/following`}
            />
            <Stat
              label="Followers"
              value={followerCount}
              to={`/${npub}/followers`}
            />
          </div>
        </CardContent>
      </Card>

      <Spotlight pubkey={pubkey} />

      <Tabs defaultValue="notes" className="space-y-4">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="notes" className="flex-1 sm:flex-none">
            Notes
          </TabsTrigger>
          <TabsTrigger value="replies" className="flex-1 sm:flex-none">
            Replies
          </TabsTrigger>
          <TabsTrigger value="articles" className="flex-1 sm:flex-none">
            Articles
          </TabsTrigger>
          <TabsTrigger value="media" className="flex-1 sm:flex-none">
            Media
          </TabsTrigger>
        </TabsList>

        <TabsContent value="notes" className="space-y-4">
          <PostGroup
            posts={notes}
            isLoading={isLoading}
            failed={!!error}
            emptyTitle={
              isCurrentUser ? "You haven't posted yet" : 'No notes found'
            }
            showCompose={isCurrentUser}
          />
        </TabsContent>

        <TabsContent value="replies" className="space-y-4">
          <PostGroup
            posts={replies}
            isLoading={isLoading}
            failed={!!error}
            emptyTitle="No replies found"
          />
        </TabsContent>

        <TabsContent value="articles" className="space-y-4">
          <ProfileArticles pubkey={pubkey} />
        </TabsContent>

        <TabsContent value="media" className="space-y-4">
          <PostGroup
            posts={media}
            isLoading={isLoading}
            failed={!!error}
            emptyTitle="No media found"
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Stat({
  label,
  value,
  to,
}: {
  label: string;
  value: number;
  to?: string;
}) {
  const body = (
    <>
      <span className="font-semibold tabular-nums">{value}</span>{' '}
      <span className="text-muted-foreground">{label}</span>
    </>
  );

  if (!to) return <span>{body}</span>;

  return (
    <Link to={to} className="transition-colors hover:text-primary">
      {body}
    </Link>
  );
}

function PostGroup({
  posts,
  emptyTitle,
  showCompose = false,
  isLoading = false,
  failed = false,
}: {
  posts: NostrEvent[];
  emptyTitle: string;
  showCompose?: boolean;
  isLoading?: boolean;
  failed?: boolean;
}) {
  if (isLoading && posts.length === 0) {
    return <PostSkeletonList count={3} />;
  }

  /**
   * Said here rather than over the whole page. The notes not arriving is a
   * fact about the relay, and it is worth reporting — but only about the
   * notes, and not by hiding whose profile this is.
   */
  if (failed && posts.length === 0) {
    return (
      <EmptyState
        icon={UserRound}
        title="Couldn't load these notes"
        description="The relay didn't answer for this key. Another one may have them."
        showRelaySelector
      />
    );
  }

  if (posts.length === 0) {
    return (
      <EmptyState
        icon={UserRound}
        title={emptyTitle}
        description="Notes may live on a relay this client isn't connected to."
        showRelaySelector={!showCompose}
        action={
          showCompose ? (
            <Button asChild>
              <Link to="/compose">Write your first note</Link>
            </Button>
          ) : undefined
        }
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

function ShareProfileDialog({
  npub,
  displayName,
  lightningAddress,
  onCopy,
}: {
  npub: string;
  displayName: string;
  lightningAddress?: string;
  onCopy: (value: string, label: string) => void;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon" aria-label="Show profile QR code">
          <QrCode className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="truncate pr-6">{displayName}</DialogTitle>
        </DialogHeader>

        <div className="min-w-0 space-y-4">
          {/* Kept white in both themes: QR scanners need a light quiet zone.
              Sized in CSS rather than by the `size` prop so it shrinks with a
              narrow dialog instead of pushing it open */}
          <div className="mx-auto w-fit max-w-full rounded-lg bg-white p-4">
            <QRCodeSVG
              value={`nostr:${npub}`}
              size={224}
              level="M"
              marginSize={0}
              className="h-auto w-full max-w-[224px]"
            />
          </div>

          <CopyRow label="Public key" value={npub} onCopy={onCopy} />
          {lightningAddress && (
            <CopyRow
              label="Lightning address"
              value={lightningAddress}
              onCopy={onCopy}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CopyRow({
  label,
  value,
  onCopy,
  className,
}: {
  label: string;
  value: string;
  onCopy: (value: string, label: string) => void;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1', className)}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1.5 font-mono text-xs">
          {value}
        </code>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          aria-label={`Copy ${label.toLowerCase()}`}
          onClick={() => onCopy(value, label)}
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div className="space-y-5">
      <Card className="overflow-hidden">
        <Skeleton className="h-32 w-full rounded-none sm:h-44" />
        <CardContent className="space-y-4 px-4 pb-5 pt-4 sm:px-6">
          <div className="-mt-16 mb-2">
            <Skeleton className="h-24 w-24 rounded-full border-4 border-card" />
          </div>
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-full" />
          <div className="flex gap-4">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-20" />
          </div>
        </CardContent>
      </Card>
      <PostSkeletonList count={3} />
    </div>
  );
}

/**
 * An author's long-form articles.
 *
 * Its own tab rather than mixed into the notes feed: an article is a
 * different reading commitment from a note, and a list of them is how someone
 * decides whether this author is worth following for writing.
 */
function ProfileArticles({ pubkey }: { pubkey: string }) {
  const { articles, isLoading } = useArticles({ author: pubkey });

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <ArticleCardSkeleton />
        <ArticleCardSkeleton />
      </div>
    );
  }

  if (!articles.length) {
    return <NoArticles message="No articles yet." />;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {articles.map((article) => (
        <ArticleCard key={article.slug} article={article} />
      ))}
    </div>
  );
}
