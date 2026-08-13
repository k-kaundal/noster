import { useMemo, useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { RelaySelector } from '@/components/RelaySelector';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { OrderCard } from '@/components/p2p/OrderCard';
import { useP2POrders } from '@/hooks/useP2POrders';
import { useRouteSeo } from '@/hooks/useSeo';
import { applyFilters, currenciesIn, type OrderSide } from '@/lib/nip69';

/** NIP-69: the pooled p2p order book. */
export function P2PPage() {
  useRouteSeo('/p2p');

  const { orders, isLoading } = useP2POrders();

  const [side, setSide] = useState<OrderSide | 'all'>('all');
  const [currency, setCurrency] = useState('all');
  const [openOnly, setOpenOnly] = useState(true);

  const currencies = useMemo(() => currenciesIn(orders), [orders]);

  const shown = useMemo(
    () =>
      applyFilters(orders, {
        side: side === 'all' ? undefined : side,
        currency: currency === 'all' ? undefined : currency,
        openOnly,
      }),
    [orders, side, currency, openOnly]
  );

  return (
    <Layout>
      <PageHeader
        title="P2P orders"
        description="Buy and sell offers published by peer-to-peer platforms across Nostr."
      />

      <div className="space-y-5">
        {/*
          Said before the prices, not after. A grid of offers looks like an
          exchange, and this app has no part in any trade on it — every order
          is taken on the platform that published it.
        */}
        <Card className="border-dashed">
          <CardContent className="pt-6 text-sm text-muted-foreground">
            This is a shared view of other platforms' order books. Nothing here
            holds funds, matches trades or vouches for anyone — you take an
            order on the platform that published it, under their rules, and any
            escrow or dispute process is theirs.
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="p2p-side">Direction</Label>
            <Select
              value={side}
              onValueChange={(value) => setSide(value as OrderSide | 'all')}
            >
              <SelectTrigger id="p2p-side" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Everything</SelectItem>
                <SelectItem value="sell">Selling bitcoin</SelectItem>
                <SelectItem value="buy">Buying bitcoin</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="p2p-currency">Currency</Label>
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger id="p2p-currency" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any</SelectItem>
                {currencies.map((code) => (
                  <SelectItem key={code} value={code}>
                    {code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2 pb-2">
            <Switch
              id="p2p-open"
              checked={openOnly}
              onCheckedChange={setOpenOnly}
            />
            <Label htmlFor="p2p-open" className="text-sm font-normal">
              Only open orders
            </Label>
          </div>
        </div>

        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {[0, 1, 2, 3].map((key) => (
              <Skeleton key={key} className="h-64 w-full rounded-lg" />
            ))}
          </div>
        ) : shown.length ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {shown.map((order) => (
              <OrderCard key={order.event.id} order={order} />
            ))}
          </div>
        ) : (
          <Card className="border-dashed">
            <CardContent className="px-8 py-12 text-center">
              <div className="mx-auto max-w-sm space-y-6">
                <EmptyState
                  icon={ArrowLeftRight}
                  title="No orders here"
                  description={
                    orders.length
                      ? 'Nothing matches those filters.'
                      : 'This relay carries no p2p orders. The platforms publishing them use their own relays.'
                  }
                />
                {orders.length > 0 ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSide('all');
                      setCurrency('all');
                      setOpenOnly(false);
                    }}
                  >
                    Clear filters
                  </Button>
                ) : (
                  <RelaySelector className="w-full" />
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}

export default P2PPage;
