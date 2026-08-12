import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  BadgeCheck,
  Eye,
  FileText,
  ImagePlus,
  Loader2,
  Pencil,
  Send,
  X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { LoginArea } from '@/components/auth/LoginArea';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Markdown } from '@/components/articles/Markdown';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useIdentity } from '@/hooks/useIdentity';
import { useArticle, useMyDrafts } from '@/hooks/useArticles';
import { usePublishArticle } from '@/hooks/usePublishArticle';
import { useUploadFile } from '@/hooks/useUploadFile';
import { useToast } from '@/hooks/useToast';
import { useSeo } from '@/hooks/useSeo';
import { MarkdownToolbar } from '@/components/articles/MarkdownToolbar';
import {
  parseHashtagInput,
  readingMinutes,
  slugify,
} from '@/lib/article';
import {
  applyAction,
  wordCount,
  type MarkdownAction,
} from '@/lib/markdownEdit';
import { useAccountStored } from '@/hooks/useStore';

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

        {!user ? (
          <EmptyState
            icon={FileText}
            title="Log in to write"
            description="Articles are signed with your Nostr key, so they follow you to any client."
            action={<LoginArea className="mx-auto max-w-60" />}
          />
        ) : (
          <WriterGate />
        )}
      </div>
    </Layout>
  );
}

/**
 * Who gets to publish an article here.
 *
 * Long-form is reserved for people holding a verified name — the paid,
 * expiring NIP-05 identity, not the free lightning address. Articles carry
 * more weight than notes and stay addressable forever, and a name someone paid
 * for is the cheapest honest signal that there is a person behind one.
 *
 * The gate only applies where names are actually for sale. On a deployment
 * with no `nostrnip5` domain configured, nobody could ever pass it, so
 * everyone writes — a feature nobody can reach is worse than an ungated one.
 */
