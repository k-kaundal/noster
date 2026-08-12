import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/useToast';
import { usePublishCalendarEvent } from '@/hooks/useCalendar';
import {
  DATE_EVENT_KIND,
  TIME_EVENT_KIND,
  parseCalendarDate,
} from '@/lib/nip52';

/**
 * Composing a calendar event.
 *
 * The two kinds are two tabs rather than a checkbox, because they take
 * different inputs — one asks for dates and the other for times, and a form
 * that greys half of itself out is a form people fill in wrong.
 *
 * The end date asked for here is the last day the event covers, which is how
 * every calendar app in the world phrases it. The exclusive `end` tag the spec
 * wants is computed on the way out; asking a person to enter "the day after it
 * finishes" would guarantee off-by-one events.
 */
export function CalendarEventEditor({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const { publish, isPending } = usePublishCalendarEvent();

  const [kind, setKind] = useState<
    typeof DATE_EVENT_KIND | typeof TIME_EVENT_KIND
  >(TIME_EVENT_KIND);

  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [hashtags, setHashtags] = useState('');

  const [startDate, setStartDate] = useState('');
  const [throughDate, setThroughDate] = useState('');

  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');

  const reset = () => {
    setTitle('');
    setSummary('');
    setDescription('');
    setLocation('');
    setHashtags('');
    setStartDate('');
    setThroughDate('');
    setStartAt('');
    setEndAt('');
  };

  const common = () => ({
    /**
     * A random identifier, per the spec. Not derived from the title: a `d`
     * tag is the event's address, so deriving it would mean renaming an event
     * published a new one and left the old sitting there with everybody's
     * RSVPs attached.
     */
    slug: crypto.randomUUID(),
    title: title.trim(),
    summary: summary.trim() || undefined,
    content: description,
    locations: location.trim() ? [location.trim()] : [],
    hashtags: hashtags
      .split(/[,\s]+/)
      .map((tag) => tag.trim())
      .filter(Boolean),
  });

  const submit = async () => {
    if (!title.trim()) {
      toast({ title: 'Give it a title', variant: 'destructive' });
      return;
    }

    if (kind === DATE_EVENT_KIND) {
      const start = parseCalendarDate(startDate);

      if (!start) {
        toast({ title: 'Pick a start date', variant: 'destructive' });
        return;
      }

      const through = throughDate ? parseCalendarDate(throughDate) : null;

      await publish({
        kind: DATE_EVENT_KIND,
        event: { ...common(), start, through: through ?? undefined },
      });
    } else {
      /**
       * `datetime-local` has no zone, so this is read as the composer's own
       * local time — which is what they meant when they typed it. The
       * timestamp that goes on the wire is absolute, so everybody else sees
       * the same moment in their own clock.
       */
      const start = new Date(startAt).getTime();

      if (!Number.isFinite(start)) {
        toast({ title: 'Pick a start time', variant: 'destructive' });
        return;
      }

      const end = endAt ? new Date(endAt).getTime() : NaN;

      if (Number.isFinite(end) && end <= start) {
        toast({
          title: 'It has to end after it starts',
          variant: 'destructive',
        });
        return;
      }

      await publish({
        kind: TIME_EVENT_KIND,
        event: {
          ...common(),
          start: Math.floor(start / 1000),
          end: Number.isFinite(end) ? Math.floor(end / 1000) : undefined,
          // The composer's zone, which is the one the event is anchored to
          startTzid: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      });
    }

    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New event</DialogTitle>
          <DialogDescription>
            Published to Nostr, where anyone can find it and RSVP.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="event-title">Title</Label>
            <Input
              id="event-title"
              value={title}
              onChange={(changed) => setTitle(changed.target.value)}
              placeholder="Nostrica 2027"
            />
          </div>

          <Tabs
            value={String(kind)}
            onValueChange={(value) =>
              setKind(
                Number(value) === DATE_EVENT_KIND
                  ? DATE_EVENT_KIND
                  : TIME_EVENT_KIND
              )
            }
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value={String(TIME_EVENT_KIND)}>
                At a time
              </TabsTrigger>
              <TabsTrigger value={String(DATE_EVENT_KIND)}>All day</TabsTrigger>
            </TabsList>

            <TabsContent value={String(TIME_EVENT_KIND)} className="space-y-3 pt-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="event-start-at">Starts</Label>
                  <Input
                    id="event-start-at"
                    type="datetime-local"
                    value={startAt}
                    onChange={(changed) => setStartAt(changed.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="event-end-at">Ends (optional)</Label>
                  <Input
                    id="event-end-at"
                    type="datetime-local"
                    value={endAt}
                    onChange={(changed) => setEndAt(changed.target.value)}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Times are yours — {Intl.DateTimeFormat().resolvedOptions().timeZone}.
                Everyone else sees this in their own zone.
              </p>
            </TabsContent>

            <TabsContent value={String(DATE_EVENT_KIND)} className="space-y-3 pt-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="event-start-date">First day</Label>
                  <Input
                    id="event-start-date"
                    type="date"
                    value={startDate}
                    onChange={(changed) => setStartDate(changed.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="event-through-date">
                    Last day (optional)
                  </Label>
                  <Input
                    id="event-through-date"
                    type="date"
                    value={throughDate}
                    onChange={(changed) => setThroughDate(changed.target.value)}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                No times, no timezone — the same dates everywhere.
              </p>
            </TabsContent>
          </Tabs>

          <div className="space-y-1.5">
            <Label htmlFor="event-location">Where (optional)</Label>
            <Input
              id="event-location"
              value={location}
              onChange={(changed) => setLocation(changed.target.value)}
              placeholder="An address, a room, or a video call link"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="event-summary">One-line summary (optional)</Label>
            <Input
              id="event-summary"
              value={summary}
              onChange={(changed) => setSummary(changed.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="event-description">Description (optional)</Label>
            <Textarea
              id="event-description"
              value={description}
              onChange={(changed) => setDescription(changed.target.value)}
              rows={4}
              placeholder="What is it, who is it for, what should people bring."
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="event-hashtags">Tags (optional)</Label>
            <Input
              id="event-hashtags"
              value={hashtags}
              onChange={(changed) => setHashtags(changed.target.value)}
              placeholder="bitcoin, meetup"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={isPending}>
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Publish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
