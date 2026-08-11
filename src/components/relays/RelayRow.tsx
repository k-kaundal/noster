import { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Coins,
  ExternalLink,
  Lock,
  Star,
  Trash2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useRelayInfo } from '@/hooks/useRelayInfo';
import type { RelayHealth } from '@/hooks/useRelayHealth';
import { RelayAdminPanel } from '@/components/relays/RelayAdminPanel';
import { relayDisplayName, type RelayEntry } from '@/lib/relay';
import { cn } from '@/lib/utils';

interface RelayRowProps {
  relay: RelayEntry;
  health?: RelayHealth;
  isPrimary: boolean;
  canRemove: boolean;
  onToggleMode: (mode: 'read' | 'write', value: boolean) => void;
  onSetPrimary: () => void;
  onRemove: () => void;
}

/** Colors latency by how it will actually feel: snappy, okay, sluggish. */
function latencyTone(latency: number) {
  if (latency < 200) return 'text-success';
  if (latency < 600) return 'text-warning';
  return 'text-destructive';
}

export function RelayRow({
  relay,
  health,
  isPrimary,
  canRemove,
  onToggleMode,
  onSetPrimary,
  onRemove,
}: RelayRowProps) {
  const [expanded, setExpanded] = useState(false);
  const { data: info, isLoading: infoLoading } = useRelayInfo(
    expanded ? relay.url : undefined
  );

  const status = health?.status ?? 'idle';
  const readWriteId = relay.url.replace(/\W/g, '');

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <StatusDot status={status} error={health?.error} />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">
              {relayDisplayName(relay.url)}
            </span>
            {isPrimary && (
              <Badge variant="secondary" className="h-5 shrink-0 px-1.5 text-[10px]">
                Primary
              </Badge>
            )}
          </div>

          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            {health?.latency !== undefined && status === 'online' && (
              <span className={cn('tabular-nums', latencyTone(health.latency))}>
                {health.latency} ms
              </span>
            )}
            {status === 'offline' && (
              <span className="text-destructive">
                {health?.error ?? 'Unreachable'}
              </span>
            )}
            {status === 'checking' && <span>Checking…</span>}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Switch
              id={`read-${readWriteId}`}
              checked={relay.read}
              onCheckedChange={(value) => onToggleMode('read', value)}
              aria-label={`Read from ${relayDisplayName(relay.url)}`}
            />
            <Label
              htmlFor={`read-${readWriteId}`}
              className="cursor-pointer text-xs text-muted-foreground"
            >
              Read
            </Label>
          </div>

          <div className="flex items-center gap-1.5">
            <Switch
              id={`write-${readWriteId}`}
              checked={relay.write}
              onCheckedChange={(value) => onToggleMode('write', value)}
              aria-label={`Publish to ${relayDisplayName(relay.url)}`}
            />
            <Label
              htmlFor={`write-${readWriteId}`}
              className="cursor-pointer text-xs text-muted-foreground"
            >
              Write
            </Label>
          </div>

          <div className="flex items-center">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={onSetPrimary}
                  disabled={isPrimary}
                  aria-label="Make primary relay"
                >
                  <Star
                    className={cn(
                      'h-4 w-4',
                      isPrimary && 'fill-warning text-warning'
                    )}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {isPrimary ? 'Primary relay' : 'Make primary'}
              </TooltipContent>
            </Tooltip>

            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setExpanded((open) => !open)}
              aria-expanded={expanded}
              aria-label="Relay details"
            >
              {expanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  onClick={onRemove}
                  disabled={!canRemove}
                  aria-label="Remove relay"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {canRemove ? 'Remove relay' : 'Keep at least one relay'}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 rounded-lg border bg-muted/30 p-3">
          {infoLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ) : !info ? (
            <p className="text-xs text-muted-foreground">
              This relay didn't return a NIP-11 document. Many relays omit the
              CORS headers a browser needs, so this is common and doesn't mean
              the relay is down.
            </p>
          ) : (
            <RelayInfoPanel info={info} url={relay.url} />
          )}

          {/*
            Outside the NIP-11 branch on purpose: a relay can serve the
            management API while omitting the CORS headers its info document
            needs, and an administrator should not lose their tools because a
            different endpoint is unreachable. Renders nothing unless the relay
            recognises this key.
          */}
          <RelayAdminPanel relayUrl={relay.url} />
        </div>
      )}
    </li>
  );
}

