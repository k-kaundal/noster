import { useEvent } from '@/hooks/useEvent';
import { Post } from '@/components/Post';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowUp, MessageCircle } from 'lucide-react';
import type { NostrEvent } from '@nostrify/nostrify';

interface ThreadContextProps {
  event: NostrEvent;
}

function ThreadSkeleton() {
  return (
    <div className="mb-4">
      <div className="flex items-center text-sm text-muted-foreground mb-2">
        <ArrowUp className="h-4 w-4 mr-1" />
        <span>Replying to</span>
      </div>
      <Card className="border-l-4 border-l-blue-500 bg-muted/30">
        <CardContent className="p-4">
          <div className="flex items-start space-x-3">
            <Skeleton className="h-8 w-8 rounded-full" />
            <div className="flex-1 space-y-2">
              <div className="space-y-1">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-16" />
              </div>
              <div className="space-y-1">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-3/4" />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function ThreadContext({ event }: ThreadContextProps) {
  // Find the parent event ID from e tags
  const eTags = event.tags.filter(tag => tag[0] === 'e');
  
  // Get the parent event ID (last e tag according to NIP-10)
  const parentEventId = eTags.length > 0 ? eTags[eTags.length - 1][1] : null;
  
  const { data: parentEvent, isLoading } = useEvent(parentEventId || '');

  // Don't show context if this isn't a reply
  if (!parentEventId) {
    return null;
  }

  if (isLoading) {
    return <ThreadSkeleton />;
  }

  if (!parentEvent) {
    return (
      <div className="mb-4">
        <div className="flex items-center text-sm text-muted-foreground mb-2">
          <ArrowUp className="h-4 w-4 mr-1" />
          <span>Replying to</span>
        </div>
        <Card className="border-l-4 border-l-blue-500 bg-muted/30">
          <CardContent className="py-8 px-4 text-center">
            <MessageCircle className="h-8 w-8 mx-auto mb-2 text-muted-foreground opacity-50" />
            <p className="text-sm text-muted-foreground">
              Original post not found
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mb-4">
      <div className="flex items-center text-sm text-muted-foreground mb-2">
        <ArrowUp className="h-4 w-4 mr-1" />
        <span>Replying to</span>
      </div>
      <div className="border-l-4 border-l-blue-500 bg-muted/30 rounded-lg">
        <Post event={parentEvent} showReplies={false} />
      </div>
    </div>
  );
}