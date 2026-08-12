import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart3,
  Eraser,
  Eye,
  FileText,
  Image,
  Loader2,
  PenSquare,
  Plus,
  Send,
  Server,
  X,
} from 'lucide-react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useUploadFile } from '@/hooks/useUploadFile';
import { useAuthor } from '@/hooks/useAuthor';
import { useAccountStored } from '@/hooks/useStore';
import { useToast } from '@/hooks/useToast';
import { genUserName } from '@/lib/genUserName';
import { looksLikeMarkdown, stripMarkdown } from '@/lib/markdown';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { MentionAutocomplete } from '@/components/MentionAutocomplete';
import {
  buildQuoteTags,
  extractMentionPubkeys,
  extractQuotedEvents,
} from '@/lib/mention';
import { nip19 } from 'nostr-tools';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { LoginArea } from '@/components/auth/LoginArea';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useRelays } from '@/hooks/useRelays';
import { relayDisplayName } from '@/lib/relay';
import { POLL_KIND, buildPollTags } from '@/lib/poll';
import { NoteContent } from '@/components/NoteContent';
import { ContentWarningField } from '@/components/notes/ContentWarningField';
import { ExpiryField } from '@/components/notes/ExpiryField';
import { SnippetComposer } from '@/components/notes/SnippetComposer';
import { useExpirySupport } from '@/hooks/useExpirySupport';
import { EXPIRY_CHOICES, expirationTags } from '@/lib/expiration';
import { contentWarningTags } from '@/lib/contentWarning';
import { cn } from '@/lib/utils';

const MAX_IMAGES = 4;
const SOFT_LIMIT = 1000;

const MIME_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
};

function getImageMimeType(url: string): string {
  const extension = url.split('.').pop()?.toLowerCase() ?? '';
  return MIME_TYPES[extension] ?? 'image/jpeg';
}

