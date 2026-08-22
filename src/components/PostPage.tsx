import { MessageCircle } from 'lucide-react';
import { useEvent } from '@/hooks/useEvent';
import { ThreadView } from '@/components/thread/ThreadView';
import { PostSkeleton } from '@/components/PostSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { useSeo } from '@/hooks/useSeo';
import { notePostingSchema } from '@/lib/structuredData';
import { useAuthor } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';
import { getTagValue } from '@/lib/note';
import { nip19 } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';

interface PostPageProps {
  eventId: string;
}

export function PostPage({ eventId }: PostPageProps) {
  // `null` is the batch loader's "no relay had it", which reads the same as
  // absent to everything below
  const { data, isLoading, error } = useEvent(eventId);
  const event = data ?? undefined;

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

  const note = nip19.noteEncode(event.id);

  useSeo({
    title: `${displayName} on Nostr`,
    description: summary,
    image: metadata?.picture,
    path: `/${note}`,
    type: 'article',
    publishedTime: new Date(event.created_at * 1000).toISOString(),
    author: displayName,
    // The note itself, for anyone arriving at the HTML rendering of it
    nostrEntity: note,
    nostrAuthor: nip19.npubEncode(event.pubkey),
    // A short post, not an article: describing a sentence as a piece of
    // writing produces a search result that promises more than it delivers
    structuredData: notePostingSchema({
      identifier: note,
      text: event.content,
      publishedAt: event.created_at,
      author: {
        name: displayName,
        npub: nip19.npubEncode(event.pubkey),
        image: metadata?.picture,
        nip05: metadata?.nip05,
      },
    }),
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

  return <ThreadView event={event} />;
}
