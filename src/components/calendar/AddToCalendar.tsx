import { useState } from 'react';
import { Check, FolderPlus, Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import {
  useCalendarInclusion,
  useCalendars,
  useCreateCalendar,
} from '@/hooks/useCalendar';

/**
 * Filing an event under one of your own calendars.
 *
 * This is the granting half of the spec's collaborative flow. An event can
 * carry an `a` tag *asking* to be in a calendar, but a request is not an
 * inclusion — what puts it there is the calendar owner's own `a` tag pointing
 * back, which only they can publish. So the button is only ever about the
 * reader's own calendars, never somebody else's.
 */
export function AddToCalendar({ address }: { address: string }) {
  const { user } = useCurrentUser();
  const { calendars, isLoading } = useCalendars(user?.pubkey);
  const { include, isPending } = useCalendarInclusion();
  const { createCalendar, isPending: isCreating } = useCreateCalendar();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');

  if (!user) return null;

  const mine = calendars.filter(
    (calendar) => calendar.event.pubkey === user.pubkey
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <FolderPlus className="h-3.5 w-3.5" />
          Add to calendar
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-72 space-y-3" align="end">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading your calendars…</p>
        ) : mine.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            You don't have a calendar yet. Make one below.
          </p>
        ) : (
          <div className="space-y-1">
            {mine.map((calendar) => {
              const already = calendar.entries.includes(address);

              return (
                <Button
                  key={calendar.slug}
                  variant="ghost"
                  size="sm"
                  disabled={already || isPending}
                  className="w-full justify-start gap-2"
                  onClick={async () => {
                    await include({ calendar, address });
                    setOpen(false);
                  }}
                >
                  {already ? (
                    <Check className="h-3.5 w-3.5 text-success-strong" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" />
                  )}
                  <span className="truncate">{calendar.title}</span>
                </Button>
              );
            })}
          </div>
        )}

        <form
          className="flex gap-1.5 border-t pt-3"
          onSubmit={async (submitted) => {
            submitted.preventDefault();
            if (!name.trim()) return;

            await createCalendar({ title: name });
            setName('');
          }}
        >
          <Input
            value={name}
            onChange={(changed) => setName(changed.target.value)}
            placeholder="New calendar name"
            className="h-8 text-sm"
          />
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            disabled={isCreating || !name.trim()}
          >
            {isCreating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

