import { Link } from 'react-router-dom';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useRelays } from '@/hooks/useRelays';
import { useRelayHealth } from '@/hooks/useRelayHealth';
import { relayDisplayName } from '@/lib/relay';
import { cn } from '@/lib/utils';

/**
 * Aggregate relay health for the header. Reads as a single dot but reports the
 * whole pool, because a feed now draws from every enabled relay.
 */
export function ConnectionStatus({ className }: { className?: string }) {
  const { relays } = useRelays();
  const urls = relays.map((relay) => relay.url);
  const { health } = useRelayHealth(urls);

  const online = urls.filter((url) => health[url]?.status === 'online');
  const checking = urls.filter(
    (url) => !health[url] || health[url]?.status === 'checking'
  );

  const state =
    online.length > 0
      ? 'connected'
      : checking.length > 0
        ? 'connecting'
        : 'disconnected';

  const { dot, ring, label } = {
    connected: {
      dot: 'bg-success',
      ring: 'bg-success/40',
      label: `${online.length} of ${urls.length} relays connected`,
    },
    connecting: {
      dot: 'bg-warning',
      ring: 'bg-warning/40',
      label: 'Connecting to relays…',
    },
    disconnected: {
      dot: 'bg-destructive',
      ring: 'bg-destructive/40',
      label: 'No relays reachable',
    },
  }[state];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          to="/relays"
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-md transition-colors hover:bg-accent',
            className
          )}
          aria-label={label}
        >
          <span className="relative flex h-2.5 w-2.5">
            {state !== 'connected' && (
              <span
                className={cn(
                  'absolute inline-flex h-full w-full animate-ping rounded-full opacity-75',
                  ring
                )}
              />
            )}
            <span className={cn('relative inline-flex h-2.5 w-2.5 rounded-full', dot)} />
          </span>
        </Link>
      </TooltipTrigger>

      <TooltipContent side="bottom" className="max-w-64">
        <p className="font-medium">{label}</p>
        {online.length > 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            {online.slice(0, 4).map((url) => relayDisplayName(url)).join(', ')}
            {online.length > 4 ? `, +${online.length - 4} more` : ''}
          </p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">Click to manage relays</p>
      </TooltipContent>
    </Tooltip>
  );
}
