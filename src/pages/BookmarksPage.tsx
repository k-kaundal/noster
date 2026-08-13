import { useRouteSeo } from '@/hooks/useSeo';
import { Link } from 'react-router-dom';
import { Bookmark } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { PageHeader } from '@/components/PageHeader';
import { Post } from '@/components/Post';
import { PostSkeletonList } from '@/components/PostSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { LoginArea } from '@/components/auth/LoginArea';
import { useBookmarkedEvents } from '@/hooks/useBookmarks';
import { useCurrentUser } from '@/hooks/useCurrentUser';

export function BookmarksPage() {
  useRouteSeo('/bookmarks');

  const { user } = useCurrentUser();
  const { events, isLoading, isEmpty } = useBookmarkedEvents();

  return (
    <Layout>
      <div className="space-y-5">
        <PageHeader
          icon={Bookmark}
          title="Bookmarks"
          description="Saved to your Nostr account, so they follow you to any client."
        />

        {!user ? (
          <EmptyState
            icon={Bookmark}
            title="Log in to see your bookmarks"
            description="Bookmarks are published as a NIP-51 list on your account."
            action={<LoginArea className="mx-auto max-w-60" />}
          />
        ) : isLoading ? (
          <PostSkeletonList count={3} />
        ) : isEmpty || !events.length ? (
          <EmptyState
            icon={Bookmark}
            title="No bookmarks yet"
            description="Save a note from its overflow menu and it will show up here."
            action={
              <Button asChild variant="outline">
                <Link to="/">Browse the feed</Link>
              </Button>
            }
          />
        ) : (
          <div className="space-y-4">
            {events.map((event) => (
              <Post key={event.id} event={event} />
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}

export default BookmarksPage;
