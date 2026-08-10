import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { Check, Sparkles, Users } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { FollowButton } from '@/components/FollowButton';
import { useAuthor } from '@/hooks/useAuthor';
import { useTrending } from '@/hooks/useTrending';
import { genUserName } from '@/lib/genUserName';
import { ADMIN_PUBKEY } from '@/lib/onboarding';

interface WelcomeFollowsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The first thing a new account sees.
 *
 * An empty follow list is the reason most people bounce off Nostr: the app
 * opens onto a global feed of strangers with nothing to come back for. So the
 * first screen after signup is not a tour, it is a list of people — the
 * account that runs this app, already followed, and whoever is actually being
 * talked about right now.
 *
 * Suggestions come from the same trending data the sidebar uses, so they are
 * people posting today rather than a hardcoded list that ages badly.
 */
export function WelcomeFollows({ open, onOpenChange }: WelcomeFollowsProps) {
  const { data: trending, isLoading } = useTrending();

  const suggestions = useMemo(() => {
    const mentioned = (trending?.topMentions ?? [])
      .map((entry: { pubkey?: string; value?: string }) =>
        entry.pubkey ?? entry.value
      )
      .filter(
        (pubkey): pubkey is string =>
          typeof pubkey === 'string' &&
          /^[0-9a-f]{64}$/i.test(pubkey) &&
          pubkey !== ADMIN_PUBKEY
      );

    return [...new Set(mentioned)].slice(0, 8);
  }, [trending]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] max-w-md flex-col gap-4 overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            You're on Nostr
          </DialogTitle>
          <DialogDescription>
            Follow a few people so your feed has something in it. You can
            change any of this later.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="-mx-1 flex-1 px-1">
          <div className="space-y-4">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Following already
              </p>
              <Person pubkey={ADMIN_PUBKEY} followed />
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Being talked about today
              </p>

              {isLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <Skeleton key={index} className="h-14 w-full rounded-lg" />
                  ))}
                </div>
              ) : suggestions.length ? (
                <div className="space-y-1">
                  {suggestions.map((pubkey) => (
                    <Person key={pubkey} pubkey={pubkey} />
                  ))}
                </div>
              ) : (
                <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                  Nothing to suggest from your relays yet. Explore is the place
                  to find people once you're in.
                </p>
              )}
            </div>
          </div>
        </ScrollArea>

        <div className="flex items-center justify-between gap-2 border-t pt-4">
          <Button variant="ghost" asChild>
            <Link to="/explore" onClick={() => onOpenChange(false)}>
              <Users className="mr-2 h-4 w-4" />
              Find more
            </Link>
          </Button>

          <Button onClick={() => onOpenChange(false)}>Start reading</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Person({
  pubkey,
  followed,
}: {
  pubkey: string;
  followed?: boolean;
}) {
  const author = useAuthor(pubkey);
  const metadata = author.data?.metadata;
  const name = metadata?.display_name || metadata?.name || genUserName(pubkey);

  return (
    <div className="flex items-center gap-3 rounded-lg border p-2.5">
      <Link to={`/${nip19.npubEncode(pubkey)}`} className="shrink-0">
        <Avatar className="h-9 w-9">
          <AvatarImage src={metadata?.picture} alt="" />
          <AvatarFallback className="text-xs">
            {name.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      </Link>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{name}</p>
        {metadata?.about && (
          <p className="truncate text-xs text-muted-foreground">
            {metadata.about}
          </p>
        )}
      </div>

      {followed ? (
        <span className="flex shrink-0 items-center gap-1 text-xs text-success">
          <Check className="h-3.5 w-3.5" />
          Following
        </span>
      ) : (
        <FollowButton pubkey={pubkey} className="shrink-0" />
      )}
    </div>
  );
}
