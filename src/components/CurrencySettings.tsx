import { Banknote, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useCurrencyList, useFiat } from '@/hooks/useFiat';
import {
  HIDE_FIAT,
  currencyLabel,
  formatBtcPrice,
  formatFiat,
  satsToFiat,
} from '@/lib/currency';

/**
 * Picking the money the rest of the app quotes prices in.
 *
 * The live price sits directly under the picker rather than on a separate
 * screen, because it is how somebody checks the setting did what they wanted:
 * choose rupees, see a rupee figure, done. It doubles as the answer to "what
 * is bitcoin worth right now", which is the other reason to open this.
 */
export function CurrencySettings() {
  const { currency, setCurrency, rate, stale, isLoading, isError, refetch } =
    useFiat();
  const { common, rest } = useCurrencyList(currency);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Banknote className="h-4 w-4" />
          Currency
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="currency">Show sats amounts in</Label>

          <Select value={currency} onValueChange={setCurrency}>
            <SelectTrigger id="currency">
              <SelectValue />
            </SelectTrigger>

            <SelectContent className="max-h-72">
              <SelectItem value={HIDE_FIAT}>
                Sats only — no fiat anywhere
              </SelectItem>

              <SelectSeparator />

              <SelectGroup>
                <SelectLabel>Common</SelectLabel>
                {common.map((code) => (
                  <SelectItem key={code} value={code}>
                    {currencyLabel(code)}
                  </SelectItem>
                ))}
              </SelectGroup>

              {/*
                The full list runs to well over a hundred codes, so it goes
                below a heading rather than mixed in — otherwise the twenty
                currencies almost everyone wants are buried alphabetically
                among AFN and XPF.
              */}
              {rest.length > 0 && (
                <SelectGroup>
                  <SelectLabel>All currencies</SelectLabel>
                  {rest.map((code) => (
                    <SelectItem key={code} value={code}>
                      {currencyLabel(code)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
            </SelectContent>
          </Select>

          <p className="text-xs text-muted-foreground">
            Kept on this device. Amounts are still sent and received in sats —
            this only changes what you are shown beside them.
          </p>
        </div>

        {currency !== HIDE_FIAT && (
          <div className="rounded-lg border bg-muted/40 p-3">
            {isLoading && <Skeleton className="h-10 w-full" />}

            {!isLoading && rate && (
              <div className="space-y-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm text-muted-foreground">1 BTC</span>
                  <span className="text-lg font-semibold tabular-nums">
                    {formatBtcPrice(rate)}
                  </span>
                </div>

                {/*
                  A hundred sats is the unit that makes the price legible at
                  human scale — the number people are actually looking at is a
                  zap or a tip, not a whole coin.
                */}
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">100 sats</span>
                  <span className="tabular-nums">
                    {formatFiat(satsToFiat(100, rate), rate.currency)}
                  </span>
                </div>

                {stale && (
                  <p className="pt-1 text-xs text-muted-foreground">
                    This price has not refreshed in a while — it may have moved.
                  </p>
                )}
              </div>
            )}

            {!isLoading && !rate && (
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  {isError
                    ? 'Could not reach the price service.'
                    : `No price available for ${currency}.`}
                </p>
                <Button variant="outline" size="sm" onClick={() => refetch()}>
                  <RefreshCw className="mr-2 h-3.5 w-3.5" />
                  Retry
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