/** Hashtags written inline become indexed `t` tags so relays can filter them. */
function extractHashtags(content: string): string[] {
  const matches = content.match(/(?:^|\s)#([\p{L}\p{N}_]+)/gu) ?? [];
  return Array.from(
    new Set(matches.map((match) => match.trim().slice(1).toLowerCase()))
  );
}

export function Compose() {
  /**
   * The draft, kept per account.
   *
   * One shared draft meant switching accounts handed whatever you were half
   * way through writing to the next identity's composer — a note addressed
   * from the wrong person is the kind of mistake that cannot be taken back
   * once it is posted.
   */
  const [content, setContent] = useAccountStored<string>('draft', '');
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [warningEnabled, setWarningEnabled] = useState(false);
  const [warningReason, setWarningReason] = useState('');
  const [warningCategories, setWarningCategories] = useState<string[]>([]);
  const [expiry, setExpiry] = useState('never');
  const [pollEnabled, setPollEnabled] = useState(false);
  const [pollChoices, setPollChoices] = useState<string[]>(['', '']);
  const [multipleChoice, setMultipleChoice] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // The mention picker needs the live element to read the caret position
  const [textarea, setTextarea] = useState<HTMLTextAreaElement | null>(null);
  const navigate = useNavigate();
  const { toast } = useToast();

  const { user } = useCurrentUser();
  const author = useAuthor(user?.pubkey || '');
  const { mutateAsync: createEvent } = useNostrPublish();
  const { mutateAsync: uploadFile, isPending: isUploading } = useUploadFile();
  const { writeUrls } = useRelays();
  const { unsupported: unsupportedExpiryRelays } = useExpirySupport();

  const metadata = author.data?.metadata;
  const displayName =
    metadata?.display_name || metadata?.name || genUserName(user?.pubkey || '');

  const hashtags = extractHashtags(content);
  const filledChoices = pollChoices.map((choice) => choice.trim()).filter(Boolean);
  // A poll needs a question and at least two answers to be votable
  const pollReady = !pollEnabled || (!!content.trim() && filledChoices.length >= 2);
  const canSubmit =
    (!!content.trim() || uploadedImages.length > 0) && pollReady;

  /**
   * Whether the box currently holds Markdown.
   *
   * Recomputed only when the text changes, since this runs a handful of
   * regexes and the composer re-renders on every keystroke for other reasons.
   */
  const isMarkdown = useMemo(() => looksLikeMarkdown(content), [content]);

  /**
   * Takes the Markdown out and leaves the words.
   *
   * The text is replaced rather than reformatted on publish, so what the box
   * shows is what gets posted — a cleanup that happened invisibly at send time
   * would be a different note than the one they read back before pressing the
   * button.
   */
  const cleanMarkdown = () => {
    const cleaned = stripMarkdown(content);

    if (cleaned === content) return;

    setContent(cleaned);
    toast({
      title: 'Formatting removed',
      description: 'Links and line breaks were kept.',
    });
  };

  /**
   * Hands what has been typed to the article editor.
   *
   * Passed through router state rather than the query string: an article body
   * is longer than a URL should be, and putting somebody's unfinished writing
   * into the address bar leaves it in history and in any link they share.
   */
  const openArticle = (body?: string) => {
    navigate('/write', body?.trim() ? { state: { body } } : undefined);
  };

  const uploadImage = async (file: File) => {
    if (uploadedImages.length >= MAX_IMAGES) {
      toast({
        title: 'Too many images',
        description: `You can attach up to ${MAX_IMAGES} images.`,
        variant: 'destructive',
      });
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast({
        title: 'File too large',
        description: 'Please select an image smaller than 10MB.',
        variant: 'destructive',
      });
      return;
    }

    if (!file.type.startsWith('image/')) {
      toast({
        title: 'Invalid file type',
        description: 'Please select an image file.',
        variant: 'destructive',
      });
      return;
    }

    try {
      const tags = await uploadFile(file);
      setUploadedImages((prev) => [...prev, tags[0][1]]);
    } catch (error) {
      console.error('Upload error:', error);
      toast({
        title: 'Upload failed',
        description: 'Failed to upload image. Please try again.',
        variant: 'destructive',
      });
    }
  };

  const handleFileInput = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (file) await uploadImage(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!user) {
      toast({
        title: 'Not logged in',
        description: 'Please log in to create a post.',
        variant: 'destructive',
      });
      return;
    }

    if (!canSubmit) {
      toast({
        title: 'Empty post',
        description: 'Please add some content or an image.',
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);

    try {
      let postContent = content.trim();
      if (uploadedImages.length > 0) {
        if (postContent) postContent += '\n\n';
        postContent += uploadedImages.join('\n');
      }

      // Mentions only notify the person if they are also tagged
      const mentioned = extractMentionPubkeys(postContent, nip19.decode);

      /**
       * NIP-27: an event pasted into the text as a `nostr:` link is invisible
       * to everything except a reader of that paragraph until it is tagged.
       * `q` rather than `e`, so citing a note does not file this among that
       * note's replies.
       */
      const quoted = buildQuoteTags(
        extractQuotedEvents(postContent, nip19.decode)
      );

      /**
       * The warning, as both a marker and labels. Empty when the switch is
       * off, so it costs nothing to splice in unconditionally.
       */
      const warningTags = warningEnabled
        ? contentWarningTags({
            reason: warningReason,
            categories: warningCategories,
          })
        : [];

      /**
       * NIP-40. Computed here rather than when the dropdown changed, so a
       * composer left open for twenty minutes does not publish a note that is
       * already most of the way through its life.
       */
      const expiryTags = expirationTags(
        EXPIRY_CHOICES.find((choice) => choice.id === expiry)?.seconds
      );

      const tags = [
        ...uploadedImages.map((url) => [
          'imeta',
          `url ${url}`,
          `m ${getImageMimeType(url)}`,
        ]),
        ...mentioned.map((pubkey) => ['p', pubkey]),
        ...quoted,
        ...hashtags.map((tag) => ['t', tag]),
        // NIP-36: readers approve before the note is shown
        ...warningTags,
        ...expiryTags,
      ];

      if (pollEnabled) {
        // Polls carry their options in tags and their question in content
        await createEvent({
          kind: POLL_KIND,
          content: content.trim(),
          tags: [
            ...buildPollTags({
              choices: filledChoices,
              type: multipleChoice ? 'multiplechoice' : 'singlechoice',
              relays: writeUrls.slice(0, 4),
            }),
            ...mentioned.map((pubkey) => ['p', pubkey]),
            ...quoted,
            ...hashtags.map((tag) => ['t', tag]),
            ...warningTags,
            ...expiryTags,
          ],
        });
      } else {
        await createEvent({ kind: 1, content: postContent, tags });
      }

      toast({
        title: 'Post published',
        description: `Sent to ${writeUrls.length} ${
          writeUrls.length === 1 ? 'relay' : 'relays'
        }.`,
      });

      setContent('');
      setUploadedImages([]);
      setWarningEnabled(false);
      setWarningReason('');
      setPollEnabled(false);
      setPollChoices(['', '']);
      navigate('/');
    } catch (error) {
      console.error('Post creation error:', error);
      toast({
        title: 'Failed to create post',
        description: 'Something went wrong. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * A read-only session gets the same door as no session at all.
   *
   * It has a pubkey, so every `if (!user)` guard in the app waves it through
   * — and it can no more sign a note than a logged-out visitor can. Showing
   * the composer and failing at publish would waste whatever was typed.
   */
  if (!user || user.readOnly) {
    return (
      <Card>
        <CardContent className="space-y-4 px-8 py-14 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <PenSquare className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <h2 className="font-semibold">
              {user ? 'Log in with your key to post' : 'Log in to post'}
            </h2>
            <p className="text-sm text-muted-foreground">
              {user
                ? "You're browsing read-only, which can read everything and publish nothing."
                : 'You need a Nostr identity to publish notes.'}
            </p>
          </div>
          <LoginArea className="mx-auto max-w-60" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-lg">New note</CardTitle>

          {/*
            The way out to long-form. A note is plain text on every client that
            reads it, so somebody with a piece to write needs a different kind
            of event rather than a bigger box — and needs to find it before
            they have typed the whole thing into this one.
          */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground"
            onClick={() => openArticle()}
          >
            <FileText className="h-4 w-4" />
            Write an article
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/*
            Offered, never applied. NIP-23 says clients dealing in kind 1
            "should not be expected to implement this NIP" — so this does not
            quietly format the note, which would make it render here unlike
            everywhere else. It moves the text somewhere the formatting is
            real.
          */}
          {isMarkdown && (
            <div className="space-y-2.5 rounded-lg border border-dashed bg-muted/40 p-3">
              <div className="flex items-start gap-2.5">
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <p className="min-w-0 flex-1 text-sm text-muted-foreground">
                  That looks like Markdown. A note posts it as plain text —
                  asterisks and all.
                </p>
              </div>

              {/*
                Two ways out, because there are two things somebody meant. One
                wanted the formatting, and belongs in an article; the other
                pasted it from somewhere and just wants it gone.
              */}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="flex-1 gap-1.5"
                  onClick={() => openArticle(content)}
                >
                  <FileText className="h-3.5 w-3.5" />
                  Write as article
                </Button>

                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="flex-1 gap-1.5"
                  onClick={cleanMarkdown}
                >
                  <Eraser className="h-3.5 w-3.5" />
                  Remove formatting
                </Button>
              </div>
            </div>
          )}

          <div className="flex items-start gap-3">
            <Avatar className="h-10 w-10 shrink-0">
              <AvatarImage src={metadata?.picture} alt="" />
              <AvatarFallback className="text-xs">
                {displayName.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>

            <div className="min-w-0 flex-1 space-y-3">
              {showPreview ? (
                <div className="min-h-[140px] rounded-lg border border-dashed p-3">
                  {content.trim() ? (
                    <NoteContent
                      event={{
                        id: 'preview',
                        pubkey: user.pubkey,
                        kind: 1,
                        tags: [],
                        content,
                        created_at: Math.floor(Date.now() / 1000),
                        sig: '',
                      }}
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Nothing to preview yet.
                    </p>
                  )}
                </div>
              ) : (
                <div className="relative">
                <Textarea
                  ref={setTextarea}
                  placeholder="What's happening?"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                      e.preventDefault();
                      handleSubmit(e);
                    }
                  }}
                  onPaste={(e) => {
                    const file = Array.from(e.clipboardData.files)[0];
                    if (file?.type.startsWith('image/')) {
                      e.preventDefault();
                      uploadImage(file);
                    }
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDragging(false);
                    const file = Array.from(e.dataTransfer.files)[0];
                    if (file) uploadImage(file);
                  }}
                  className={cn(
                    'min-h-[140px] resize-none text-base transition-colors',
                    isDragging && 'border-primary bg-primary/5'
                  )}
                  autoFocus
                />

                {/* Typing "@" offers the people you follow */}
                <MentionAutocomplete
                  value={content}
                  textarea={textarea}
                  onSelect={(next, caret) => {
                    setContent(next);
                    // Restoring the caret has to wait for the value to land
                    requestAnimationFrame(() => {
                      textarea?.focus();
                      textarea?.setSelectionRange(caret, caret);
                    });
                  }}
                />
                </div>
              )}

              {uploadedImages.length > 0 && (
                <div
                  className={cn(
                    'grid gap-2',
                    uploadedImages.length === 1 ? 'grid-cols-1' : 'grid-cols-2'
                  )}
                >
                  {uploadedImages.map((url, index) => (
                    <div
                      key={url}
                      className="group relative overflow-hidden rounded-lg border"
                    >
                      <img
                        src={url}
                        alt=""
                        className="max-h-56 w-full object-cover"
                      />
                      <Button
                        type="button"
                        variant="destructive"
                        size="icon"
                        aria-label={`Remove image ${index + 1}`}
                        className="absolute right-2 top-2 h-7 w-7"
                        onClick={() =>
                          setUploadedImages((prev) =>
                            prev.filter((_, i) => i !== index)
                          )
                        }
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {hashtags.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Tagged as{' '}
                  <span className="font-medium text-foreground">
                    {hashtags.map((tag) => `#${tag}`).join(', ')}
                  </span>
                </p>
              )}
            </div>
          </div>

          {/* NIP-88 poll */}
          <div className="space-y-2 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-3">
              <Label
                htmlFor="poll-toggle"
                className="flex cursor-pointer items-center gap-2 text-sm font-normal"
              >
                <BarChart3 className="h-4 w-4 text-primary" />
                Add a poll
              </Label>
              <Switch
                id="poll-toggle"
                checked={pollEnabled}
                onCheckedChange={setPollEnabled}
              />
            </div>

            {pollEnabled && (
              <div className="space-y-2 pt-1">
                {pollChoices.map((choice, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      value={choice}
                      onChange={(e) =>
                        setPollChoices((current) =>
                          current.map((value, i) =>
                            i === index ? e.target.value : value
                          )
                        )
                      }
                      placeholder={`Option ${index + 1}`}
                      aria-label={`Poll option ${index + 1}`}
                      className="text-sm"
                    />
                    {pollChoices.length > 2 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 shrink-0"
                        aria-label={`Remove option ${index + 1}`}
                        onClick={() =>
                          setPollChoices((current) =>
                            current.filter((_, i) => i !== index)
                          )
                        }
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={pollChoices.length >= 6}
                    onClick={() => setPollChoices((current) => [...current, ''])}
                  >
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    Add option
                  </Button>

                  <Label
                    htmlFor="poll-multi"
                    className="flex cursor-pointer items-center gap-2 text-xs font-normal text-muted-foreground"
                  >
                    <Switch
                      id="poll-multi"
                      checked={multipleChoice}
                      onCheckedChange={setMultipleChoice}
                    />
                    Allow multiple answers
                  </Label>
                </div>

                {!pollReady && (
                  <p className="text-xs text-muted-foreground">
                    A poll needs a question above and at least two options.
                  </p>
                )}
              </div>
            )}
          </div>

          {/*
            NIP-C0: code goes out as a kind 1337 rather than a fenced block in
            a note, so its language and filename are facts about the event.
          */}
          <div className="flex justify-start">
            <SnippetComposer />
          </div>

          {/* NIP-40: relays are asked to drop the note after a while */}
          <ExpiryField
            value={expiry}
            onChange={setExpiry}
            unsupportedRelays={unsupportedExpiryRelays}
          />

          {/* NIP-36 content warning */}
          <ContentWarningField
            enabled={warningEnabled}
            onEnabledChange={setWarningEnabled}
            reason={warningReason}
            onReasonChange={setWarningReason}
            categories={warningCategories}
            onCategoriesChange={setWarningCategories}
          />

          {/* Where this note will land */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <Server className="h-3.5 w-3.5" />
            Publishing to
            {writeUrls.slice(0, 3).map((url) => (
              <Badge key={url} variant="secondary" className="font-normal">
                {relayDisplayName(url)}
              </Badge>
            ))}
            {writeUrls.length > 3 && (
              <span>+{writeUrls.length - 3} more</span>
            )}
          </div>

          <Separator />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileInput}
                className="hidden"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Attach an image"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading || uploadedImages.length >= MAX_IMAGES}
              >
                {isUploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Image className="h-4 w-4" />
                )}
              </Button>

              <Button
                type="button"
                variant={showPreview ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setShowPreview((value) => !value)}
              >
                <Eye className="mr-1.5 h-4 w-4" />
                Preview
              </Button>
            </div>

            <div className="flex items-center gap-3">
              <span
                className={cn(
                  'text-xs tabular-nums text-muted-foreground',
                  content.length > SOFT_LIMIT && 'text-warning'
                )}
              >
                {content.length}
              </span>
              <Button
                type="submit"
                disabled={isSubmitting || !canSubmit}
                className="px-6"
              >
                {isSubmitting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-2 h-4 w-4" />
                )}
                {isSubmitting ? 'Posting…' : 'Post'}
              </Button>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
