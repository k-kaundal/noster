import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, PenSquare, Trash2 } from 'lucide-react';

import { Layout } from '@/components/Layout';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useMyDrafts } from '@/hooks/useArticles';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useSeo } from '@/hooks/useSeo';
import { useToast } from '@/hooks/useToast';
import { timeAgo } from '@/lib/time';
import type { Article } from '@/lib/article';

/**
 * Your unpublished writing.
 *
 * Drafts are NIP-37 wraps — encrypted to your own key, so only you can read
 * them. The page lists them newest first and lets you open one in the editor
 * or delete it. Deleting publishes an empty wrap at the same address, which
 * is the only way to make a relay stop holding it that does not depend on the
 * relay honouring a deletion request.
 */
export function DraftsPage() {
  useSeo({
    title: 'Drafts',
    description: 'Your unpublished articles, encrypted so only you can read them.',
    path: '/drafts',
  });

  const { user } = useCurrentUser();
  const { drafts, isLoading } = useMyDrafts();

  return (
    <Layout>
      <div className="space-y-6">
        <PageHeader
          icon={FileText}
          title="Drafts"
          description="Unpublished articles, encrypted so only you can read them."
          action={
            <Button asChild>
              <Link to="/write">
                <PenSquare className="mr-2 h-4 w-4" />
                New article
              </Link>
            </Button>
          }
        />

        {!user ? (
          <EmptyState
            icon={FileText}
            title="Log in to see drafts"
            description="Drafts are encrypted to your key, so only you can read them."
          />
        ) : isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Card key={index}>
                <CardContent className="space-y-2 pt-6">
                  <Skeleton className="h-5 w-48" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-24" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : !drafts.length ? (
          <EmptyState
            icon={FileText}
            title="No drafts"
            description="Start writing and save a draft to see it here."
            action={
              <Button asChild>
                <Link to="/write">Write something</Link>
              </Button>
            }
          />
        ) : (
          <div className="space-y-3">
            {drafts.map((draft) => (
              <DraftCard key={draft.slug} draft={draft} />
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}

function DraftCard({ draft }: { draft: Article }) {
  const { mutateAsync: publishEvent } = useNostrPublish();
  const { toast } = useToast();
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      // NIP-37 deletion: an empty wrap at the same address replaces the draft
      await publishEvent({
        kind: 31234,
        content: '',
        tags: [
          ['d', draft.slug],
          ['k', '30023'],
          ['expiration', String(Math.floor(Date.now() / 1000) + 90 * 86400)],
        ],
      });

      toast({
        title: 'Draft deleted',
        description: 'Relays that honour replacements will drop it.',
      });
    } catch (error) {
      toast({
        title: 'Could not delete',
        description:
          error instanceof Error ? error.message : 'Something went wrong.',
        variant: 'destructive',
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Card>
      <CardContent className="flex items-start gap-4 p-4">
        <div className="min-w-0 flex-1 space-y-1">
          <Link
            to={`/write?draft=${draft.slug}`}
            className="font-semibold leading-tight hover:underline"
          >
            {draft.title || 'Untitled'}
          </Link>

          {draft.summary && (
            <p className="line-clamp-2 text-sm text-muted-foreground">
              {draft.summary}
            </p>
          )}

          <p className="text-xs text-muted-foreground">
            Last saved {timeAgo(draft.updatedAt * 1000)}
          </p>
        </div>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="icon" disabled={deleting}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this draft?</AlertDialogTitle>
              <AlertDialogDescription>
                This publishes an empty draft at the same address, which asks
                relays to stop holding it. The request is advisory — a relay
                may keep serving it.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Delete'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}

export default DraftsPage;
