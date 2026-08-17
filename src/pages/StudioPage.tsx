import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChartLine, ShieldCheck, ShieldQuestion } from 'lucide-react';

import { Layout } from '@/components/Layout';
import { LoginArea } from '@/components/auth/LoginArea';
import { PageHeader } from '@/components/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useSeo } from '@/hooks/useSeo';
import { useStudio } from '@/hooks/useStudio';
import { describeSource, type TopTarget } from '@/lib/studio';
import { formatSats } from '@/lib/zap';
import { cn } from '@/lib/utils';

const WINDOWS = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
];

/**
 * What you earned, and where it came from.
 *
 * Built only from zap receipts that survive NIP-57 validation, so no figure
 * here can exceed the one on the post it came from. The mockups' Studio also
 * shows memberships, paid unlocks and market sales; those are absent because
 * there is nothing behind them yet, and a dashboard that invents rows is worse
 * than one with fewer.
 */
export function StudioPage() {
  const { user } = useCurrentUser();
  const [days, setDays] = useState(30);
  const { summary, isLoading, verified } = useStudio(days);

  useSeo({
    title: 'Studio',
    description: 'What you earned on NostrFeed, and where it came from.',
    path: '/studio',
    noindex: true,
  });

  if (!user) {
    return (
      <Layout>
        <div className="space-y-5">
          <PageHeader
            icon={ChartLine}
            title="Studio"
            description="What you earned, and where it came from."
          />
          <Card className="border-dashed">
            <CardContent className="space-y-6 px-8 py-12 text-center">
              <p className="text-muted-foreground">
                Sign in to see your own figures.
              </p>
              <LoginArea className="mx-auto max-w-60" />
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        <PageHeader
          icon={ChartLine}
          title="Studio"
          description="What you earned, and where it came from."
        />

        <div className="flex flex-wrap items-center gap-3">
          <ToggleGroup
            type="single"
            value={String(days)}
            onValueChange={(value) => value && setDays(Number(value))}
            className="gap-1"
          >
            {WINDOWS.map((window) => (
              <ToggleGroupItem
                key={window.days}
                value={String(window.days)}
                className="h-8 rounded-lg px-3 text-xs data-[state=on]:bg-primary/15 data-[state=on]:text-primary"
              >
                {window.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          <Verification verified={verified} />
        </div>

        {isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-24 rounded-xl" />
            ))}
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat
                kicker="earned"
                value={formatSats(summary.sats)}
                unit="sats"
                meta={
                  summary.change === null
                    ? 'no earlier period to compare'
                    : `${summary.change >= 0 ? '+' : ''}${summary.change}% vs previous`
                }
                tone={
                  summary.change === null
                    ? undefined
                    : summary.change >= 0
                      ? 'up'
                      : 'down'
                }
              />
              <Stat
                kicker="payments"
                value={summary.payments.toLocaleString()}
                meta={`${formatSats(
                  summary.payments ? Math.round(summary.sats / summary.payments) : 0
                )} sats on average`}
              />
              <Stat
                kicker="zappers"
                value={summary.zappers.toLocaleString()}
                meta={`${summary.repeatZappers.toLocaleString()} came back`}
              />
              <Stat
                kicker="previous period"
                value={formatSats(summary.previousSats)}
                unit="sats"
                meta={`the ${days} days before`}
              />
            </div>

            <Section title="Where the sats came from">
              {summary.bySource.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Source</TableHead>
                      <TableHead className="text-right">Payments</TableHead>
                      <TableHead className="text-right">Sats</TableHead>
                      <TableHead className="text-right">Share</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.bySource.map((row) => (
                      <TableRow key={row.source}>
                        <TableCell>{describeSource(row.source)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.payments.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.sats.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {row.share}%
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <Empty>Nothing arrived in this period.</Empty>
              )}
            </Section>

            <Section title="What earned most">
              {summary.topTargets.length ? (
                <div className="space-y-1">
                  {summary.topTargets.map((target) => (
                    <TargetRow key={target.target} target={target} />
                  ))}
                </div>
              ) : (
                <Empty>
                  Nothing you posted was zapped in this period.
                </Empty>
              )}
            </Section>
          </>
        )}
      </div>
    </Layout>
  );
}

/**
 * Whether these numbers were checked against the author's own lightning
 * server.
 *
 * Said out loud because the difference is real: without the provider key every
 * NIP-57 check still runs, but the one that stops a stranger publishing a
 * receipt in your name does not. A dashboard that cannot tell you how much to
 * trust it is a dashboard you should not quote.
 */
function Verification({ verified }: { verified: boolean }) {
  const Icon = verified ? ShieldCheck : ShieldQuestion;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px]',
            verified
              ? 'border-success/30 text-success-strong'
              : 'border-border text-muted-foreground'
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          {verified ? 'Verified receipts' : 'Unverified provider'}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        {verified
          ? 'Every receipt counted here was signed by your lightning server, so nobody else can add to these figures.'
          : 'Your lightning server has not been seen by this browser yet, so receipts pass every check except the one proving the server signed them. Send or receive one zap here and it will be.'}
      </TooltipContent>
    </Tooltip>
  );
}

function Stat({
  kicker,
  value,
  unit,
  meta,
  tone,
}: {
  kicker: string;
  value: string;
  unit?: string;
  meta: string;
  tone?: 'up' | 'down';
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {kicker}
        </p>
        <p className="mt-1 text-3xl tabular-nums">
          {value}
          {unit && (
            <span className="ml-1.5 text-sm text-muted-foreground">{unit}</span>
          )}
        </p>
        <p
          className={cn(
            'mt-0.5 text-xs',
            tone === 'up' && 'text-success-strong',
            tone === 'down' && 'text-warning-strong',
            !tone && 'text-muted-foreground'
          )}
        >
          {meta}
        </p>
      </CardContent>
    </Card>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <Card className="border-dashed">
      <CardContent className="px-6 py-8 text-center text-sm text-muted-foreground">
        {children}
      </CardContent>
    </Card>
  );
}

function TargetRow({ target }: { target: TopTarget }) {
  /*
   * A note is addressed by id and an article by coordinate, and only the first
   * is a link this app can build without decoding the second. Both still show
   * their earnings — a row that cannot be clicked is better than a row that is
   * missing.
   */
  const href = target.source === 'note' ? `/${target.target}` : undefined;

  const label =
    target.source === 'article'
      ? target.target.split(':').slice(2).join(':') || 'Article'
      : `${target.target.slice(0, 12)}…`;

  const body = (
    <div className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:border-primary/40">
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
        {label}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {target.payments} {target.payments === 1 ? 'zap' : 'zaps'}
      </span>
      <span className="shrink-0 tabular-nums text-sm">
        {target.sats.toLocaleString()}
      </span>
    </div>
  );

  return href ? <Link to={href}>{body}</Link> : body;
}

export default StudioPage;
