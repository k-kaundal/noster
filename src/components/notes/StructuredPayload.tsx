import { useState } from 'react';
import { Braces, Check, ChevronDown, ChevronUp, Copy } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatScalar, humanizeKey } from '@/lib/eventKinds';
import { cn } from '@/lib/utils';

interface StructuredPayloadProps {
  data: unknown;
  /** Shown as a chip, e.g. the event kind label. */
  label?: string;
  className?: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Readable view for events whose `content` is a JSON payload rather than prose
 * — device telemetry, service announcements and similar machine-published
 * events. Scalars become a key/value grid, nested objects become their own
 * labelled group, and the raw document stays one click away.
 */
export function StructuredPayload({
  data,
  label,
  className,
}: StructuredPayloadProps) {
  const [showRaw, setShowRaw] = useState(false);
  const [copied, setCopied] = useState(false);

  const raw = JSON.stringify(data, null, 2);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(raw);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be blocked; the raw view is still selectable
    }
  };

  // A `type`/`kind`/`event` field is the payload's own name for itself
  const typeName = isPlainObject(data)
    ? [data.type, data.kind, data.event].find(
        (value): value is string => typeof value === 'string'
      )
    : undefined;

  return (
    <div className={cn('overflow-hidden rounded-lg border bg-muted/30', className)}>
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-3 py-2">
        <Braces className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        {typeName ? (
          <span className="truncate font-mono text-xs font-medium">{typeName}</span>
        ) : (
          <span className="text-xs font-medium text-muted-foreground">
            Structured data
          </span>
        )}
        {label && (
          <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
            {label}
          </Badge>
        )}

        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={copy}
            aria-label="Copy raw JSON"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-success" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-[11px]"
            onClick={() => setShowRaw((open) => !open)}
            aria-expanded={showRaw}
          >
            {showRaw ? (
              <ChevronUp className="mr-1 h-3 w-3" />
            ) : (
              <ChevronDown className="mr-1 h-3 w-3" />
            )}
            Raw
          </Button>
        </div>
      </div>

      {showRaw ? (
        <pre className="max-h-80 overflow-auto p-3 font-mono text-[11px] leading-relaxed scrollbar-thin">
          {raw}
        </pre>
      ) : (
        <div className="p-3">
          <PayloadBody data={data} />
        </div>
      )}
    </div>
  );
}

function PayloadBody({ data }: { data: unknown }) {
  if (Array.isArray(data)) {
    return (
      <ul className="space-y-2">
        {data.slice(0, 20).map((item, index) => (
          <li key={index} className="rounded border bg-background p-2">
            <PayloadBody data={item} />
          </li>
        ))}
        {data.length > 20 && (
          <li className="text-xs text-muted-foreground">
            +{data.length - 20} more items
          </li>
        )}
      </ul>
    );
  }

  if (!isPlainObject(data)) {
    return <p className="font-mono text-xs">{formatScalar(data)}</p>;
  }

  const entries = Object.entries(data);
  const scalars = entries.filter(
    ([, value]) => !isPlainObject(value) && !Array.isArray(value)
  );
  const arrays = entries.filter(([, value]) => Array.isArray(value));
  const objects = entries.filter(([, value]) => isPlainObject(value));

  return (
    <div className="space-y-3">
      {scalars.length > 0 && <ScalarGrid entries={scalars} />}

      {arrays.map(([key, value]) => (
        <div key={key} className="space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {humanizeKey(key)}
          </p>
          <div className="flex flex-wrap gap-1">
            {(value as unknown[]).slice(0, 12).map((item, index) => (
              <span
                key={index}
                className="max-w-full truncate rounded bg-background px-1.5 py-0.5 font-mono text-[11px]"
              >
                {isPlainObject(item) ? JSON.stringify(item) : formatScalar(item)}
              </span>
            ))}
            {(value as unknown[]).length > 12 && (
              <span className="text-[11px] text-muted-foreground">
                +{(value as unknown[]).length - 12}
              </span>
            )}
          </div>
        </div>
      ))}

      {objects.map(([key, value]) => (
        <div key={key} className="space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {humanizeKey(key)}
          </p>
          <div className="rounded border bg-background p-2">
            <PayloadBody data={value} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ScalarGrid({ entries }: { entries: [string, unknown][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
      {entries.map(([key, value]) => (
        <div key={key} className="min-w-0">
          <dt className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">
            {humanizeKey(key)}
          </dt>
          <dd
            className="truncate font-mono text-xs font-medium"
            title={String(value)}
          >
            {formatScalar(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
