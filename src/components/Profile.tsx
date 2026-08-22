import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { profilePath } from '@/lib/nip05Lookup';
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
import { profilePageSchema } from '@/lib/structuredData';
import { genUserName } from '@/lib/genUserName';
import { handleFor } from '@/lib/handle';
import { Post } from '@/components/Post';
import { NoteContent } from '@/components/NoteContent';
import { ReportNotice } from '@/components/ReportNotice';
import { AvatarRing } from '@/components/AvatarRing';
import { AvatarRingPicker } from '@/components/AvatarRingPicker';
import { EmptyState } from '@/components/EmptyState';
import { PostSkeletonList } from '@/components/PostSkeleton';
import { FollowButton } from '@/components/FollowButton';
import { ZapTrigger } from '@/components/ZapTrigger';
import { StandingMarks } from '@/components/VerificationBadge';
import { addressDomain } from '@/lib/lightningAddress';
import { tierOf } from '@/lib/tiers';
import { isReply } from '@/lib/thread';
import { isRepost } from '@/lib/eventKinds';
import { useAdmission } from '@/hooks/usePaidRelay';
import { EditProfileForm } from '@/components/EditProfileForm';
import { LinkedAccounts } from '@/components/identity/LinkedAccounts';
import { ProfileZapAddress } from '@/components/identity/ProfileZapAddress';
import { ProfileZapGoals } from '@/components/ZapGoalCard';
import { SubscriptionTiers } from '@/components/subscriptions/SubscriptionTiers';
import { TrustScore } from '@/components/trust/TrustScore';
import { BadgeSettings, ProfileBadges } from '@/components/badges/ProfileBadges';
import { LinkedAccountsEditor } from '@/components/identity/LinkedAccountsEditor';
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
  const username = handleFor(metadata, pubkey);
  const lightningAddress = metadata?.lud16 || metadata?.lud06;
  /**
   * Which of our tiers the address on their profile belongs to, if any.
   *
   * Null for somebody paid at a wallet from elsewhere, which is deliberate:
   * that address is real and works, and badging it as one of ours would claim
   * a relationship that does not exist.
   */
  const payTier = lightningAddress ? tierOf(lightningAddress) : null;
  /*
   * Asked once, here, and nowhere that renders a list. The relay answers for
   * any key, so this is a real check rather than a claim read off their relay
   * list — but it is a cross-origin request per person, which a timeline
   * cannot afford and a profile can.
   */
  const { state: admission } = useAdmission(pubkey);
  const isCurrentUser = user?.pubkey === pubkey;
  const npub = nip19.npubEncode(pubkey);

  const posts = useMemo(() => profileData?.posts ?? [], [profileData]);

  const { notes, replies, media } = useMemo(() => {
    /*
     * NIP-10, not "has an `e` tag".
     *
     * That test filed every quote and every repost under Replies, because a
     * quote carries `['e', id, '', 'mention']` and a kind 6 carries a bare `e`
     * tag naming what it boosted. An account that quotes or reposts at all —
     * which is most of them — ended up with an empty Notes tab and everything
     * it wrote listed as a comment on something. `isReply` reads the markers
     * and the positional form and excludes mentions; see `lib/thread`.
     */
    const notes = posts.filter(
      (post) => isRepost(post) || !isReply(post)
    );
    const replies = posts.filter(
      (post) => !isRepost(post) && isReply(post)
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
    /**
     * A profile page is both claims at once: `rel="me"` because the page is
     * that identity, and `rel="author"` because that identity wrote it.
     */
    nostrEntity: npub,
    nostrAuthor: npub,
    authorIsSelf: true,
    /*
     * The person, described. Everything visible on this page arrives from
     * relays after the HTML does, so without this there is nothing for a
     * search engine or an assistant to read but an empty shell.
     */
    structuredData: profilePageSchema({
      name: displayName,
      npub,
      about: metadata?.about?.slice(0, 300),
      image: metadata?.picture,
      nip05: metadata?.nip05,
      website: metadata?.website,
    }),
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

          {/*
            Smaller on a phone, where a 96px avatar overhanging a 128px banner
            leaves the name squeezed against the action buttons.
          */}
          <div className="absolute -bottom-10 left-4 sm:-bottom-12 sm:left-6">
            <AvatarRing metadata={metadata as Record<string, unknown>}>
              <Avatar className="h-20 w-20 border-4 border-card shadow-md sm:h-24 sm:w-24">
                <AvatarImage src={metadata?.picture} alt="" className="object-cover" />
                <AvatarFallback className="text-xl">
                  {displayName.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            </AvatarRing>
          </div>
        </div>

        <CardContent className="space-y-4 px-4 pb-5 pt-4 sm:px-6">
          {/*
            Identity and actions swap places between the two layouts.

            On a phone the avatar hangs 40px into this card while the padding
            above is only 16px, so anything placed first here lands underneath
            it — which is where the zap button was. The name goes first
            instead, cleared past the overhang, and the buttons sit below it
            where there is a full width to share.

            On a wider screen the avatar is bottom-left and the buttons are
            top-right, so they never meet and the original order is kept.
          */}
          <div className="flex flex-col gap-4">
            <div className="order-2 grid grid-cols-2 gap-2 sm:order-1 sm:flex sm:flex-wrap sm:items-center sm:justify-end">
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

                    {/* What the ring around your avatar does, and which of
                        them your tier has earned. */}
                    <AvatarRingPicker />

                    {/* Kind 10011 is its own replaceable event, so it saves
                        separately from the kind 0 profile above. */}
                    <LinkedAccountsEditor />

                    {/* Badges are awarded without asking; this is the consent */}
                    <BadgeSettings />
                  </DialogContent>
                </Dialog>
              ) : (
                <>
                  {/* Zapping a person rather than a note. Hidden by the dialog
                      itself when they have no lightning address, so it never
                      offers to pay somebody who cannot be paid. */}
                  {user && author.data?.event && (
                    <ZapTrigger target={author.data.event}>
                      <Button variant="outline" size="sm">
                        <Zap className="mr-2 h-4 w-4 text-zap" />
                        Zap
                      </Button>
                    </ZapTrigger>
                  )}
                  {user && (
                    <Button asChild variant="outline" size="sm">
                      <Link to={`/chat/${npub}`}>
                        <MessagesSquare className="mr-2 h-4 w-4" />
                        Message
                      </Link>
                    </Button>
                  )}
                  <FollowButton pubkey={pubkey} size="sm" variant="default" />
                </>
              )}

              <ShareProfileDialog
                npub={npub}
                nip05={metadata?.nip05}
                displayName={displayName}
                lightningAddress={lightningAddress}
                onCopy={copy}
              />
            </div>

            {/* Clears the avatar, which overhangs further on a phone */}
            <div className="order-1 space-y-1 pt-11 sm:order-2 sm:pt-4">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h1 className="min-w-0 break-words text-xl font-bold sm:text-2xl">
                {displayName}
              </h1>

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

              {/* Two claims, two marks: what name they hold, and whether the
                  paid relay takes their writes. Neither implies the other. */}
              <StandingMarks
                standing={{ tier: payTier, admitted: admission === 'admitted' }}
                domain={lightningAddress ? addressDomain(lightningAddress) : undefined}
                className="[&_svg]:h-5 [&_svg]:w-5"
              />

              {/* NIP-85: only rendered if the reader declared a rank provider */}
              <TrustScore pubkey={pubkey} />
            </div>
              <p className="text-sm text-muted-foreground">@{username}</p>
            </div>
          </div>

          {/*
            What people this reader follows have reported, if enough of them
            did. Above the bio rather than below it: an impersonation report
            is about the very thing the bio is trying to convince you of.
          */}
          <ReportNotice pubkey={pubkey} />

          {metadata?.about && (
            /*
              The bio is plaintext, so it gets the same link/mention treatment
              as notes — minus the link card, since the website row directly
              below already shows that URL and the card made it three copies.
            */
            <NoteContent
              className="text-sm"
              linkCard={false}
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
              <span className="flex min-w-0 items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">
                  {(metadata as Record<string, unknown>).location as string}
                </span>
              </span>
            )}
            {metadata?.website && (
              <a
                href={metadata.website}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-w-0 items-center gap-1.5 text-primary hover:underline"
              >
                <LinkIcon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">
                  {metadata.website.replace(/^https?:\/\//, '')}
                </span>
              </a>
            )}
            {lightningAddress && (
              <span className="flex min-w-0 items-center gap-1.5">
                <Zap className="h-3.5 w-3.5 shrink-0 text-zap" />
                <span className="truncate">{lightningAddress}</span>
              </span>
            )}
            {joinedDate && (
              <span className="flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" />
                Active since {formatMonthYear(joinedDate)}
              </span>
            )}
          </div>

          {/*
            Only for the person whose profile this is, and mounted rather than
            hidden — it reads their wallet, and nobody else's profile should
            cost that request. Renders nothing when the address above is the
            one they are really paid at.
          */}
          {isCurrentUser && <ProfileZapAddress published={lightningAddress} />}

          {/* NIP-39: accounts this profile claims elsewhere. Claims, not
              verifications — see the component. */}
          <LinkedAccounts pubkey={pubkey} />

          {/* NIP-58: only what this person chose to display, verified */}
          <ProfileBadges pubkey={pubkey} />

          {/* NIP-75: "Clients MAY display funding goals on user profiles." */}
          <ProfileZapGoals pubkey={pubkey} />

          {/* Recurring support, where somebody deciding to back a creator is
              already looking. Renders nothing when none are offered. */}
          <SubscriptionTiers pubkey={pubkey} />

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
        <TabsList>
          <TabsTrigger value="notes">
            Notes
          </TabsTrigger>
          <TabsTrigger value="replies">
            Replies
          </TabsTrigger>
          <TabsTrigger value="articles">
            Articles
          </TabsTrigger>
          <TabsTrigger value="media">
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
  nip05,
  displayName,
  lightningAddress,
  onCopy,
}: {
  npub: string;
  nip05?: string;
  displayName: string;
  lightningAddress?: string;
  onCopy: (value: string, label: string) => void;
}) {
  /*
   * Absolute, because this is copied to somewhere that is not this app —
   * a bio, a message, a business card. A path would be useless there.
   */
  const origin =
    typeof window === 'undefined' ? '' : window.location.origin;
  const profileLink = `${origin}${profilePath(nip05, npub)}`;

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

          {/*
            * First, and above the key, because it is the one somebody can put
            * in a bio on another site or read out. An npub is unshareable
            * anywhere people actually are.
            */}
          <CopyRow label="Profile link" value={profileLink} onCopy={onCopy} />
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
