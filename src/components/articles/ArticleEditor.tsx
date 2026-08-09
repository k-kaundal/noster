import { useState, useCallback } from 'react';
import { Loader2, X } from 'lucide-react';
import type { Article } from '@/lib/article';
import { buildArticleTags, type ArticleDraft } from '@/lib/article';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

interface ArticleEditorProps {
  article: Article;
  onClose: () => void;
  onSave?: () => void;
}

/**
 * Editor for article metadata (title, summary, image, hashtags)
 * Only accessible to article author
 */
export function ArticleEditor({ article, onClose, onSave }: ArticleEditorProps) {
  const [draft, setDraft] = useState<ArticleDraft>({
    slug: article.slug,
    title: article.title,
    summary: article.summary,
    image: article.image,
    content: article.content,
    hashtags: article.hashtags,
    publishedAt: article.publishedAt,
  });

  const [isPublishing, setIsPublishing] = useState(false);
  const { mutateAsync: publishEvent } = useNostrPublish();
  const { toast } = useToast();

  const handlePublish = useCallback(async () => {
    if (!draft.title.trim()) {
      toast({
        title: 'Error',
        description: 'Article title is required',
        variant: 'destructive',
      });
      return;
    }

    try {
      setIsPublishing(true);
      const tags = buildArticleTags(draft);

      await publishEvent({
        kind: article.event.kind,
        content: draft.content,
        tags,
      });

      toast({
        title: 'Success',
        description: 'Article updated',
      });

      onSave?.();
      onClose();
    } catch {
      toast({
        title: 'Error',
        description: 'Failed to update article',
        variant: 'destructive',
      });
    } finally {
      setIsPublishing(false);
    }
  }, [draft, article.event.kind, publishEvent, toast, onClose, onSave]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <CardHeader className="sticky top-0 bg-background border-b flex items-center justify-between">
          <CardTitle>Edit Article</CardTitle>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </CardHeader>

        <CardContent className="space-y-6 pt-6">
          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={draft.title}
              onChange={(e) => setDraft(prev => ({ ...prev, title: e.target.value }))}
              placeholder="Article title"
            />
          </div>

          {/* Summary */}
          <div className="space-y-2">
            <Label htmlFor="summary">Summary</Label>
            <Textarea
              id="summary"
              value={draft.summary}
              onChange={(e) => setDraft(prev => ({ ...prev, summary: e.target.value }))}
              placeholder="Brief summary of the article..."
              className="min-h-20"
            />
          </div>

          {/* Image */}
          <div className="space-y-2">
            <Label htmlFor="image">Featured Image URL</Label>
            <Input
              id="image"
              value={draft.image || ''}
              onChange={(e) => setDraft(prev => ({ ...prev, image: e.target.value }))}
              placeholder="https://example.com/image.jpg"
              type="url"
            />
            {draft.image && (
              <img
                src={draft.image}
                alt="Preview"
                className="h-32 w-full object-cover rounded-lg"
              />
            )}
          </div>

          {/* Hashtags */}
          <div className="space-y-2">
            <Label htmlFor="hashtags">Hashtags</Label>
            <Input
              id="hashtags"
              value={draft.hashtags.join(', ')}
              onChange={(e) => {
                const tags = e.target.value
                  .split(',')
                  .map(t => t.trim().replace(/^#+/, '').toLowerCase())
                  .filter(Boolean);
                setDraft(prev => ({ ...prev, hashtags: tags }));
              }}
              placeholder="tag1, tag2, tag3"
            />
            <p className="text-xs text-muted-foreground">
              Separate with commas. Up to 10 tags will be saved.
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4 border-t">
            <Button
              onClick={handlePublish}
              disabled={isPublishing}
              className="flex-1"
            >
              {isPublishing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Publishing...
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
            <Button
              onClick={onClose}
              variant="outline"
              disabled={isPublishing}
              className="flex-1"
            >
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
