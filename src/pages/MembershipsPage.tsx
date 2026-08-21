import { Link } from 'react-router-dom';
import { Clock, Users } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { LoginArea } from '@/components/auth/LoginArea';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { MemberRow } from '@/components/subscriptions/MemberRow';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useMemberships } from '@/hooks/useSubscriptions';
import { useSeo } from '@/hooks/useSeo';
import { describeCadence, type TierStanding } from '@/lib/subscription';
import { formatSats } from '@/lib/zap';

/**
 * Who is supporting you, and what it comes to.
 *
 * This page used to be a mockup: invented tiers, invented subscriber counts,
 * and a monthly revenue figure computed from both — a creator reading it was
 * shown earnings nobody had paid. Every number here is now read from zap
 * receipts that pass NIP-57 validation, which means each one can be
 * reproduced by anybody holding the same receipts, including the supporters
 * themselves.
 *
 * The figure that needs the most care is the run rate. Nothing on Nostr can
 * charge anybody on a schedule, so "what these subscriptions are worth per
 * month" is a description of the periods currently running — not a forecast of
 * next month, which depends entirely on people choosing to pay again.
 */
export function MembershipsPage() {
  const { user } = useCurrentUser();
  const { standings, summary, isLoading } = useMemberships();

  useSeo({
    title: 'Memberships',
    description: 'Who supports you, and what it comes to.',
    path: '/memberships',
    noindex: true,
  });

  return (
    <Layout>
      <div className="space-y-6">
        <PageHeader
          icon={Users}
          title="Memberships"
          description="Recurring support from the people who read you."
        />

        {!user ? (
          <Card className="border-dashed">
            <CardContent className="space-y-6 px-8 py-12 text-center">
              <p className="text-muted-foreground">
                Sign in to see who supports you.
              </p>
              <LoginArea className="mx-auto max-w-60" />
            </CardContent>
          </Card>
        ) : isLoading ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-24 rounded-xl" />
              ))}
            </div>
            <Skeleton className="h-48 rounded-xl" />
          </div>
        ) : !standings.length ? (
          <EmptyState
            icon={Users}
            title="No tiers yet"
            description="A tier is what somebody pays for, one period at a time. Publish one and the people who pay it appear here."
            action={
              <Button asChild>
                <Link to="/wallet">Create a tier</Link>
              </Button>
            }
          />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat
                kicker="supporters"
                value={summary.activeMembers.toLocaleString()}
                meta={
                  summary.renewingSoon > 0
                    ? `${summary.renewingSoon} ending soon`
                    : 'inside a paid period'
                }
              />
              <Stat
                kicker="per month"
                value={formatSats(summary.runRateSats)}
                unit="sats"
                meta="what the running periods are worth"
                hint="A run rate, not a forecast. Nothing here renews on its own, so this is what the periods currently running amount to monthly — next month depends on people choosing to pay again."
              />
              <Stat
                kicker="lifetime"
                value={formatSats(summary.lifetimeSats)}
                unit="sats"
                meta="through tiers, all time"
              />
              <Stat
                kicker="lapsed"
                value={summary.lapsedMembers.toLocaleString()}
                meta={
                  summary.lapsedMembers
                    ? 'paid before, not now'
                    : 'nobody has drifted off'
                }
              />
            </div>

            {/*
              Said once, at the top, rather than left for somebody to work out
              when a month goes by and nothing arrives.
            */}
            <p className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
              <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Every one of these is a payment somebody chose to make. No
                wallet on Nostr takes a standing order, so nobody is charged
                automatically — a period ending is a conversation, which is why
                each row has a message button.
              </span>
            </p>

            <div className="space-y-4">
              {standings.map((standing) => (
                <TierPanel key={standing.tier.slug} standing={standing} />
              ))}
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}