function StatusDot({
  status,
  error,
}: {
  status: RelayHealth['status'];
  error?: string;
}) {
  const tone =
    status === 'online'
      ? 'bg-success'
      : status === 'offline'
        ? 'bg-destructive'
        : status === 'checking'
          ? 'bg-warning'
          : 'bg-muted-foreground/40';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
          <span
            className={cn(
              'inline-flex h-2.5 w-2.5 rounded-full',
              tone,
              status === 'checking' && 'animate-pulse'
            )}
          />
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {status === 'online'
          ? 'Reachable'
          : status === 'offline'
            ? (error ?? 'Unreachable')
            : status === 'checking'
              ? 'Checking…'
              : 'Not checked yet'}
      </TooltipContent>
    </Tooltip>
  );
}

function RelayInfoPanel({
  info,
  url,
}: {
  info: NonNullable<ReturnType<typeof useRelayInfo>['data']>;
  url: string;
}) {
  const limitation = info.limitation ?? {};
  const paid = limitation.payment_required || !!info.fees?.admission?.length;

  return (
    <div className="space-y-3 text-xs">
      <div className="flex items-start gap-2">
        {info.icon && (
          <img
            src={info.icon}
            alt=""
            className="h-8 w-8 shrink-0 rounded-md object-cover"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{info.name ?? relayDisplayName(url)}</p>
          {info.description && (
            <p className="mt-0.5 text-muted-foreground">{info.description}</p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {limitation.auth_required && (
          <Badge variant="outline" className="gap-1 text-[10px]">
            <Lock className="h-3 w-3" />
            Auth required
          </Badge>
        )}
        {paid && (
          <Badge variant="outline" className="gap-1 text-[10px]">
            <Coins className="h-3 w-3" />
            Paid relay
          </Badge>
        )}
        {limitation.restricted_writes && (
          <Badge variant="outline" className="text-[10px]">
            Restricted writes
          </Badge>
        )}
        {typeof limitation.min_pow_difficulty === 'number' &&
          limitation.min_pow_difficulty > 0 && (
            <Badge variant="outline" className="text-[10px]">
              PoW {limitation.min_pow_difficulty}
            </Badge>
          )}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {info.software && (
          <Detail label="Software">
            {info.software.replace(/^https?:\/\/(www\.)?/, '')}
            {info.version ? ` ${info.version}` : ''}
          </Detail>
        )}
        {typeof limitation.max_limit === 'number' && (
          <Detail label="Max limit">{limitation.max_limit}</Detail>
        )}
        {typeof limitation.max_subscriptions === 'number' && (
          <Detail label="Max subs">{limitation.max_subscriptions}</Detail>
        )}
        {typeof limitation.max_content_length === 'number' && (
          <Detail label="Max content">
            {limitation.max_content_length.toLocaleString()} bytes
          </Detail>
        )}
      </dl>

      {!!info.supported_nips?.length && (
        <div>
          <p className="mb-1 font-medium text-muted-foreground">Supported NIPs</p>
          <div className="flex flex-wrap gap-1">
            {info.supported_nips.slice(0, 24).map((nip) => (
              <span
                key={nip}
                className="rounded bg-background px-1.5 py-0.5 font-mono text-[10px]"
              >
                {nip}
              </span>
            ))}
          </div>
        </div>
      )}

      {(info.payments_url || info.terms_of_service) && (
        <div className="flex flex-wrap gap-3 pt-1">
          {info.payments_url && (
            <a
              href={info.payments_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
            >
              Payment info
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {info.terms_of_service && (
            <a
              href={info.terms_of_service}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
            >
              Terms
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function Detail({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium">{children}</dd>
    </div>
  );
}
