import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { Gauge } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useAuthor } from '@/hooks/useAuthor';
import { useAssertions } from '@/hooks/useTrustedAssertions';
import { genUserName } from '@/lib/genUserName';
import {
  METRICS,
  USER_ASSERTION,
  formatMetric,
  pickAssertion,
  type AssertionKind,
} from '@/lib/nip85';
import { cn } from '@/lib/utils';

/**
 * A web-of-trust rank, attributed.
 *
 * The provider's name is not decoration. A rank is one service's opinion
 * computed by an algorithm the reader chose — "89" on its own reads as a
 * property of the person, which is exactly the reading this NIP exists to
 * avoid. Nothing here renders a number without saying whose it is.
 */
export function TrustScore({
  pubkey,
  className,
}: {
  pubkey: string;
  className?: string;
}) {
  const { assertions, providers } = useAssertions(USER_ASSERTION, pubkey);

  const found = pickAssertion(assertions, providers, USER_ASSERTION, 'rank');
  const provider = useAuthor(found?.assertion.provider);

  if (!found || found.metric.value === undefined) return null;

  const metadata = provider.data?.metadata;
  const name =
    metadata?.name ||
    metadata?.display_name ||
    genUserName(found.assertion.provider);

  const rank = Math.round(found.metric.value);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          to={`/${nip19.npubEncode(found.assertion.provider)}`}
          className={cn('inline-flex', className)}
        >
          <Badge variant="outline" className="gap-1 font-normal">
            <Gauge className="h-3 w-3 text-primary" />
            {rank}
          </Badge>
        </Link>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">
        {name} rates this account {rank} out of 100. That is one service's
        algorithm, which you chose — not a fact about the person.
        {metadata?.about && (
          <span className="mt-1 block text-muted-foreground">
            {metadata.about}
          </span>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Everything a trusted provider says about a subject.
 *
 * Grouped by provider rather than merged into one list of numbers. Two
 * services computing "followers" differently is the normal case the NIP
 * describes — one excluding muted keys, another not — so a single figure with
 * no name on it would be averaging two answers to different questions.
 */
export function TrustPanel({
  kind,
  subject,
  className,
}: {
  kind: AssertionKind;
  subject: string;
  className?: string;
}) {
  const { assertions, hasProviders } = useAssertions(kind, subject);

  if (!hasProviders || !assertions.length) return null;

  return (
    <div className={cn('space-y-3', className)}>
      {assertions.map((assertion) => (
        <ProviderBlock key={assertion.event.id} assertion={assertion} />
      ))}
    </div>
  );
}

function ProviderBlock({
  assertion,
}: {
  assertion: ReturnType<typeof useAssertions>['assertions'][number];
}) {
  const author = useAuthor(assertion.provider);
  const metadata = author.data?.metadata;
  const name =
    metadata?.name || metadata?.display_name || genUserName(assertion.provider);

  /** Ordered as the spec lists them, not as the provider happened to tag them. */
  const ordered = METRICS[assertion.kind]
    .map((spec) => assertion.metrics.find((metric) => metric.tag === spec.tag))
    .filter((metric): metric is NonNullable<typeof metric> => !!metric);

  return (
    <div className="rounded-lg border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <Link
          to={`/${nip19.npubEncode(assertion.provider)}`}
          className="truncate text-sm font-medium hover:underline"
        >
          {name}
        </Link>
        <span className="shrink-0 text-xs text-muted-foreground">
          {new Date(assertion.createdAt * 1000).toLocaleDateString()}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {ordered.map((metric) => (
          <div key={metric.tag} className="min-w-0">
            <dt className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">
              {metric.label}
            </dt>
            <dd className="truncate text-sm font-medium">
              {formatMetric(metric)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
