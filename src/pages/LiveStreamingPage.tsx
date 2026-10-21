import { Radio } from 'lucide-react';

import { Layout } from '@/components/Layout';
import { PageHeader } from '@/components/PageHeader';
import { RelaySelector } from '@/components/RelaySelector';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useLiveEvents } from '@/hooks/useLiveEvents';
import { useRouteSeo } from '@/hooks/useSeo';
import { type LiveEvent } from '@/lib/nip53';
import { StreamCard } from '@/components/live';

/**
 * Live activities, from NIP-53.
 *
 * This page used to render a hardcoded list of streams that did not exist,
 * with invented viewer counts. It reads kind 30311 now: an activity is an
 * event a host publishes describing a stream, and the video comes from
 * whatever `streaming` URL they put in it.
 *
 * That is the reason a page like this can exist here at all — hosting video is
 * somebody else's problem, and announcing it is a Nostr event like any other.
 */
export function LiveStreamingPage() {
  useRouteSeo('/live');

  const { live, upcoming, past, isLoading } = useLiveEvents();

  const nothing = !isLoading && !live.length && !upcoming.length && !past.length;

  return (
    <Layout>
      <div className="space-y-6">
        <PageHeader
          icon={Radio}
          title="Live"
          description="Streams announced on Nostr. Anyone can host one; the video comes from wherever the host put it."
        />

        {isLoading && (
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-40 rounded-xl" />
            ))}
          </div>
        )}

        {nothing && (
          <Card className="border-dashed">
            <CardContent className="px-8 py-12 text-center">
              <div className="mx-auto max-w-sm space-y-6">
                <p className="text-muted-foreground">
                  Nobody is streaming on these relays. Try another?
                </p>
                <RelaySelector className="w-full" />
              </div>
            </CardContent>
          </Card>
        )}

        <Shelf title="Live now" items={live} />
        <Shelf title="Upcoming" items={upcoming} />
        <Shelf title="Finished" items={past} />
      </div>
    </Layout>
  );
}

function Shelf({ title, items }: { title: string; items: LiveEvent[] }) {
  if (!items.length) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground/70">
          {items.length}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <StreamCard key={item.address} live={item} />
        ))}
      </div>
    </section>
  );
}

export default LiveStreamingPage;
