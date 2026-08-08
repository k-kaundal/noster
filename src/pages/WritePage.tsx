import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, FileText, ImagePlus, Loader2, Pencil, Send, X } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { LoginArea } from '@/components/auth/LoginArea';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Markdown } from '@/components/articles/Markdown';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useArticle } from '@/hooks/useArticles';
import { usePublishArticle } from '@/hooks/usePublishArticle';
import { useUploadFile } from '@/hooks/useUploadFile';
import { useToast } from '@/hooks/useToast';
import { useSeo } from '@/hooks/useSeo';
import {
  ARTICLE_DRAFT_KIND,
  parseHashtagInput,
  readingMinutes,
  slugify,
} from '@/lib/article';

/**
 * The article editor.
 *
 * Opened with `?slug=` it edits an existing article, which republishes under
 * the same address rather than creating a second copy. The slug itself is
 * generated once from the first title and then frozen — it is the article's
 * address, and changing it would orphan every link to the old one.
 */
export function WritePage() {
  useSeo({
    title: 'Write',
    description: 'Write and publish a long-form article on Nostr.',
    path: '/write',
    noindex: true,
  });

  const { user } = useCurrentUser();

  return (
    <Layout>
      <div className="space-y-5">
        <PageHeader
          icon={FileText}
          title="Write"
          description="Long-form, in Markdown. Published as NIP-23, so any Nostr reader can open it."
        />

        {user ? (
          <Editor />
        ) : (
          <EmptyState
            icon={FileText}
            title="Log in to write"
            description="Articles are signed with your Nostr key, so they follow you to any client."
            action={<LoginArea className="mx-auto max-w-60" />}
          />
        )}
      </div>
    </Layout>
  );
}

