import { useState } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  CheckCircle2,
  Clock,
  Link as LinkIcon,
  MoreHorizontal,
  Pencil,
  Plus,
  Target,
  Trash2,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { ZapDialog } from '@/components/ZapDialog';
import { Button } from '@/components/ui/button';
import { ZapGoalEditor } from '@/components/ZapGoalEditor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import {
  useRetireZapGoal,
  useZapGoal,
  useZapGoals,
} from '@/hooks/useZapGoal';
import { useToast } from '@/hooks/useToast';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { formatSats } from '@/lib/zap';
import { linkedGoal, type ZapGoal } from '@/lib/nip75';
import { cn } from '@/lib/utils';

/**
 * A fundraising goal and how far along it is.
 *
 * Amounts are stored in millisats and shown in sats, which is the one
 * conversion in this NIP that is easy to get wrong in the direction that
 * flatters — a target of 210000 msat is 210 sats, not 210 thousand.
 */
export function ZapGoalCard({
  event,
  className,
}: {
  /** The kind 9041 itself. */
  event: NostrEvent;
  className?: string;
}) {
  const { data, isLoading } = useZapGoal(event);

  if (isLoading) {
    return (
      <Card className={className}>
        <CardContent className="space-y-3 pt-6">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-2 w-full" />
          <Skeleton className="h-4 w-24" />
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  return <GoalBody goal={data.goal} className={className} />;
}

function GoalBody({ goal, className }: { goal: ZapGoal; className?: string }) {
  const { user } = useCurrentUser();
  const { data } = useZapGoal(goal.event);
  const progress = data?.progress;

  if (!progress) return null;

  /*
   * Said out loud, because "0 of 1M sats" looks identical whether nobody has
   * zapped or nothing could be asked. One of those is a fact about the goal
   * and the other is a fact about the network, and a bar that cannot tell
   * them apart quietly reports the wrong one.
   */
  const unreachable = data?.unreachable ?? false;

  const raisedSats = Math.round(progress.raisedMsat / 1000);
  const targetSats = Math.round(progress.targetMsat / 1000);

  const isOwn = user?.pubkey === goal.event.pubkey;

  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardContent className="space-y-3 pt-6">
        <div className="flex items-start gap-3">
          {/*
            Beside the text, not a banner above it. A full-width strip cropped
            to 128px cut the top off most artwork and pushed the number people
            came to read below the fold — the picture is context, and context
            belongs at thumbnail size.
          */}
          {goal.image && (
            <img
              src={goal.image}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              className="h-16 w-16 shrink-0 rounded-lg border object-cover sm:h-20 sm:w-20"
            />
          )}

          <div className="min-w-0 flex-1 space-y-1">
            {/*
              The `summary` tag is the headline and `.content` is the prose,
              and these were the wrong way round: a goal whose summary read
              "Help Keep NostrFeed Open" showed three lines of description
              truncated into the title slot, with the actual title demoted
              underneath it.
            */}
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 shrink-0 text-primary" />
              <p className="truncate font-medium">
                {goal.summary || goal.description || 'Fundraising goal'}
              </p>
            </div>
            {goal.summary && goal.description && (
              <p className="line-clamp-2 text-sm text-muted-foreground">
                {goal.description}
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {progress.isReached ? (
              <Badge className="gap-1 bg-success/15 text-success-strong">
                <CheckCircle2 className="h-3 w-3" />
                Reached
              </Badge>
            ) : progress.isClosed ? (
              <Badge variant="outline" className="gap-1">
                <Clock className="h-3 w-3" />
                Closed
              </Badge>
            ) : null}

            {isOwn && <GoalMenu goal={goal} raisedSats={raisedSats} />}
          </div>
        </div>

        <div className="space-y-1.5">
          <Progress value={progress.percent} className="h-2" />
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-medium">
              {formatSats(raisedSats)} of {formatSats(targetSats)} sats
            </span>
            <span className="text-muted-foreground">{progress.percent}%</span>
          </div>

          {unreachable && (
            <p className="text-xs text-muted-foreground">
              Couldn't reach the relays this goal counts from, so the total may
              be behind.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {progress.contributorCount > 0 && (
            <span className="flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" />
              {progress.contributorCount === 1
                ? '1 contributor'
                : `${progress.contributorCount} contributors`}
            </span>
          )}

          {goal.closedAt && !progress.isClosed && (
            <span className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              Closes {new Date(goal.closedAt * 1000).toLocaleDateString()}
            </span>
          )}
        </div>

        {/*
          Still fundable after the target is met — over-funding a goal is a
          normal thing to want to do. Only a passed `closed_at` stops it, and
          then because zaps sent after it would not be counted.
        */}
        {!progress.isClosed && (
          <ZapDialog target={goal.event}>
            <Button size="sm" className="w-full">
              Zap this goal
            </Button>
          </ZapDialog>
        )}

        {progress.isClosed && (
          <p className="text-xs text-muted-foreground">
            This goal stopped counting zaps on{' '}
            {new Date((goal.closedAt ?? 0) * 1000).toLocaleDateString()}.
          </p>
        )}

        {/*
          NIP-75's `r` tag: somewhere with the detail a goal cannot hold — the
          issue being bountied, the page explaining the project. Parsed all
          along and never shown.
        */}
        {goal.url && (
          <a
            href={goal.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-primary hover:underline"
          >
            <LinkIcon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              {goal.url.replace(/^https?:\/\/(www\.)?/, '')}
            </span>
          </a>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The goal an event points at with a `goal` tag, if any.
 *
 * Rendered under articles and other addressable events so the thing being
 * funded appears next to the thing asking for funds.
 */
export function LinkedZapGoal({
  event,
  className,
}: {
  event: NostrEvent;
  className?: string;
}) {
  const link = linkedGoal(event);
  const { data } = useZapGoal(link ? { id: link.id } : undefined);

  if (!link || !data) return null;

  return <GoalBody goal={data.goal} className={className} />;
}

/**
 * Editing and retiring a goal of your own.
 *
 * Kept behind a menu rather than sat on the card as buttons: this is the
 * author's own maintenance, and the card exists to be read by everybody else.
 */
function GoalMenu({ goal, raisedSats }: { goal: ZapGoal; raisedSats: number }) {
  const [editing, setEditing] = useState(false);
  const [retiring, setRetiring] = useState(false);
  const { retire, isDeleting } = useRetireZapGoal();
  const { toast } = useToast();

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
            <MoreHorizontal className="h-4 w-4" />
            <span className="sr-only">Goal options</span>
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <Pencil className="mr-2 h-4 w-4" />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => setRetiring(true)}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Retire goal
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {editing && (
        <ZapGoalEditor
          open={editing}
          onOpenChange={setEditing}
          goal={goal}
          raisedSats={raisedSats}
        />
      )}

      <AlertDialog open={retiring} onOpenChange={setRetiring}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Retire this goal?</AlertDialogTitle>
            <AlertDialogDescription>
              Relays are asked to delete it, and it stops appearing here. That
              is a request rather than a guarantee — a relay is free to keep
              serving it, and anyone who already has a copy keeps theirs.
              {raisedSats > 0 &&
                ` The ${raisedSats.toLocaleString()} sats already sent are yours and are not affected.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              onClick={async () => {
                try {
                  await retire(goal.event);
                  toast({ title: 'Goal retired' });
                } catch (error) {
                  toast({
                    title: 'Could not retire that goal',
                    description: (error as Error)?.message,
                    variant: 'destructive',
                  });
                }
              }}
            >
              Retire
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * Someone's open goals, for their profile.
 *
 * Closed and reached goals are left out rather than listed as history: a
 * profile is where somebody asks for support, and a wall of finished
 * fundraisers buries the one that is still open.
 */
export function ProfileZapGoals({
  pubkey,
  className,
}: {
  pubkey: string;
  className?: string;
}) {
  const { user } = useCurrentUser();
  const { data: goals } = useZapGoals(pubkey);
  const [composing, setComposing] = useState(false);

  const isOwn = user?.pubkey === pubkey;

  const open = (goals ?? []).filter(
    (goal) => !goal.closedAt || goal.closedAt * 1000 > Date.now()
  );

  /*
   * Somebody else's profile with nothing to fund says nothing. Your own says
   * you can start one — this section used to disappear entirely when empty,
   * which is exactly the state a person is in the first time they want a
   * goal, so there was nowhere to begin.
   */
  if (!open.length && !isOwn) return null;

  return (
    <div className={cn('space-y-3', className)}>
      {isOwn && (
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Target className="h-4 w-4" />
            Goals
          </h2>
          <Button size="sm" variant="outline" onClick={() => setComposing(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            New goal
          </Button>
        </div>
      )}

      {open.slice(0, 3).map((goal) => (
        <ZapGoalCard key={goal.event.id} event={goal.event} />
      ))}

      {isOwn && !open.length && (
        <Card className="border-dashed">
          <CardContent className="py-6 text-center">
            <p className="text-sm text-muted-foreground">
              No open goals. Set a target and people can zap toward it.
            </p>
          </CardContent>
        </Card>
      )}

      {isOwn && composing && (
        <ZapGoalEditor open={composing} onOpenChange={setComposing} />
      )}
    </div>
  );
}
