import { useState } from 'react';
import { Ticket } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { TokenCard } from '@/components/wallet/TokenCard';
import { useSentTokens } from '@/hooks/useSentTokens';
import { useTokenBackup } from '@/hooks/useTokenBackup';
import { cn } from '@/lib/utils';

/**
 * Every token this wallet has cut.
 *
 * Open ones first, because those are the only ones with anything left to do:
 * money that has left the balance and is sitting in a string somebody may
 * never have opened. Claimed ones stay below as a record rather than being
 * cleared, since "did they get it" is asked long after the fact.
 */
export function SentTokens({ className }: { className?: string }) {
  const { tokens, isLoading, reclaim } = useSentTokens();
  const [showClaimed, setShowClaimed] = useState(false);

  /**
   * Anything this browser holds that the relays do not gets published once,
   * so tokens made before backups existed stop being stuck on one machine.
   */
  useTokenBackup();

  if (!isLoading && !tokens.length) return null;

  const open = tokens.filter((token) => token.state !== 'redeemed');
  const claimed = tokens.filter((token) => token.state === 'redeemed');

  const outstanding = open
    .filter((token) => token.state === 'unclaimed')
    .reduce((total, token) => total + token.amountSats, 0);

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-3 text-base">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <Ticket className="h-4 w-4 text-primary" />
          </div>
          Tokens you've made
          {outstanding > 0 && (
            <Badge variant="secondary" className="ml-auto font-normal">
              {outstanding.toLocaleString()} sats out there
            </Badge>
          )}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          A token is a bearer string — whoever holds it can claim it. These are
          saved to your relays, encrypted to your key, so they follow your
          account to any browser: send one again, or take it back if nobody
          claimed it.
        </p>
      </CardHeader>

      <CardContent className={cn('space-y-3')}>
        {isLoading ? (
          <>
            <Skeleton className="h-40 w-full rounded-xl" />
            <Skeleton className="h-40 w-full rounded-xl" />
          </>
        ) : (
          <>
            {open.map((token) => (
              <TokenCard key={token.id} sent={token} onReclaim={reclaim} />
            ))}

            {claimed.length > 0 && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  onClick={() => setShowClaimed((shown) => !shown)}
                >
                  {showClaimed ? 'Hide' : 'Show'} {claimed.length} claimed
                </Button>

                {showClaimed &&
                  claimed.map((token) => (
                    <TokenCard key={token.id} sent={token} />
                  ))}
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
