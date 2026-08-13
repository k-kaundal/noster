import { useState } from 'react';
import { Check, Clock, Loader2, Zap } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ZapDialog } from '@/components/ZapDialog';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useSubscription, useTiers } from '@/hooks/useSubscriptions';
import {
  describeCadence,
  describeStatus,
  needsRenewal,
  type Tier,
} from '@/lib/subscription';
import { cn } from '@/lib/utils';

/**
 * What a creator asks for, and where the reader stands on it.
 *
 * Subscribing is a zap to the tier, so the existing payment path does the
 * work — there is no separate flow to keep correct, and the receipt that
 * comes back is the subscription itself.
 *
 * Renders nothing when a creator offers nothing. An empty "Subscriptions"
 * heading on every profile in the network would be a promise the network has
 * not made.
 */
export function SubscriptionTiers({ pubkey }: { pubkey: string }) {
  const { tiers, isLoading } = useTiers(pubkey);
  const { user } = useCurrentUser();

  if (isLoading || !tiers.length) return null;

  const isSelf = user?.pubkey === pubkey;

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Support</h2>
        <p className="text-xs text-muted-foreground">
          {tiers.length === 1 ? '1 tier' : `${tiers.length} tiers`}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {tiers.map((tier) => (
          <TierCard key={tier.slug} tier={tier} isSelf={isSelf} />
        ))}
      </div>

      {/*
        Said once, plainly, rather than discovered when a month lapses.

        Nothing here can charge anybody: a browser cannot bill on a schedule
        and no wallet protocol offers a standing order. Calling this a
        subscription without saying so would be the lie.
      */}
      <p className="text-xs text-muted-foreground">
        Each payment covers one {describeCadence(tiers[0].cadence)}. Nothing
        renews on its own — you pay again when you choose to, and stopping is
        simply not paying again.
      </p>
    </section>
  );
}

function TierCard({ tier, isSelf }: { tier: Tier; isSelf: boolean }) {
  const { user } = useCurrentUser();
  const { status, isLoading } = useSubscription(tier);
  const [zapOpen, setZapOpen] = useState(false);

  const active = status.state === 'active';
  const renew = needsRenewal(status);

  return (
    <Card
      className={cn(
        'flex flex-col',
        active && 'border-success/40 bg-success/5'
      )}
    >
      <CardContent className="flex flex-1 flex-col gap-3 pt-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-semibold leading-snug">{tier.title}</h3>
            <p className="tabular text-sm text-zap">
              {tier.amount.toLocaleString()} sats
              <span className="text-muted-foreground">
                {' '}
                / {describeCadence(tier.cadence)}
              </span>
            </p>
          </div>

          {active && (
            <Badge variant="secondary" className="shrink-0 gap-1">
              <Check className="h-3 w-3" />
              Active
            </Badge>
          )}
        </div>

        {tier.description && (
          <p className="text-sm text-muted-foreground">{tier.description}</p>
        )}

        {tier.perks.length > 0 && (
          <ul className="space-y-1">
            {tier.perks.map((perk) => (
              <li key={perk} className="flex items-start gap-2 text-sm">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                <span className="text-muted-foreground">{perk}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-auto space-y-2 pt-1">
          {user && !isSelf && !isLoading && status.state !== 'none' && (
            <p
              className={cn(
                'flex items-center gap-1.5 text-xs',
                renew ? 'text-warning-strong' : 'text-success-strong'
              )}
            >
              <Clock className="h-3.5 w-3.5 shrink-0" />
              {describeStatus(status, tier.cadence)}
            </p>
          )}

          {isSelf ? (
            <p className="text-xs text-muted-foreground">Your tier.</p>
          ) : (
            <Button
              className="w-full"
              variant={active && !renew ? 'outline' : 'default'}
              onClick={() => setZapOpen(true)}
              disabled={!user}
            >
              {isLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Zap className="mr-2 h-4 w-4" />
              )}
              {status.state === 'active'
                ? renew
                  ? 'Renew early'
                  : 'Pay another ' + describeCadence(tier.cadence)
                : status.state === 'lapsed'
                  ? 'Renew'
                  : `Subscribe · ${tier.amount.toLocaleString()} sats`}
            </Button>
          )}

          {status.totalSats > 0 && (
            <p className="text-center text-[11px] text-muted-foreground">
              You have given {status.totalSats.toLocaleString()} sats to this
              tier.
            </p>
          )}
        </div>
      </CardContent>

      {/*
        The tier event is the zap target, so the receipt carries its
        coordinate — which is what makes the payment readable as a
        subscription later, by anybody.
      */}
      {zapOpen && (
        <ZapDialog
          target={tier.event}
          open={zapOpen}
          onOpenChange={setZapOpen}
        />
      )}
    </Card>
  );
}
