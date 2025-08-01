
import { useEvent } from '@/hooks/useEvent';
import { Post } from '@/components/Post';
import { ThreadContext } from '@/components/ThreadContext';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { MessageCircle } from 'lucide-react';

interface PostPageProps {
  eventId: string;
}

function PostSkeleton() {
  return (
    <Card className="mb-4">
      <CardContent className="p-6">
        <div className="flex items-start space-x-3">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="flex-1 space-y-3">
            <div className="space-y-1">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-24" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-4 w-3/5" />
            </div>
            <div className="flex space-x-8 pt-2">
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-8 w-16" />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function PostPage({ eventId }: PostPageProps) {
  const { data: event, isLoading, error } = useEvent(eventId);

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto">
        <PostSkeleton />
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="max-w-2xl mx-auto">
        <Card className="border-dashed">
          <CardContent className="py-12 px-8 text-center">
            <div className="max-w-sm mx-auto space-y-4">
              <MessageCircle className="h-12 w-12 mx-auto text-muted-foreground opacity-50" />
              <div>
                <h3 className="text-lg font-semibold mb-2">Post not found</h3>
                <p className="text-muted-foreground">
                  This post may have been deleted or is not available on the current relay.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <ThreadContext event={event} />
      <Post event={event} showReplies={true} />
    </div>
  );
}