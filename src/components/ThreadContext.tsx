import { CornerUpLeft, MessageCircle } from 'lucide-react';
import type { NostrEvent } from '@nostrify/nostrify';
import { useEvent } from '@/hooks/useEvent';
import { Post } from '@/components/Post';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

interface ThreadContextProps {
  event: NostrEvent;
}

function Heading() {
  return (
    <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
      <CornerUpLeft className="h-3.5 w-3.5" />
      Replying to
    </div>
  );
}

/** Shows the parent note above a reply, so a thread reads top-down. */
export function ThreadContext({ event }: ThreadContextProps) {
  const eTags = event.tags.filter(([name]) => name === 'e');
  // NIP-10 puts the direct parent last when positional markers are absent
  const parentEventId = eTags.length > 0 ? eTags[eTags.length - 1][1] : null;

  const { data: parentEvent, isLoading } = useEvent(parentEventId || '');

  if (!parentEventId) return null;

  return (
    <div className="space-y-2">
      <Heading />

      {isLoading ? (
        <Card className="border-l-4 border-l-primary">
          <CardContent className="flex gap-3 p-4">
            <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          </CardContent>
        </Card>
      ) : !parentEvent ? (
        <Card className="border-l-4 border-l-primary border-dashed">
          <CardContent className="px-4 py-8 text-center">
            <MessageCircle className="mx-auto mb-2 h-7 w-7 text-muted-foreground opacity-60" />
            <p className="text-sm text-muted-foreground">
              The original note isn't available on this relay.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden border-l-4 border-l-primary bg-muted/30">
          <Post event={parentEvent} showReplies={false} embedded />
        </Card>
      )}
    </div>
  );
}
