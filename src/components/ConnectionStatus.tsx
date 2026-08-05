import { useState, useEffect } from 'react';
import { useAppContext } from '@/hooks/useAppContext';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

type Status = 'connected' | 'connecting' | 'disconnected';

const STATUS_COPY: Record<Status, { label: string; dot: string; ring: string }> = {
  connected: {
    label: 'Connected',
    dot: 'bg-success',
    ring: 'bg-success/40',
  },
  connecting: {
    label: 'Connecting…',
    dot: 'bg-warning',
    ring: 'bg-warning/40',
  },
  disconnected: {
    label: 'Disconnected — retrying',
    dot: 'bg-destructive',
    ring: 'bg-destructive/40',
  },
};

/**
 * Compact relay connection indicator. Renders as a status dot with the relay
 * URL in a tooltip, so it stays out of the way until something goes wrong.
 */
export function ConnectionStatus({ className }: { className?: string }) {
  const { config } = useAppContext();
  const [status, setStatus] = useState<Status>('connecting');

  useEffect(() => {
    let ws: WebSocket | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      try {
        setStatus('connecting');
        ws = new WebSocket(config.relayUrl);

        ws.onopen = () => {
          if (!cancelled) setStatus('connected');
        };

        ws.onclose = () => {
          if (cancelled) return;
          setStatus('disconnected');
          timeoutId = setTimeout(connect, 5000);
        };

        ws.onerror = () => {
          if (!cancelled) setStatus('disconnected');
        };
      } catch {
        if (cancelled) return;
        setStatus('disconnected');
        timeoutId = setTimeout(connect, 5000);
      }
    };

    connect();

    return () => {
      cancelled = true;
      ws?.close();
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [config.relayUrl]);

  const { label, dot, ring } = STATUS_COPY[status];
  const relayHost = config.relayUrl.replace(/^wss?:\/\//, '').replace(/\/$/, '');

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-md',
            className
          )}
          role="status"
          aria-live="polite"
          aria-label={`Relay ${relayHost}: ${label}`}
        >
          <span className="relative flex h-2.5 w-2.5">
            {status !== 'connected' && (
              <span
                className={cn(
                  'absolute inline-flex h-full w-full animate-ping rounded-full opacity-75',
                  ring
                )}
              />
            )}
            <span className={cn('relative inline-flex h-2.5 w-2.5 rounded-full', dot)} />
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p className="font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{relayHost}</p>
      </TooltipContent>
    </Tooltip>
  );
}
