import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { AvatarStack } from '@/components/AvatarStack';
import { ImagePlus, Loader2, Pencil, Plus, Users } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useCommunities, usePublishCommunity } from '@/hooks/useCommunities';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useUploadFile } from '@/hooks/useUploadFile';
import { useToast } from '@/hooks/useToast';
import { useRouteSeo } from '@/hooks/useSeo';
import { slugify } from '@/lib/article';
import {
  communityAddress,
  groupCommunities,
  roleIn,
  type Community,
} from '@/lib/community';
import { formatMonthYear } from '@/lib/time';
import { CommunityEditor } from '@/components/communities/CommunityEditor';

export function CommunitiesPage() {
  useRouteSeo('/communities');

  const { user } = useCurrentUser();
  const { communities, isLoading } = useCommunities();

  /**
   * What this person runs, above what merely exists.
   *
   * One flat grid meant a moderator arriving to tend their own community had
   * to find it among fifty they have nothing to do with — and the only way to
   * edit one was to open it first and find the control inside.
   */
  const { mine, rest } = useMemo(
    () => groupCommunities(communities, user?.pubkey),
    [communities, user?.pubkey]
  );

  return (
    <Layout>
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <PageHeader
            icon={Users}
            title="Communities"
            description="Places with someone tending them. Anyone can post; moderators decide what stays."
          />

          {user && <CreateCommunityDialog />}
        </div>

        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Card key={index}>
                <Skeleton className="h-24 w-full" />
                <CardContent className="space-y-2 pt-4">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : communities.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No communities on this relay"
            description="Try another relay, or start the first one here."
            showRelaySelector
          />
        ) : (
          <div className="space-y-6">
            {mine.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Yours · {mine.length}
                </h2>

                <div className="grid gap-4 sm:grid-cols-2">
                  {mine.map((community) => (
                    <CommunityCard
                      key={communityAddress(community)}
                      community={community}
                    />
                  ))}
                </div>
              </section>
            )}

            <section className="space-y-3">
              {mine.length > 0 && (
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Everywhere else
                </h2>
              )}

              {rest.length > 0 ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  {rest.map((community) => (
                    <CommunityCard
                      key={communityAddress(community)}
                      community={community}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nothing else on this relay yet.
                </p>
              )}
            </section>
          </div>
        )}
      </div>
    </Layout>
  );
}

function CommunityCard({ community }: { community: Community }) {
  const { user } = useCurrentUser();
  const [editing, setEditing] = useState(false);

  const naddr = nip19.naddrEncode({
    kind: community.event.kind,
    pubkey: community.creator,
    identifier: community.slug,
  });

  const role = roleIn(community, user?.pubkey);

  return (
    <Card className="content-auto overflow-hidden hover-lift">
      <Link to={`/${naddr}`} className="block">
        {community.image ? (
          <img
            src={community.image}
            alt=""
            loading="lazy"
            className="h-24 w-full object-cover"
          />
        ) : (
          <div className="h-24 w-full bg-gradient-to-br from-primary/15 to-transparent" />
        )}

        <CardContent className="space-y-1.5 pt-4">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold leading-snug">{community.name}</h3>

            {/* Said on the card rather than discovered inside: whether this
                is a place somebody tends or a place they visit changes what
                they came here to do */}
            {role && (
              <Badge variant="secondary" className="shrink-0 capitalize">
                {role}
              </Badge>
            )}
          </div>

          {community.description ? (
            <p className="line-clamp-2 text-sm text-muted-foreground">
              {community.description}
            </p>
          ) : (
            <p className="text-sm italic text-muted-foreground">
              No description yet.
            </p>
          )}

          {/* The facts a card can state without a request of its own */}
          <p className="text-xs text-muted-foreground">
            {/* Seconds to milliseconds: a Nostr timestamp handed straight to a
                date formatter renders January 1970 */}
            Started {formatMonthYear(community.createdAt * 1000)}
            {community.relays.length > 0 &&
              ` · ${community.relays.length} ${
                community.relays.length === 1 ? 'relay' : 'relays'
              }`}
          </p>
        </CardContent>

        {/* Outside the padded content so the faces sit on the card edge, and
            below the description so the place is judged before its people */}
        <CardContent className="flex items-center justify-between gap-2 pt-0">
          <AvatarStack pubkeys={community.moderators} max={6} />
          <span className="shrink-0 text-xs text-muted-foreground">
            {community.moderators.length}{' '}
            {community.moderators.length === 1 ? 'moderator' : 'moderators'}
          </span>
        </CardContent>
      </Link>

      {/*
        Outside the link, because a control inside one is a control you cannot
        press without navigating away. Editing was reachable only by opening
        the community first and finding it in there, which is two steps past
        where somebody with fifty communities is standing.
      */}
      {role && (
        <CardContent className="pt-0">
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => setEditing(true)}
          >
            <Pencil className="mr-2 h-3.5 w-3.5" />
            Edit
          </Button>
        </CardContent>
      )}

      {editing && (
        <CommunityEditor
          community={community}
          onClose={() => setEditing(false)}
        />
      )}
    </Card>
  );
}

