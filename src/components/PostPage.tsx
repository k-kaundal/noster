import { MessageCircle } from 'lucide-react';
import { useEvent } from '@/hooks/useEvent';
import { Post } from '@/components/Post';
import { ThreadContext } from '@/components/ThreadContext';
import { RepliesSection } from '@/components/RepliesSection';
import { PostSkeleton } from '@/components/PostSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { Card } from '@/components/ui/card';

interface PostPageProps {
  eventId: string;
}

export function PostPage({ eventId }: PostPageProps) {
  const { data: event, isLoading, error } = useEvent(eventId);

  if (isLoading) {
    return <PostSkeleton />;
  }

  if (error || !event) {
    return (
      <EmptyState
        icon={MessageCircle}
        title="Note not found"
        description="It may have been deleted, or it isn't stored on the relay you're connected to."
        showRelaySelector
      />
    );
  }

  return (
    <div className="space-y-4">
      <ThreadContext event={event} />

      <Post event={event} showReplies={false} />

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Replies
        </h2>
        <RepliesSection eventId={event.id} />
      </Card>
    </div>
  );
}
