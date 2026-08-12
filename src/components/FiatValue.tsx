import { useFiat } from '@/hooks/useFiat';
import { cn } from '@/lib/utils';

/**
 * What an amount of sats is worth, beside the amount itself.
 *
 * Renders nothing when there is no price — not a dash, not a zero. Anything
 * printed in this slot is read as a value, and "$0.00" next to a balance is a
 * worse lie than silence.
 */
export function FiatValue({
  sats,
  className,
}: {
  sats: number;
  className?: string;
}) {
  const { enabled, format, stale } = useFiat();

  if (!enabled) return null;

  const value = format(sats);
  if (!value) return null;

  return (
    <span
      className={cn('tabular-nums text-muted-foreground', className)}
      /**
       * Marked rather than hidden. A price from half an hour ago still answers
       * "roughly how much is this", which is what the figure is for; what it
       * must not do is pass itself off as current.
       */
      title={
        stale
          ? 'Last known price — the rate has not refreshed recently'
          : undefined
      }
    >
      ≈ {value}
      {stale && <span className="ml-1 opacity-60">(old)</span>}
    </span>
  );
}
