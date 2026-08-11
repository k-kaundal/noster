import {
  AlertTriangle,
  Copy,
  ExternalLink,
  Info,
  Landmark,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { QrCode } from '@/components/wallet/QrCode';
import { useCashuMint } from '@/hooks/useCashuMint';
import { useToast } from '@/hooks/useToast';
import { mintHost } from '@/lib/cashu';

/**
 * Who is holding the money.
 *
 * A mint is a custodian that never learns your name, which is a good trade
 * only if you know who it is. Its own `/v1/info` is the honest source for
 * that: the operator's name, contacts, version, whether it is currently taking
 * deposits, and any notice they have posted.
 */
export function MintInfoCard({ mintUrl }: { mintUrl?: string }) {
  const { mint, isLoading, error } = useCashuMint(mintUrl);
  const { toast } = useToast();
  const url = mintUrl ?? mint?.url ?? '';

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-3 text-base">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <Landmark className="h-4 w-4 text-primary" />
          </div>
          The mint
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : error || !mint ? (
          <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-destructive">
                Can't reach {mintHost(url)}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Ecash you already hold is unaffected — the proofs are in your
                browser, not at the mint. You just can't deposit or spend until
                it answers again.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-start gap-3">
              {mint.iconUrl ? (
                <img
                  src={mint.iconUrl}
                  alt=""
                  className="h-10 w-10 shrink-0 rounded-lg object-cover"
                  loading="lazy"
                />
              ) : null}

              <div className="min-w-0 flex-1">
                <p className="font-semibold leading-tight">{mint.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {mintHost(mint.url)}
                  {mint.version && ` · ${mint.version}`}
                </p>
              </div>
            </div>

            {mint.description && (
              <p className="text-sm leading-relaxed text-muted-foreground">
                {mint.description}
              </p>
            )}

            {/* Operators post downtime here. It is the one field worth
                interrupting someone about before they deposit */}
            {mint.motd && (
              <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <p className="text-xs leading-relaxed">{mint.motd}</p>
              </div>
            )}

            <div className="flex flex-wrap gap-1.5">
              <Badge variant={mint.canDeposit ? 'secondary' : 'destructive'}>
                {mint.canDeposit ? 'Deposits open' : 'Deposits closed'}
              </Badge>
              <Badge variant={mint.canWithdraw ? 'secondary' : 'destructive'}>
                {mint.canWithdraw ? 'Withdrawals open' : 'Withdrawals closed'}
              </Badge>
              {/* NUT-02: charged per proof spent, so it applies to sending
                  and paying rather than to sitting still. Said out loud
                  because a balance that shrinks for invisible reasons reads
                  as a broken wallet rather than as a fee. */}
              {mint.inputFeePpk > 0 && (
                <Badge variant="outline">
                  ~{mint.typicalFeeSats.toLocaleString()} sat fee per payment
                </Badge>
              )}
              {mint.deposit.minSats !== undefined && (
                <Badge variant="outline">
                  min {mint.deposit.minSats.toLocaleString()}
                </Badge>
              )}
              {mint.deposit.maxSats !== undefined && (
                <Badge variant="outline">
                  max {mint.deposit.maxSats.toLocaleString()}
                </Badge>
              )}
            </div>

            {mint.contact.length > 0 && (
              <dl className="space-y-1 text-xs">
                {mint.contact.map((entry) => (
                  <div key={`${entry.method}:${entry.info}`} className="flex gap-2">
                    <dt className="w-16 shrink-0 capitalize text-muted-foreground">
                      {entry.method}
                    </dt>
                    <dd className="min-w-0 flex-1 truncate font-mono">
                      {entry.info}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </>
        )}

        {/* The URL is what another wallet needs to be pointed at this mint,
            which is the whole promise of ecash: the balance is not locked to
            this app */}
        <div className="space-y-2 rounded-lg bg-muted/50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Use it from any Cashu wallet
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-1.5 font-mono text-xs">
              {url}
            </code>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0"
              onClick={async () => {
                await navigator.clipboard.writeText(url);
                toast({ title: 'Mint URL copied' });
              }}
              aria-label="Copy mint URL"
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>

          <QrCode
            value={url}
            label={`QR code for the mint at ${mintHost(url)}`}
            size={148}
          />

          <Button variant="ghost" size="sm" className="w-full" asChild>
            <a href={`${url}/v1/info`} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="mr-2 h-3.5 w-3.5" />
              What the mint reports
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
