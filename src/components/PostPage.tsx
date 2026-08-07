import { MessageCircle } from 'lucide-react';
import { useEvent } from '@/hooks/useEvent';
import { Post } from '@/components/Post';
import { ThreadContext } from '@/components/ThreadContext';
import { RepliesSection } from '@/components/RepliesSection';
import { PostSkeleton } from '@/components/PostSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { Card } from '@/components/ui/card';
import { useSeo } from '@/hooks/useSeo';
import { useAuthor } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';
import { getTagValue } from '@/lib/note';
import { nip19 } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';

interface PostPageProps {
  eventId: string;
}

export function PostPage({ eventId }: PostPageProps) {
  const { data: event, isLoading, error } = useEvent(eventId);

  return (
    <>
      {event && <NoteSeo event={event} />}
      <PostPageBody event={event} isLoading={isLoading} isError={!!error} />
    </>
  );
}

/**
 * Metadata for a single note. Lives in its own component so the author lookup
 * only runs once the note itself has resolved.
 */
function NoteSeo({ event }: { event: NostrEvent }) {
  const author = useAuthor(event.pubkey);
  const metadata = author.data?.metadata;
  const displayName =
    metadata?.display_name || metadata?.name || genUserName(event.pubkey);

  const summary =
    event.content.trim().slice(0, 200) ||
    getTagValue(event, 'alt') ||
    `A note by ${displayName} on Nostr.`;

  useSeo({
    title: `${displayName} on Nostr`,
    description: summary,
    image: metadata?.picture,
    path: `/${nip19.noteEncode(event.id)}`,
    type: 'article',
    publishedTime: new Date(event.created_at * 1000).toISOString(),
    author: displayName,
  });

  return null;
}

function PostPageBody({
  event,
  isLoading,
  isError,
}: {
  event?: NostrEvent;
  isLoading: boolean;
  isError: boolean;
}) {
  if (isLoading) {
    return <PostSkeleton />;
  }

  if (isError || !event) {
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