function TierPanel({ standing }: { standing: TierStanding }) {
  const { tier, active, lapsed, renewingSoon } = standing;

  /*
   * Ordered by what needs doing. Somebody about to lapse can still be caught,
   * somebody already lapsed can be asked back, and the settled majority in
   * between needs nothing — so it sits at the bottom where it can be scrolled
   * past rather than the top where it has to be.
   */
  const settled = active.filter((member) => !renewingSoon.includes(member));

  return (
    <Card>
      <CardContent className="space-y-4 pt-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <div className="min-w-0">
            <h2 className="font-semibold">{tier.title}</h2>
            <p className="tabular text-sm text-zap">
              {tier.amount.toLocaleString()} sats
              <span className="text-muted-foreground">
                {' '}
                / {describeCadence(tier.cadence)}
              </span>
            </p>
          </div>

          <div className="text-right text-sm">
            <p className="tabular-nums">
              {active.length} active
              {lapsed.length > 0 && (
                <span className="text-muted-foreground">
                  {' · '}
                  {lapsed.length} lapsed
                </span>
              )}
            </p>
            <p className="tabular-nums text-xs text-muted-foreground">
              {formatSats(standing.runRateSats)} sats/month ·{' '}
              {formatSats(standing.lifetimeSats)} all time
            </p>
          </div>
        </div>

        {/*
          What this tier promises, next to the people owed it. The perks are
          free text and nothing enforces them — so the least this page can do
          is put the promise where the creator can see who it is to.
        */}
        {tier.perks.length > 0 && (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Promised: </span>
            {tier.perks.join(' · ')}
          </p>
        )}

        {/*
          Revenue on the tier that names nobody. A NIP-57 zap can be sent
          anonymously, and one that was is real money attached to a throwaway
          key — it buys no subscription because there is nobody to grant one
          to, and hiding it would make this tier's total disagree with the
          wallet for no visible reason.
        */}
        {standing.unattributedSats > 0 && (
          <p className="text-xs text-muted-foreground">
            {standing.unattributedSats.toLocaleString()} sats arrived on this
            tier without an identifiable sender, so they are counted in the
            totals and belong to nobody below.
          </p>
        )}

        {!standing.members.length ? (
          <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
            Nobody has paid for this tier yet.
          </p>
        ) : (
          <div className="space-y-3">
            <MemberGroup
              title="Ending soon"
              tone="warning"
              members={renewingSoon}
            />
            <MemberGroup title="Lapsed" tone="muted" members={lapsed} />
            <MemberGroup title="Active" members={settled} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MemberGroup({
  title,
  members,
  tone,
}: {
  title: string;
  members: TierStanding['members'];
  tone?: 'warning' | 'muted';
}) {
  if (!members.length) return null;

  return (
    <div className="space-y-1.5">
      <p
        className={
          tone === 'warning'
            ? 'text-xs font-medium text-warning-strong'
            : 'text-xs font-medium text-muted-foreground'
        }
      >
        {title} · {members.length}
      </p>
      {members.map((member) => (
        <MemberRow key={member.pubkey} member={member} />
      ))}
    </div>
  );
}

function Stat({
  kicker,
  value,
  unit,
  meta,
  hint,
}: {
  kicker: string;
  value: string;
  unit?: string;
  meta: string;
  /** Shown on the figure that needs explaining rather than in a footnote. */
  hint?: string;
}) {
  const body = (
    <Card>
      <CardContent className="space-y-1 py-4">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {kicker}
        </p>
        <p className="tabular-nums text-2xl font-semibold">
          {value}
          {unit && (
            <span className="ml-1 text-sm font-normal text-muted-foreground">
              {unit}
            </span>
          )}
        </p>
        <p className="text-xs text-muted-foreground">{meta}</p>
      </CardContent>
    </Card>
  );

  if (!hint) return body;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{body}</TooltipTrigger>
      <TooltipContent className="max-w-xs">{hint}</TooltipContent>
    </Tooltip>
  );
}

export default MembershipsPage;
