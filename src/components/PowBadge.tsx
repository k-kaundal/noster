import { Pickaxe } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { committedDifficulty, eventDifficulty } from '@/lib/nip13';
import type { NostrEvent } from '@nostrify/nostrify';
import { cn } from '@/lib/utils';

/**
 * Below this, the work is not worth mentioning.
 *
 * Every id has some leading zeroes by chance — a few bits is a coin-flip run,
 * not evidence of effort. Badging those would put a "proof of work" label on
 * ordinary notes and teach readers the badge means nothing.
 */
const FLOOR = 8;

/**
 * The proof of work on a note.
 *
 * Shown only when the author committed to a target, and reported as what they
 * committed to rather than what they hit. NIP-13's point is that the two can
 * differ: a spammer mining cheaply in bulk produces some ids that reach a high
 * difficulty by luck, and displaying the lucky number would advertise effort
 * that was never spent.
 */
export function PowBadge({
  event,
  className,
}: {
  event: NostrEvent;
  className?: string;
}) {
  const difficulty = eventDifficulty(event);
  const committed = committedDifficulty(event);

  if (difficulty < FLOOR) return null;

  /**
   * An uncommitted id is not called proof of work at all. It may be honest
   * mining by a client that omits the target, or it may be luck, and nothing
   * in the event distinguishes them — so the badge says what is actually
   * known.
   */
  const claimed = committed !== null && committed >= FLOOR;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="secondary"
          className={cn('gap-1 font-normal tabular-nums', className)}
        >
          <Pickaxe className="h-3 w-3" />
          {claimed ? committed : difficulty}
        </Badge>
      </TooltipTrigger>

      <TooltipContent className="max-w-64">
        {claimed ? (
          <p>
            Mined to {committed} bits of proof of work
            {difficulty > committed
              ? `, and reached ${difficulty}.`
              : '.'}
          </p>
        ) : (
          <p>
            This id has {difficulty} leading zero bits, but the author did not
            commit to a target — so it may be luck rather than work.
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
