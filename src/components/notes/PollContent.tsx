import { useState } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';
import { formatDistanceToNow } from 'date-fns';
import { BarChart3, Check, Loader2 } from 'lucide-react';
import { usePoll } from '@/hooks/usePoll';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useToast } from '@/hooks/useToast';
import { Button } from '@/components/ui/button';
import { optionShare, type Poll } from '@/lib/poll';
import { cn } from '@/lib/utils';

interface PollContentProps {
  event: NostrEvent;
  poll: Poll;
  className?: string;
}

/**
 * A NIP-88 poll. Results stay hidden until the reader has voted or the poll
 * has closed, so the current standings can't anchor their choice.
 */
export function PollContent({ event, poll, className }: PollContentProps) {
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const { tally, closed, hasVoted, isLoading, vote, isVoting } = usePoll(
    event,
    poll
  );

  const [selected, setSelected] = useState<string[]>([]);
  const showResults = hasVoted || closed;

  const toggle = (optionId: string) => {
    if (showResults || isVoting) return;

    setSelected((current) =>
      poll.type === 'singlechoice'
        ? [optionId]
        : current.includes(optionId)
          ? current.filter((id) => id !== optionId)
          : [...current, optionId]
    );
  };

  const submit = async () => {
    if (!user) {
      toast({
        title: 'Login required',
        description: 'You must be logged in to vote.',
        variant: 'destructive',
      });
      return;
    }
    await vote(selected);
    setSelected([]);
  };

  return (
    <div className={cn('space-y-3', className)}>
      {poll.question && (
        <p className="whitespace-pre-wrap break-words font-medium">
          {poll.question}
        </p>
      )}

      <ul className="space-y-2">
        {poll.options.map((option) => {
          const share = optionShare(tally, option.id);
          const chosen = tally.ownChoices.includes(option.id);
          const isSelected = selected.includes(option.id);

          return (
            <li key={option.id}>
              <button
                type="button"
                onClick={() => toggle(option.id)}
                disabled={showResults || isVoting}
                aria-pressed={isSelected || chosen}
                className={cn(
                  'relative w-full overflow-hidden rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                  showResults
                    ? 'cursor-default'
                    : 'hover:border-primary hover:bg-primary/5',
                  isSelected && 'border-primary bg-primary/5',
                  chosen && 'border-primary'
                )}
              >
                {/* The fill sits behind the label rather than replacing it */}
                {showResults && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-0 left-0 bg-primary/15 transition-[width] duration-500"
                    style={{ width: `${share}%` }}
                  />
                )}

                <span className="relative flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>

                  {chosen && (
                    <Check className="h-4 w-4 shrink-0 text-primary" />
                  )}
                  {showResults && (
                    <span className="shrink-0 text-xs font-semibold tabular-nums">
                      {share}%
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {!showResults && (
          <Button
            size="sm"
            onClick={submit}
            disabled={!selected.length || isVoting}
            className="bg-brand-gradient"
          >
            {isVoting && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            Vote
          </Button>
        )}

        <span className="flex items-center gap-1">
          <BarChart3 className="h-3.5 w-3.5" />
          {isLoading
            ? 'Counting…'
            : `${tally.total} ${tally.total === 1 ? 'vote' : 'votes'}`}
        </span>

        {poll.type === 'multiplechoice' && !showResults && (
          <span>Pick as many as you like</span>
        )}

        {poll.endsAt !== undefined && (
          <span>
            {closed
              ? 'Closed'
              : `Ends ${formatDistanceToNow(new Date(poll.endsAt * 1000), {
                  addSuffix: true,
                })}`}
          </span>
        )}
      </div>
    </div>
  );
}
