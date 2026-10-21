import { useUserStatuses } from '@/hooks/useUserStatuses';
import { StatusBadge } from './StatusBadge';
import { cn } from '@/lib/utils';

/**
 * All of a person's active statuses, stacked.
 *
 * Damus's pattern: `general` and `music` each get their own slot, and both
 * render at once when both are set. An empty render is fine — most people
 * have never set one, and a blank gap where a status would go is the
 * expected state.
 */
export function UserStatusLine({
  pubkey,
  className,
}: {
  pubkey: string;
  className?: string;
}) {
  const { general, music, others } = useUserStatuses(pubkey);

  if (!general && !music && !others.length) return null;

  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      {general && <StatusBadge status={general} />}
      {music && <StatusBadge status={music} />}
      {others.map((status) => (
        <StatusBadge key={status.address} status={status} />
      ))}
    </div>
  );
}
