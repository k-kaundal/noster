import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Check,
  ExternalLink,
  Loader2,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react';
import { Layout } from '@/components/Layout';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { LoginArea } from '@/components/auth/LoginArea';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAppContext } from '@/hooks/useAppContext';
import { usePremium } from '@/hooks/usePremium';
import { useRelayInfo } from '@/hooks/useRelayInfo';
import { useSeo } from '@/hooks/useSeo';
import { HOUSE_RELAY } from '@/contexts/AppContext';
import { isFixedPrice, payLinkUrl, type PayLinkTerms } from '@/lib/premium';
import { relayDisplayName } from '@/lib/relay';

export function PremiumPage() {
  useSeo({
    title: 'Relay access',
    description:
      'Paid write access to the NostrFeed relay, monthly or lifetime.',
    path: '/premium',
  });

  const { user } = useCurrentUser();
  const { plans, terms, hasPurchase, buy, isBuying, canPay, balanceSats } =
    usePremium();

  return (
    <Layout>
      <div className="space-y-6">
        <PageHeader
          icon={Sparkles}
          title="Relay access"
          description="Paid write access to the NostrFeed relay. Reading is always free."
        />

        <RelayStatusCard />

        {!plans.length ? (
          <EmptyState
            icon={Sparkles}
            title="No plans configured"
            description="Set VITE_PREMIUM_MONTHLY_LINK and VITE_PREMIUM_LIFETIME_LINK to the pay link ids from LNbits."
          />
        ) : !user ? (
          <EmptyState
            icon={Sparkles}
            title="Log in to buy access"
            description="Access is tied to your Nostr key, so the relay knows which account paid."
            action={<LoginArea className="mx-auto max-w-60" />}
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {terms.map(({ plan, data, isLoading, error }) => (
              <PlanCard
                key={plan.id}
                name={plan.name}
                summary={plan.summary}
                recurring={plan.recurring}
                linkId={plan.linkId}
                terms={data}
                isLoading={isLoading}
                error={error}
                purchased={hasPurchase(plan.id)}
                canPay={canPay}
                balanceSats={balanceSats}
                isBuying={isBuying}
                onBuy={(amountSats) => buy({ planId: plan.id, amountSats })}
              />
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}

/**
 * What the relay itself says about access.
 *
 * This is the only trustworthy answer on the page. Everything else describes
 * what was paid; the relay decides what that bought, and its NIP-11 document
 * is where it says so.
 */
function RelayStatusCard() {
  const { config } = useAppContext();
  const relayUrl = config.relayUrl || HOUSE_RELAY;
  const { data: info, isLoading } = useRelayInfo(relayUrl);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4" />
          {relayDisplayName(relayUrl)}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-2 text-sm">
        {isLoading ? (
          <Skeleton className="h-4 w-56" />
        ) : (
          <>
            <p className="text-muted-foreground">
              {info?.limitation?.payment_required
                ? 'This relay requires payment to write. Reading stays open.'
                : info?.limitation?.restricted_writes
                  ? 'This relay restricts who can write to it.'
                  : 'This relay is not currently advertising paid writes.'}
            </p>

            <p className="text-xs text-muted-foreground">
              The relay decides who can post, not this page. Once your payment
              reaches it, writing starts working — nothing here unlocks it.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function PlanCard({
  name,
  summary,
  recurring,
  linkId,
  terms,
  isLoading,
  error,
  purchased,
  canPay,
  balanceSats,
  isBuying,
  onBuy,
}: {
  name: string;
  summary: string;
  recurring: boolean;
  linkId: string;
  terms?: PayLinkTerms;
  isLoading: boolean;
  error?: Error;
  purchased: boolean;
  canPay: boolean;
  balanceSats: number;
  isBuying: boolean;
  onBuy: (amountSats: number) => Promise<unknown>;
}) {
  // A link with a range lets the payer choose; a fixed price does not
  const fixed = terms ? isFixedPrice(terms) : true;
  const [amount, setAmount] = useState('');

  const chosen = Number(amount) || terms?.minSats || 0;
  const affordable = chosen <= balanceSats;

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-baseline justify-between gap-2 text-base">
          <span>{name}</span>
          {!recurring && (
            <span className="text-eyebrow shrink-0">One payment</span>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-3">
        <p className="text-sm text-muted-foreground">{summary}</p>

        {isLoading ? (
          <Skeleton className="h-8 w-24" />
        ) : error ? (
          <p className="text-sm text-destructive">
            Couldn't load the price: {error.message}
          </p>
        ) : (
          terms && (
            <p className="text-title tabular">
              {fixed
                ? `${terms.minSats.toLocaleString()} sats`
                : `${terms.minSats.toLocaleString()}–${terms.maxSats.toLocaleString()} sats`}
            </p>
          )
        )}

        {!fixed && terms && (
          <Input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder={`${terms.minSats}`}
            inputMode="numeric"
            aria-label="Amount in sats"
          />
        )}

        <div className="mt-auto space-y-2 pt-2">
          {purchased && (
            <p className="flex items-center gap-1.5 text-sm text-success">
              <Check className="h-4 w-4" />
              Paid from this account
            </p>
          )}

          <Button
            className="w-full"
            disabled={!canPay || isBuying || !terms || !affordable}
            onClick={() => onBuy(chosen)}
          >
            {isBuying ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Zap className="mr-2 h-4 w-4" />
            )}
            {purchased ? 'Pay again' : 'Pay from my wallet'}
          </Button>

          {!canPay ? (
            <p className="text-xs text-muted-foreground">
              <Link to="/settings" className="text-primary hover:underline">
                Connect your wallet
              </Link>{' '}
              to pay from your balance.
            </p>
          ) : (
            !affordable && (
              <p className="text-xs text-warning">
                You have {balanceSats.toLocaleString()} sats. Add more in{' '}
                <Link to="/settings" className="underline">
                  settings
                </Link>
                .
              </p>
            )
          )}

          <a
            href={payLinkUrl(linkId)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            Pay from another wallet
          </a>
        </div>
      </CardContent>
    </Card>
  );
}

export default PremiumPage;
