import { useRef, useState } from 'react';
import { Image, Loader2, Shield, X } from 'lucide-react';

import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useToast } from '@/hooks/useToast';
import { useUploadFile } from '@/hooks/useUploadFile';
import { genUserName } from '@/lib/genUserName';
import {
  MAX_IMAGES,
  extractHashtags,
  imageProblem,
} from '@/lib/attachments';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { MentionAutocomplete } from '@/components/MentionAutocomplete';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

/**
 * Writing a post for a community.
 *
 * The box here used to be a bare textarea and a button, while the composer on
 * the home feed had pictures, mentions and hashtags — so posting to a
 * community meant giving up every tool the same app gave you everywhere else,
 * and the boards ended up full of plain text and pasted links.
 *
 * It is deliberately not the whole home composer: polls, expiry and content
 * warnings belong to a note you own, and a post here is a submission somebody
 * else approves. What it does share is everything that decides whether a post
 * can be read and found — which is the part that was missing.
 */
export function CommunityComposer({
  communityName,
  onPost,
  isPosting,
}: {
  communityName: string;
  /** Publishes. Resolves when the post is on the network. */
  onPost: (content: string, images: string[]) => Promise<unknown>;
  isPosting: boolean;
}) {
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const { mutateAsync: uploadFile, isPending: isUploading } = useUploadFile();

  const [content, setContent] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [textarea, setTextarea] = useState<HTMLTextAreaElement | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const author = useAuthor(user?.pubkey);
  const metadata = author.data?.metadata;
  const name = metadata?.name || genUserName(user?.pubkey ?? '');

  /*
   * Opens on focus rather than sitting open. A permanently expanded composer
   * pushed the board itself below the fold on a phone, so the first thing you
   * saw on a community you had come to read was an empty text box.
   */
  const expanded = open || !!content.trim() || images.length > 0;
  const ready = (!!content.trim() || images.length > 0) && !isPosting;
  const hashtags = extractHashtags(content);

  const attach = async (file: File) => {
    const problem = imageProblem(file, images.length);
    if (problem) {
      toast({ title: 'Not attached', description: problem, variant: 'destructive' });
      return;
    }

    try {
      // The first NIP-94 tag carries the URL; see `useUploadFile`
      const [[, url]] = await uploadFile(file);
      setImages((previous) => [...previous, url]);
      setOpen(true);
    } catch {
      toast({
        title: 'Upload failed',
        description: 'That image did not go up. Try again.',
        variant: 'destructive',
      });
    }
  };

  const submit = async () => {
    if (!ready) return;
    try {
      await onPost(content, images);
      setContent('');
      setImages([]);
      setOpen(false);
    } catch {
      // The hook reports its own failures, and the draft stays put
    }
  };

  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex gap-3">
          <Avatar className="h-9 w-9 shrink-0">
            <AvatarImage src={metadata?.picture} alt="" />
            <AvatarFallback className="text-xs">
              {name.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>

          <div className="min-w-0 flex-1 space-y-2">
            <div className="relative">
              <Textarea
                ref={setTextarea}
                value={content}
                onChange={(event) => setContent(event.target.value)}
                onFocus={() => setOpen(true)}
                /*
                 * Pasting a screenshot is how most pictures reach a post, and
                 * it silently did nothing here — the clipboard image was
                 * dropped and whatever text came with it was pasted instead.
                 */
                onPaste={(event) => {
                  const file = [...event.clipboardData.files].find((entry) =>
                    entry.type.startsWith('image/')
                  );
                  if (!file) return;
                  event.preventDefault();
                  void attach(file);
                }}
                onDrop={(event) => {
                  const file = [...event.dataTransfer.files].find((entry) =>
                    entry.type.startsWith('image/')
                  );
                  if (!file) return;
                  event.preventDefault();
                  void attach(file);
                }}
                onKeyDown={(event) => {
                  // The shortcut every composer has. Enter alone stays a
                  // newline: this box is for paragraphs, not one-liners
                  if (
                    (event.metaKey || event.ctrlKey) &&
                    event.key === 'Enter'
                  ) {
                    event.preventDefault();
                    void submit();
                  }
                }}
                placeholder={`Post to ${communityName}…`}
                aria-label={`Post to ${communityName}`}
                className={cn(
                  'resize-none transition-[min-height]',
                  expanded ? 'min-h-[88px]' : 'min-h-[40px]'
                )}
              />

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

            {images.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {images.map((url) => (
                  <div key={url} className="group relative">
                    <img
                      src={url}
                      alt=""
                      className="h-20 w-20 rounded-lg border object-cover"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setImages((previous) =>
                          previous.filter((entry) => entry !== url)
                        )
                      }
                      aria-label="Remove image"
                      className="absolute -right-1.5 -top-1.5 rounded-full bg-background p-0.5 shadow ring-1 ring-border transition-opacity"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {expanded && (
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-1">
                  <input
                    ref={fileInput}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void attach(file);
                      if (fileInput.current) fileInput.current.value = '';
                    }}
                  />

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        disabled={isUploading || images.length >= MAX_IMAGES}
                        onClick={() => fileInput.current?.click()}
                        aria-label="Add an image"
                      >
                        {isUploading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Image className="h-4 w-4" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {images.length >= MAX_IMAGES
                        ? `${MAX_IMAGES} images is the limit`
                        : 'Add an image — or just paste one'}
                    </TooltipContent>
                  </Tooltip>

                  {/*
                    Shown as it is typed, because a hashtag is the difference
                    between a post being findable and not, and nothing else on
                    screen says the `#` did anything.
                  */}
                  {hashtags.length > 0 && (
                    <span className="ml-1 truncate text-xs text-muted-foreground">
                      filed under{' '}
                      {hashtags.slice(0, 3).map((tag) => `#${tag}`).join(' ')}
                      {hashtags.length > 3 && ` +${hashtags.length - 3}`}
                    </span>
                  )}
                </div>

                <Button size="sm" disabled={!ready} onClick={() => void submit()}>
                  {isPosting && (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  )}
                  Post
                </Button>
              </div>
            )}

            {/*
              On its own line rather than beside the button.

              It is context, not a control, and sharing a row with the
              attachment button and Post left three things competing for one
              line — so the row wrapped and the sentence somebody most needs to
              read before posting was the part that moved.
            */}
            {expanded && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Shield className="h-3.5 w-3.5 shrink-0" />
                A moderator sees this before the board does.
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
