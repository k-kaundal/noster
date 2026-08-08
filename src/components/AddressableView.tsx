import { FileQuestion } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { PostSkeleton } from '@/components/PostSkeleton';
import { ArticleView } from '@/components/articles/ArticleView';
import { CommunityView } from '@/components/communities/CommunityView';
import { useArticle } from '@/hooks/useArticles';
import { useCommunity } from '@/hooks/useCommunities';
import { ARTICLE_DRAFT_KIND, ARTICLE_KIND } from '@/lib/article';
import { COMMUNITY_KIND } from '@/lib/community';
import { kindLabel } from '@/lib/eventKinds';

interface AddressableViewProps {
  kind: number;
  pubkey: string;
  identifier: string;
}

/**
 * Whatever an `naddr` points at.
 *
 * An addressable identifier carries its own kind, so the right view can be
 * chosen without fetching anything first — and a kind this app has no view for
 * can say so honestly instead of rendering an empty page.
 */
export function AddressableView({
  kind,
  pubkey,
  identifier,
}: AddressableViewProps) {
  if (kind === ARTICLE_KIND || kind === ARTICLE_DRAFT_KIND) {
    return <ArticleRoute kind={kind} pubkey={pubkey} identifier={identifier} />;
  }

  if (kind === COMMUNITY_KIND) {
    return <CommunityRoute pubkey={pubkey} identifier={identifier} />;
  }

  return (
    <EmptyState
      icon={FileQuestion}
      title={`No view for ${kindLabel(kind)}`}
      description="This app can't display this kind of event yet. Another Nostr client may be able to."
    />
  );
}

function ArticleRoute({ kind, pubkey, identifier }: AddressableViewProps) {
  const { article, isLoading } = useArticle(pubkey, identifier, kind);

  if (isLoading) return <PostSkeleton />;

  if (!article) {
    return (
      <EmptyState
        icon={FileQuestion}
        title="Article not found"
        description="It may have been removed, or it isn't on the relay you're connected to."
        showRelaySelector
      />
    );
  }

  return <ArticleView article={article} />;
}

function CommunityRoute({
  pubkey,
  identifier,
}: Omit<AddressableViewProps, 'kind'>) {
  const { community, isLoading } = useCommunity(pubkey, identifier);

  if (isLoading) return <PostSkeleton />;

  if (!community) {
    return (
      <EmptyState
        icon={FileQuestion}
        title="Community not found"
        description="It may have been removed, or it isn't on the relay you're connected to."
        showRelaySelector
      />
    );
  }

  return <CommunityView community={community} />;
}
