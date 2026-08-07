import { useEffect, useRef, useState } from 'react';
import { useSeo } from '@/hooks/useSeo';
import { Film, Loader2, Plus } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { EmptyState } from '@/components/EmptyState';
import { ReelPlayer } from '@/components/reels/ReelPlayer';
import { ReelComposer } from '@/components/reels/ReelComposer';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useReels } from '@/hooks/useReels';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useLocalStorage } from '@/hooks/useLocalStorage';

export function ReelsPage() {
  useSeo({
    title: 'Reels — Short videos on Nostr',
    description:
      'Short vertical videos published to Nostr as NIP-71 events. Watch, react, zap and post your own.',
    path: '/reels',
  });

  const { reels, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useReels();
  const { user } = useCurrentUser();

  const [composerOpen, setComposerOpen] = useState(false);
  // Muted by default, because browsers block autoplay with sound anyway
  const [muted, setMuted] = useLocalStorage<boolean>('nostr:reels-muted', true);
  const [activeId, setActiveId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Whichever reel occupies most of the viewport is the one that plays
  useEffect(() => {
    const root = containerRef.current;
    if (!root || !reels?.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

        const id = visible?.target.getAttribute('data-reel-id');
        if (id) setActiveId(id);
      },
      { root, threshold: [0.25, 0.6, 0.9] }
    );

    root
      .querySelectorAll('[data-reel-id]')
      .forEach((node) => observer.observe(node));

    return () => observer.disconnect();
  }, [reels]);

  // Load older reels as the end of the list approaches
  useEffect(() => {
    const node = sentinelRef.current;
    const root = containerRef.current;
    if (!node || !root || !hasNextPage || isFetchingNextPage) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) fetchNextPage();
      },
      { root, rootMargin: '400px' }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, reels]);

  const composeButton = user ? (
    <Button
      onClick={() => setComposerOpen(true)}
      className=""
      size="sm"
    >
      <Plus className="mr-1.5 h-4 w-4" />
      New reel
    </Button>
  ) : undefined;

  return (
    <Layout fullWidth>
      <div className="mx-auto flex w-full max-w-md flex-col gap-3">
        <div className="flex items-center justify-between">
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
              <Film className="h-4 w-4 text-primary" />
            </span>
            Reels
          </h1>
          {composeButton}
        </div>

        {isLoading ? (
          <Skeleton className="aspect-[9/16] w-full rounded-2xl" />
        ) : isError || !reels?.length ? (
          <EmptyState
            icon={Film}
            title="No reels found"
            description="Your relays haven't served any NIP-71 short videos yet. Try adding a relay that carries video, or post the first one."
            showRelaySelector
            action={composeButton}
          />
        ) : (
          <div
            ref={containerRef}
            className="h-[calc(100dvh-11rem)] snap-y snap-mandatory overflow-y-auto overscroll-contain rounded-2xl scrollbar-thin lg:h-[calc(100dvh-9rem)]"
          >
            {reels.map((reel) => (
              <div
                key={reel.id}
                data-reel-id={reel.id}
                className="h-full w-full snap-start snap-always py-1"
              >
                <ReelPlayer
                  event={reel}
                  isActive={activeId === reel.id}
                  muted={muted}
                  onToggleMute={() => setMuted(!muted)}
                />
              </div>
            ))}

            <div ref={sentinelRef} className="flex h-16 items-center justify-center">
              {isFetchingNextPage ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : !hasNextPage ? (
                <span className="text-xs text-muted-foreground">
                  You've reached the end.
                </span>
              ) : null}
            </div>
          </div>
        )}
      </div>

      <ReelComposer open={composerOpen} onOpenChange={setComposerOpen} />
    </Layout>
  );
}

export default ReelsPage;