/**
 * Starting a community.
 *
 * The creator is its first moderator whether or not they add themselves, so
 * the form asks for the others rather than making people list their own key.
 */
function CreateCommunityDialog() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { publish, isPublishing } = usePublishCommunity();
  const { mutateAsync: uploadFile, isPending: isUploading } = useUploadFile();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [image, setImage] = useState('');
  const [moderators, setModerators] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const slug = slugify(name);

  const submit = async () => {
    const naddr = await publish({
      slug,
      name,
      description,
      image: image || undefined,
      // npubs are friendlier to paste than hex, so both are accepted
      moderators: moderators
        .split(/[,\s]+/)
        .map((entry) => toHexPubkey(entry))
        .filter((entry): entry is string => !!entry),
      relays: [],
    });

    setOpen(false);
    navigate(`/${naddr}`);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          New community
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Start a community</DialogTitle>
          <DialogDescription>
            Published as NIP-72, so it works in any client that speaks it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="community-name">Name</Label>
            <Input
              id="community-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Bitcoin builders"
            />
            {slug && name.trim() && (
              <p className="text-xs text-muted-foreground">
                Address: <span className="font-mono">{slug}</span>
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="community-description">What it's for</Label>
            <Textarea
              id="community-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Who belongs here and what gets posted."
              className="min-h-[72px] resize-none"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Banner</Label>
            <div className="flex gap-2">
              <Input
                value={image}
                onChange={(event) => setImage(event.target.value)}
                placeholder="https://…"
                className="flex-1"
              />
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (!file) return;

                  try {
                    const [[, url]] = await uploadFile(file);
                    setImage(url);
                  } catch (error) {
                    toast({
                      title: 'Upload failed',
                      description: (error as Error).message,
                      variant: 'destructive',
                    });
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                disabled={isUploading}
                onClick={() => fileInput.current?.click()}
              >
                {isUploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ImagePlus className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="community-moderators">Other moderators</Label>
            <Textarea
              id="community-moderators"
              value={moderators}
              onChange={(event) => setModerators(event.target.value)}
              placeholder="npub1… npub1…"
              className="min-h-[64px] resize-none font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              Optional. You are a moderator already. Anything that isn't a valid
              key is ignored rather than silently granting nobody.
            </p>
          </div>

          <Button
            className="w-full"
            disabled={isPublishing || !name.trim()}
            onClick={submit}
          >
            {isPublishing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create community
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Accepts an npub or raw hex and returns hex, or nothing when it is neither. */
function toHexPubkey(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed.toLowerCase();

  try {
    const decoded = nip19.decode(trimmed);
    if (decoded.type === 'npub') return decoded.data;
    if (decoded.type === 'nprofile') return decoded.data.pubkey;
  } catch {
    // Not a NIP-19 identifier either
  }

  return null;
}

export default CommunitiesPage;
