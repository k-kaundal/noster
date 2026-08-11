import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Store } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { RelaySelector } from '@/components/RelaySelector';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ListingCard } from '@/components/market/ListingCard';
import { ListingEditor } from '@/components/market/ListingEditor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useListings, useMyListings } from '@/hooks/useListings';
import { useSeo } from '@/hooks/useSeo';

/** NIP-99 classified listings, browsable. */
export function MarketPage() {
  useSeo({
    title: 'Market',
    description: 'Things for sale on Nostr.',
    path: '/market',
  });

  const { user } = useCurrentUser();
  const [params, setParams] = useSearchParams();
  const hashtag = params.get('t') || undefined;

  const [includeSold, setIncludeSold] = useState(false);
  const [composing, setComposing] = useState(false);

  const { listings, isLoading } = useListings({ hashtag, includeSold });
  const { listings: mine } = useMyListings();

  const drafts = mine.filter((listing) => listing.isInactive);

  return (
    <Layout>
      <PageHeader
        title="Market"
        description="Classified listings. Buyers and sellers arrange everything between themselves."
      />

      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          {hashtag && (
            <Badge
              variant="secondary"
              className="cursor-pointer gap-1"
              onClick={() => setParams({})}
            >
              #{hashtag} ✕
            </Badge>
          )}

          <div className="flex items-center gap-2">
            <Switch
              id="show-sold"
              checked={includeSold}
              onCheckedChange={setIncludeSold}
            />
            <Label htmlFor="show-sold" className="text-sm font-normal">
              Show sold
            </Label>
          </div>

          {user && (
            <Button
              size="sm"
              className="ml-auto gap-1.5"
              onClick={() => setComposing(true)}
            >
              <Plus className="h-4 w-4" />
              New listing
            </Button>
          )}
        </div>

        {/*
          Drafts belong to their author and nobody else, so they sit above the
          market rather than in it — a kind 30403 is not on sale.
        */}
        {drafts.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-medium text-muted-foreground">
              Your drafts
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {drafts.map((listing) => (
                <ListingCard key={listing.event.id} listing={listing} />
              ))}
            </div>
          </section>
        )}

        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((key) => (
              <Skeleton key={key} className="h-72 w-full rounded-lg" />
            ))}
          </div>
        ) : listings.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {listings.map((listing) => (
              <ListingCard key={listing.event.id} listing={listing} />
            ))}
          </div>
        ) : (
          <Card className="border-dashed">
            <CardContent className="px-8 py-12 text-center">
              <div className="mx-auto max-w-sm space-y-6">
                <EmptyState
                  icon={Store}
                  title="Nothing listed here"
                  description={
                    hashtag
                      ? `No listings tagged #${hashtag} on this relay.`
                      : 'No listings on this relay yet. Try another one?'
                  }
                />
                <RelaySelector className="w-full" />
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <ListingEditor open={composing} onOpenChange={setComposing} />
    </Layout>
  );
}

export default MarketPage;
