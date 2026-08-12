import { useState } from 'react';
import { Check, HelpCircle, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { LoginArea } from '@/components/auth/LoginArea';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useRsvp, useRsvps } from '@/hooks/useCalendar';
import {
  latestRsvps,
  tallyRsvps,
  type CalendarEvent,
  type RsvpStatus,
} from '@/lib/nip52';
import { cn } from '@/lib/utils';

const CHOICES: {
  status: RsvpStatus;
  label: string;
  icon: typeof Check;
  active: string;
}[] = [
  { status: 'accepted', label: 'Going', icon: Check, active: 'bg-success/15 text-success-strong border-success/40' },
  { status: 'tentative', label: 'Maybe', icon: HelpCircle, active: 'bg-warning/15 text-warning-strong border-warning/40' },
  { status: 'declined', label: "Can't go", icon: X, active: 'bg-destructive/10 text-destructive border-destructive/40' },
];

/**
 * Answering a calendar event, and the count of who else has.
 *
 * The spec leaves who may attend entirely to the host — "intentionally not
 * defining who is authorized to attend" — so anyone can answer here, tagged or
 * not, and the host decides what that means. Nothing is gated on being invited.
 */
export function RsvpControls({
  calendarEvent,
  address,
  className,
}: {
  calendarEvent: CalendarEvent;
  address: string;
  className?: string;
}) {
  const { user } = useCurrentUser();
  const { rsvps, isLoading } = useRsvps(address);
  const { rsvp, isPending } = useRsvp();

  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(true);

  const mine = user ? latestRsvps(rsvps).get(user.pubkey) : undefined;
  const tally = tallyRsvps(rsvps);

  const answer = async (status: RsvpStatus) => {
    await rsvp({
      address,
      status,
      /**
       * Declining carries no availability. The spec says the tag must be
       * omitted or ignored for a declined RSVP, and the builder drops it —
       * this just avoids offering a control that would do nothing.
       */
      freeBusy: status === 'declined' ? undefined : busy ? 'busy' : 'free',
      /**
       * Pins the revision being answered. The spec allows a host to change an
       * event after people have replied and deliberately says nothing about
       * what that means, so recording which version somebody agreed to is the
       * only way the question stays answerable later.
       */
      eventId: calendarEvent.event.id,
      host: calendarEvent.event.pubkey,
      note,
    });

    setNote('');
  };

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <span>
          <strong className="text-foreground">{tally.accepted}</strong> going
        </span>
        <span>
          <strong className="text-foreground">{tally.tentative}</strong> maybe
        </span>
        <span>
          <strong className="text-foreground">{tally.declined}</strong> can't
        </span>
        {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      </div>

      {!user ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Log in to say whether you're going.
          </p>
          <LoginArea className="max-w-60" />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {CHOICES.map((choice) => {
              const Icon = choice.icon;
              const chosen = mine?.status === choice.status;

              return (
                <Button
                  key={choice.status}
                  variant="outline"
                  size="sm"
                  disabled={isPending}
                  className={cn('gap-1.5', chosen && choice.active)}
                  onClick={() => answer(choice.status)}
                >
                  {isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Icon className="h-3.5 w-3.5" />
                  )}
                  {choice.label}
                </Button>
              );
            })}
          </div>

          {/*
            Only meaningful for an answer that is not a refusal, so it is not
            shown next to one.
          */}
          {mine?.status !== 'declined' && (
            <Label className="flex cursor-pointer items-center gap-2.5 text-sm font-normal">
              <Checkbox
                checked={busy}
                onCheckedChange={(checked) => setBusy(checked === true)}
              />
              Show me as busy for this time
            </Label>
          )}

          <Textarea
            value={note}
            onChange={(changed) => setNote(changed.target.value)}
            placeholder="Add a note with your reply (optional)"
            rows={2}
            className="resize-none"
          />

          {mine && (
            <p className="text-xs text-muted-foreground">
              You answered{' '}
              {mine.status === 'accepted'
                ? 'going'
                : mine.status === 'tentative'
                  ? 'maybe'
                  : "can't go"}
              . Choosing again replaces it.
            </p>
          )}
        </>
      )}
    </div>
  );
}