function WriterGate() {
  const identity = useIdentity();

  const forSale = identity.nip5.isConfigured && !identity.nip5.isUnavailable;

  if (forSale && identity.isLoading) {
    return (
      <Card>
        <CardContent className="space-y-3 pt-6">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (forSale && identity.status.tier !== 'verified') {
    return (
      <EmptyState
        icon={BadgeCheck}
        title="Articles need a verified name"
        description={
          identity.nip5.address
            ? "Your name is reserved but not live yet — it starts working once the invoice settles."
            : `Reserve a name on ${identity.nip5.domain} and long-form publishing opens up. Notes, replies and everything else stay free.`
        }
        action={
          <Button asChild>
            <Link to="/wallet">
              <BadgeCheck className="mr-2 h-4 w-4" />
              {identity.nip5.address ? 'Finish setting it up' : 'Get a verified name'}
            </Link>
          </Button>
        }
      />
    );
  }

  return <Editor />;
}

/** An article kept on this device while it is being written. */
interface LocalDraft {
  title: string;
  summary: string;
  image: string;
  content: string;
  hashtags: string;
  savedAt: number;
}

function Editor() {
  const { user } = useCurrentUser();
  const [params] = useSearchParams();
  const location = useLocation();

  /**
   * Text handed over from the note composer.
   *
   * Arrives in router state rather than the URL, so a half-written article
   * does not end up in the address bar, the history, or a shared link.
   */
  const handedOver =
    typeof (location.state as { body?: unknown } | null)?.body === 'string'
      ? ((location.state as { body: string }).body)
      : undefined;

  const navigate = useNavigate();
  const { toast } = useToast();

  const editingSlug = params.get('slug') || undefined;
  const { article, isLoading } = useArticle(user?.pubkey, editingSlug);

  /**
   * Drafts are looked up through the drafts list rather than by address.
   *
   * A NIP-37 draft is an encrypted wrap, so there is nothing to find by
   * asking a relay for `30024:<pubkey>:<slug>` — the content has to be
   * decrypted before the slug inside it is even visible. `useMyDrafts` is
   * where that happens, and it is already loaded.
   */
  const { drafts, isLoading: draftsLoading } = useMyDrafts();
  const draftLookup = editingSlug
    ? drafts.find((entry) => entry.slug === editingSlug)
    : undefined;

  const existing = article ?? draftLookup;

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

  /**
   * The article as it stands on this device, saved as it is typed.
   *
   * "Save draft" publishes kind 30024 to relays, which is the right thing for
   * a draft you intend to come back to — and useless for the far more common
   * loss, which is a closed tab, a crashed browser or a followed link two
   * paragraphs in. Nothing here leaves the machine.
   *
   * Keyed per article so working on two does not have them overwrite each
   * other, and per account so a shared browser does not hand one person's
   * unfinished writing to the next.
   */
  const [localDraft, setLocalDraft] = useAccountStored<LocalDraft | null>(
    `article-draft:${editingSlug ?? 'new'}`,
    null
  );

  const [restored, setRestored] = useState(false);
  const dismissedRestore = useRef(false);

  /**
   * Fills the body from the composer, once.
   *
   * Guarded on the ref rather than on `content` being empty: without that,
   * clearing the box to start again would immediately paste the handed-over
   * text back in.
   */
  const seeded = useRef(false);

  useEffect(() => {
    if (seeded.current || !handedOver || editingSlug) return;

    seeded.current = true;
    setContent(handedOver);

    /**
     * Dropped from history so a refresh or a back-and-forward does not
     * re-seed an article the author has since rewritten.
     */
    navigate(location.pathname, { replace: true, state: null });
  }, [handedOver, editingSlug, navigate, location.pathname]);

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

  /**
   * Written on a timer rather than on every keystroke.
   *
   * Serialising and storing on each character is work the main thread is
   * doing instead of showing the next one, and a second of lost typing is not
   * the failure this is here to prevent.
   */
  useEffect(() => {
    if (loadedFor.current === undefined && !title && !content) return;

    const timer = setTimeout(() => {
      setLocalDraft({
        title,
        summary,
        image,
        content,
        hashtags,
        savedAt: Date.now(),
      });
    }, 1000);

    return () => clearTimeout(timer);
  }, [title, summary, image, content, hashtags, setLocalDraft]);

  /**
   * Warns before leaving with unsaved work.
   *
   * Only for the tab closing — in-app navigation keeps the local draft, so
   * there is nothing to warn about there.
   */
  useEffect(() => {
    const dirty = !!title.trim() || !!content.trim();
    if (!dirty) return;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [title, content]);

  const hasRecoverableDraft =
    !!localDraft &&
    !dismissedRestore.current &&
    !restored &&
    !title.trim() &&
    !content.trim() &&
    (!!localDraft.title?.trim() || !!localDraft.content?.trim());

  const restore = () => {
    if (!localDraft) return;

    setTitle(localDraft.title ?? '');
    setSummary(localDraft.summary ?? '');
    setImage(localDraft.image ?? '');
    setContent(localDraft.content ?? '');
    setHashtags(localDraft.hashtags ?? '');
    setRestored(true);
  };

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

    // Published or saved to relays, so the local copy has done its job
    setLocalDraft(null);

    if (!asDraft) navigate(`/${result.naddr}`);
  };

  if (editingSlug && (isLoading || draftsLoading)) {
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
      {/*
        Saved drafts, listed where someone would look for them.

        Saving one used to publish an event with nothing anywhere that could
        reopen it — the address existed, and no screen in the app led to it.
        A draft you cannot get back to is worse than no draft, because it
        looks like it worked.
      */}
      {!editingSlug && drafts.length > 0 && (
        <Card>
          <CardContent className="space-y-2 pt-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Your drafts
            </p>
            <ul className="divide-y">
              {drafts.map((entry) => (
                <li key={entry.slug} className="flex items-center gap-2 py-2">
                  <button
                    type="button"
                    onClick={() => navigate(`/write?slug=${encodeURIComponent(entry.slug)}`)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block truncate text-sm font-medium">
                      {entry.title}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      Saved {new Date(entry.updatedAt * 1000).toLocaleDateString()}
                    </span>
                  </button>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {readingMinutes(entry.content)} min
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {hasRecoverableDraft && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
            <p className="text-sm">
              You have unsaved writing from{' '}
              {new Date(localDraft.savedAt).toLocaleString()}.
            </p>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  dismissedRestore.current = true;
                  setLocalDraft(null);
                  setRestored(true);
                }}
              >
                Discard
              </Button>
              <Button size="sm" onClick={restore}>
                Restore it
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

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

            <span className="text-xs tabular-nums text-muted-foreground">
              {wordCount(content).toLocaleString()} words ·{' '}
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

/**
 * The body field: a textarea, a toolbar, and the shortcuts to skip the
 * toolbar.
 *
 * Formatting is applied through the shared pure functions rather than by
 * splicing strings here, and the caret is restored afterwards — a formatting
 * button that leaves the cursor at the end of the document is one nobody
 * presses twice.
 */
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
  const imageInput = useRef<HTMLInputElement>(null);

  const run = (action: MarkdownAction) => {
    const textarea = ref.current;
    if (!textarea) return;

    const next = applyAction(action, {
      value,
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
    });

    onChange(next.value);

    // After React has written the new value, or the selection is set against
    // the old one and jumps
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(next.start, next.end);
    });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!event.metaKey && !event.ctrlKey) return;

    const action = (
      { b: 'bold', i: 'italic', k: 'link' } as const
    )[event.key.toLowerCase()];

    if (!action) return;

    event.preventDefault();
    run(action);
  };

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
      <MarkdownToolbar
        onAction={run}
        onPickImage={() => imageInput.current?.click()}
        isUploading={isUploading}
      />

      <input
        ref={imageInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onInsertImage(file);
          event.target.value = '';
        }}
      />

      <Textarea
        ref={ref}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
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
