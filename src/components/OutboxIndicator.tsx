import { CloudOff, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { useOutbox } from '@/hooks/useOutbox';
import { isAdmissionRejection } from '@/lib/paidRelay';
import { cn } from '@/lib/utils';

/**
 * What has been written but not yet sent.
 *
 * Shown only when there is something waiting. A publish that fails no longer
 * loses the note, but a note that is silently held is its own kind of lie —
 * someone is entitled to know their post is not out there yet, and to see it
 * being retried.
 */
export function OutboxIndicator({ className }: { className?: string }) {
  const { items, count, retry, discard } = useOutbox();
  const [retrying, setRetrying] = useState(false);

  /*
   * Any of them, not all: one refused note is enough to explain a queue that
   * will not drain, and the rest are usually the same key hitting the same
   * relay.
   */
  const blocked = items.some((item) => isAdmissionRejection(item.lastError));

  if (!count) return null;

  const send = async () => {
    setRetrying(true);
    try {
      await retry();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn('h-9 gap-1.5 px-2 text-warning', className)}
          aria-label={`${count} ${count === 1 ? 'note' : 'notes'} waiting to send`}
        >
          <CloudOff className="h-4 w-4" />
          <span className="text-xs font-semibold tabular-nums">{count}</span>
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80">
        <div className="space-y-3">
          <div>
            <p className="text-sm font-semibold">
              {count === 1 ? '1 note waiting' : `${count} notes waiting`}
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              Signed and saved on this device. They'll go out on their own as
              soon as a relay answers.
            </p>
          </div>

          {/*
            The one failure retrying cannot fix.

            A paid relay rejects an unadmitted key outright, and nothing about
            waiting changes that — so the queue would sit here filling up while
            "Try now" reported the same refusal forever, with no word anywhere
            about what the relay actually said. This is the only place that
            sentence can reach the person who needs it.
          */}
          {blocked && (
            <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/8 p-3">
              <p className="text-xs text-warning-strong">
                A relay refused these because this account hasn't been admitted.
                Retrying won't change that.
              </p>
              <Button asChild size="sm" variant="outline" className="w-full">
                <Link to="/premium">See relay access</Link>
              </Button>
            </div>
          )}

          <ul className="space-y-2">
            {items.slice(0, 5).map((item) => (
              <li
                key={item.event.id}
                className="flex items-start gap-2 rounded-lg border p-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs">
                    {item.event.content.trim() || `kind ${item.event.kind}`}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {new Date(item.queuedAt).toLocaleTimeString()} ·{' '}
                    {item.attempts === 1
                      ? '1 attempt'
                      : `${item.attempts} attempts`}
                  </p>
                </div>

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  onClick={() => discard(item.event.id)}
                  aria-label="Discard this note"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>

          {count > 5 && (
            <p className="text-xs text-muted-foreground">
              and {count - 5} more
            </p>
          )}

          <Button
            size="sm"
            className="w-full"
            onClick={send}
            disabled={retrying}
          >
            {retrying ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-3.5 w-3.5" />
            )}
            Try now
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