function Editor() {
  const { user } = useCurrentUser();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();

  const editingSlug = params.get('slug') || undefined;
  const { article, isLoading } = useArticle(user?.pubkey, editingSlug);
  const draftLookup = useArticle(user?.pubkey, editingSlug, ARTICLE_DRAFT_KIND);
  const existing = article ?? draftLookup.article;

  const { publish, isPublishing } = usePublishArticle();
  const { mutateAsync: uploadFile, isPending: isUploading } = useUploadFile();

  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [image, setImage] = useState('');
  const [content, setContent] = useState('');
  const [hashtags, setHashtags] = useState('');

  /** Frozen once set, because it is the article's address. */
  const [slug, setSlug] = useState(editingSlug ?? '');
  const [publishedAt, setPublishedAt] = useState<number | undefined>();

  const coverInput = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const loadedFor = useRef<string | undefined>(undefined);

  // Fill the form once the article being edited arrives, and only once —
  // refetches must not overwrite what is being typed
  useEffect(() => {
    if (!existing || loadedFor.current === existing.slug) return;

    loadedFor.current = existing.slug;
    setTitle(existing.title);
    setSummary(existing.summary);
    setImage(existing.image ?? '');
    setContent(existing.content);
    setHashtags(existing.hashtags.join(', '));
    setSlug(existing.slug);
    setPublishedAt(existing.publishedAt);
  }, [existing]);

  const uploadCover = async (file: File) => {
    try {
      const [[, url]] = await uploadFile(file);
      setImage(url);
      toast({ title: 'Cover uploaded' });
    } catch (error) {
      toast({
        title: 'Upload failed',
        description: (error as Error).message,
        variant: 'destructive',
      });
    }
  };

  /** Drops an uploaded image into the body at the cursor. */
  const insertImage = async (file: File) => {
    try {
      const [[, url]] = await uploadFile(file);
      const markdown = `\n![](${url})\n`;

      const textarea = bodyRef.current;
      const at = textarea?.selectionStart ?? content.length;

      setContent((current) => current.slice(0, at) + markdown + current.slice(at));
      toast({ title: 'Image added' });
    } catch (error) {
      toast({
        title: 'Upload failed',
        description: (error as Error).message,
        variant: 'destructive',
      });
    }
  };

  const save = async (asDraft: boolean) => {
    // Generated from the first title and then left alone, so editing the
    // title later never moves the article to a new address
    const identifier = slug || slugify(title);
    setSlug(identifier);

    const result = await publish({
      draft: {
        slug: identifier,
        title,
        summary,
        image: image || undefined,
        content,
        hashtags: parseHashtagInput(hashtags),
        publishedAt,
      },
      asDraft,
    });

    if (!asDraft) navigate(`/${result.naddr}`);
  };

  if (editingSlug && (isLoading || draftLookup.isLoading)) {
    return (
      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="h-8 w-2/3 animate-pulse rounded bg-muted" />
          <div className="h-40 animate-pulse rounded bg-muted" />
        </CardContent>
      </Card>
    );
  }

  const busy = isPublishing || isUploading;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-1.5">
            <Label htmlFor="article-title">Title</Label>
            <Input
              id="article-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="What are you writing about?"
              className="text-lg font-medium"
            />
            {slug && (
              <p className="text-xs text-muted-foreground">
                Address: <span className="font-mono">{slug}</span> — fixed, so
                links keep working when you edit the title.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="article-summary">Summary</Label>
            <Textarea
              id="article-summary"
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              placeholder="One or two lines, shown in feeds and previews."
              className="min-h-[64px] resize-none"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Cover image</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={image}
                onChange={(event) => setImage(event.target.value)}
                placeholder="https://…"
                className="min-w-[12rem] flex-1"
              />
              <input
                ref={coverInput}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void uploadCover(file);
                  event.target.value = '';
                }}
              />
              <Button
                type="button"
                variant="outline"
                disabled={isUploading}
                onClick={() => coverInput.current?.click()}
              >
                {isUploading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ImagePlus className="mr-2 h-4 w-4" />
                )}
                Upload
              </Button>
              {image && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setImage('')}
                  aria-label="Remove cover image"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
            {image && (
              <img
                src={image}
                alt=""
                className="mt-2 h-32 w-full rounded-lg border object-cover"
              />
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="article-tags">Topics</Label>
            <Input
              id="article-tags"
              value={hashtags}
              onChange={(event) => setHashtags(event.target.value)}
              placeholder="bitcoin, nostr, privacy"
            />
            <p className="text-xs text-muted-foreground">
              Up to ten, comma separated. These are what make it findable by
              topic rather than only by author.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <Tabs defaultValue="write">
          <div className="flex items-center justify-between gap-3 border-b px-4 py-2">
            <TabsList>
              <TabsTrigger value="write">
                <Pencil className="mr-1.5 h-3.5 w-3.5" />
                Write
              </TabsTrigger>
              <TabsTrigger value="preview">
                <Eye className="mr-1.5 h-3.5 w-3.5" />
                Preview
              </TabsTrigger>
            </TabsList>

            <span className="text-xs text-muted-foreground">
              {readingMinutes(content)} min read
            </span>
          </div>

          <TabsContent value="write" className="m-0">
            <BodyEditor
              ref={bodyRef}
              value={content}
              onChange={setContent}
              onInsertImage={insertImage}
              isUploading={isUploading}
            />
          </TabsContent>

          <TabsContent value="preview" className="m-0 p-5">
            {content.trim() ? (
              <Markdown source={content} />
            ) : (
              <p className="py-12 text-center text-sm text-muted-foreground">
                Nothing to preview yet.
              </p>
            )}
          </TabsContent>
        </Tabs>
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          variant="outline"
          disabled={busy || !title.trim() || !content.trim()}
          onClick={() => save(true)}
        >
          {isPublishing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save draft
        </Button>
        <Button
          disabled={busy || !title.trim() || !content.trim()}
          onClick={() => save(false)}
        >
          {isPublishing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Send className="mr-2 h-4 w-4" />
          )}
          {existing && !existing.isDraft ? 'Update' : 'Publish'}
        </Button>
      </div>
    </div>
  );
}

/** The body field, with a drop target so an image can be dragged straight in. */
const BodyEditor = ({
  ref,
  value,
  onChange,
  onInsertImage,
  isUploading,
}: {
  ref: React.RefObject<HTMLTextAreaElement>;
  value: string;
  onChange: (value: string) => void;
  onInsertImage: (file: File) => void;
  isUploading: boolean;
}) => {
  const [dragging, setDragging] = useState(false);

  return (
    <div
      className="relative"
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);

        const file = event.dataTransfer.files?.[0];
        if (file?.type.startsWith('image/')) onInsertImage(file);
      }}
    >
      <Textarea
        ref={ref}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={'Write in Markdown.\n\n## A heading\n\nA paragraph, with **bold** and a [link](https://example.com).'}
        className="min-h-[420px] resize-y rounded-none border-0 font-mono text-sm leading-relaxed focus-visible:ring-0"
      />

      {(dragging || isUploading) && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-background/80 text-sm font-medium">
          {isUploading ? 'Uploading…' : 'Drop an image to insert it'}
        </div>
      )}
    </div>
  );
};

export default WritePage;
