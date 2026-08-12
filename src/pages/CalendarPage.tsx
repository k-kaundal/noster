import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarDays, Plus } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { CalendarEventCard } from '@/components/calendar/CalendarEventCard';
import { CalendarEventEditor } from '@/components/calendar/CalendarEventEditor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useCalendarEvents } from '@/hooks/useCalendar';
import { useSeo } from '@/hooks/useSeo';
import { hasPassed, startsAt, type CalendarEvent } from '@/lib/nip52';

/**
 * Groups events under a heading a person thinks in.
 *
 * "Today" and "This week" beat a wall of dates, and the boundaries are local
 * — computed from the reader's own midnight, so an event at 23:00 tonight is
 * today rather than tomorrow for somebody east of the publisher.
 */
function groupByWhen(events: CalendarEvent[]): [string, CalendarEvent[]][] {
  const now = new Date();

  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  const endOfWeek = new Date(endOfToday);
  endOfWeek.setDate(endOfWeek.getDate() + 7);

  const endOfMonth = new Date(endOfToday);
  endOfMonth.setMonth(endOfMonth.getMonth() + 1);

  const groups = new Map<string, CalendarEvent[]>([
    ['Today', []],
    ['This week', []],
    ['This month', []],
    ['Later', []],
    ['Past', []],
  ]);

  for (const event of events) {
    const at = startsAt(event) * 1000;

    const bucket = hasPassed(event)
      ? 'Past'
      : at <= endOfToday.getTime()
        ? 'Today'
        : at <= endOfWeek.getTime()
          ? 'This week'
          : at <= endOfMonth.getTime()
            ? 'This month'
            : 'Later';

    groups.get(bucket)!.push(event);
  }

  return [...groups].filter(([, list]) => list.length > 0);
}

/** NIP-52 calendar events, browsable. */
export function CalendarPage() {
  useSeo({
    title: 'Calendar',
    description: 'Events happening on Nostr.',
    path: '/calendar',
  });

  const { user } = useCurrentUser();
  const [params, setParams] = useSearchParams();
  const hashtag = params.get('t') || undefined;

  const [includePast, setIncludePast] = useState(false);
  const [composing, setComposing] = useState(false);

  const { events, isLoading } = useCalendarEvents({ hashtag, includePast });

  const grouped = groupByWhen(events);

  return (
    <Layout>
      <div className="space-y-6">
        <PageHeader
          icon={CalendarDays}
          title="Calendar"
          description="Meetups, conferences and anything else with a date on it."
          action={
            user && (
              <Button onClick={() => setComposing(true)} className="gap-1.5">
                <Plus className="h-4 w-4" />
                New event
              </Button>
            )
          }
        />

        <div className="flex flex-wrap items-center gap-3">
          {hashtag && (
            <Badge
              variant="secondary"
              className="cursor-pointer gap-1"
              onClick={() => {
                params.delete('t');
                setParams(params);
              }}
            >
              #{hashtag} ✕
            </Badge>
          )}

          <Label className="ml-auto flex cursor-pointer items-center gap-2 text-sm font-normal">
            <Switch checked={includePast} onCheckedChange={setIncludePast} />
            Show past events
          </Label>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((index) => (
              <Card key={index} className="flex gap-4 p-4">
                <Skeleton className="h-16 w-16 shrink-0 rounded-xl" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </Card>
            ))}
          </div>
        ) : events.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title={hashtag ? `Nothing tagged #${hashtag}` : 'No events yet'}
            description={
              includePast
                ? 'No calendar events on this relay.'
                : 'Nothing coming up here. Try another relay, or look at past events.'
            }
            showRelaySelector
          />
        ) : (
          <div className="space-y-6">
            {grouped.map(([heading, list]) => (
              <section key={heading} className="space-y-3">
                <h2 className="text-sm font-semibold text-muted-foreground">
                  {heading}
                  <span className="ml-2 font-normal">{list.length}</span>
                </h2>

                <div className="space-y-3">
                  {list.map((entry) => (
                    <CalendarEventCard
                      key={`${entry.event.kind}:${entry.event.pubkey}:${entry.slug}`}
                      calendarEvent={entry}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      <CalendarEventEditor open={composing} onOpenChange={setComposing} />
    </Layout>
  );
}

export default CalendarPage;
