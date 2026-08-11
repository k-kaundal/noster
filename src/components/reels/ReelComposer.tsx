import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Film, Loader2, Send, Upload, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ContentWarningField } from '@/components/notes/ContentWarningField';
import { contentWarningTags } from '@/lib/contentWarning';
import { Textarea } from '@/components/ui/textarea';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useUploadFile } from '@/hooks/useUploadFile';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useToast } from '@/hooks/useToast';
import { useRelays } from '@/hooks/useRelays';
import { buildImetaTag, SHORT_VIDEO_KIND } from '@/lib/video';
import { cn } from '@/lib/utils';

interface ReelComposerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const MAX_BYTES = 100 * 1024 * 1024;

/** Reads intrinsic dimensions and duration straight from the picked file. */
function probeVideo(file: File) {
  return new Promise<{ width?: number; height?: number; duration?: number }>(
    (resolve) => {
      const element = document.createElement('video');
      const url = URL.createObjectURL(file);

      const cleanup = () => {
        URL.revokeObjectURL(url);
        element.remove();
      };

      element.preload = 'metadata';
      element.onloadedmetadata = () => {
        const result = {
          width: element.videoWidth || undefined,
          height: element.videoHeight || undefined,
          duration: Number.isFinite(element.duration)
            ? element.duration
            : undefined,
        };
        cleanup();
        resolve(result);
      };
      element.onerror = () => {
        cleanup();
        resolve({});
      };

      element.src = url;
    }
  );
}

/** Uploads a vertical video and publishes it as a NIP-71 kind 22 event. */
export function ReelComposer({ open, onOpenChange }: ReelComposerProps) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [hashtags, setHashtags] = useState('');
  const [warningEnabled, setWarningEnabled] = useState(false);
  const [warningReason, setWarningReason] = useState('');
  const [warningCategories, setWarningCategories] = useState<string[]>([]);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const { user } = useCurrentUser();
  const { mutateAsync: uploadFile, isPending: isUploading } = useUploadFile();
  const { mutateAsync: createEvent } = useNostrPublish();
  const { writeUrls } = useRelays();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const reset = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null);
    setPreviewUrl(null);
    setTitle('');
    setCaption('');
    setHashtags('');
    setWarningEnabled(false);
    setWarningReason('');
  };

  const selectFile = (picked: File) => {
    if (!picked.type.startsWith('video/')) {
      toast({
        title: 'Not a video',
        description: 'Pick an mp4, webm or mov file.',
        variant: 'destructive',
      });
      return;
    }

    if (picked.size > MAX_BYTES) {
      toast({
        title: 'File too large',
        description: 'Reels are limited to 100MB.',
        variant: 'destructive',
      });
      return;
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(picked);
    setPreviewUrl(URL.createObjectURL(picked));
  };

  const handlePublish = async () => {
    if (!user || !file) return;

    if (!title.trim()) {
      toast({
        title: 'Title required',
        description: 'NIP-71 video events need a title.',
        variant: 'destructive',
      });
      return;
    }

    setIsPublishing(true);
    try {
      const [uploadTags, probe] = await Promise.all([
        uploadFile(file),
        probeVideo(file),
      ]);

      // The uploader returns NIP-94 tags; the URL is the first one
      const url = uploadTags[0]?.[1];
      if (!url) throw new Error('Upload did not return a URL');

      const hash = uploadTags.find(([name]) => name === 'x')?.[1];
      const mimeType =
        uploadTags.find(([name]) => name === 'm')?.[1] || file.type;

      const tags: string[][] = [
        ['title', title.trim()],
        buildImetaTag({
          url,
          mimeType,
          width: probe.width,
          height: probe.height,
          hash,
          duration: probe.duration,
        }),
        ['published_at', String(Math.floor(Date.now() / 1000))],
        ...(probe.duration
          ? [['duration', String(Math.round(probe.duration))]]
          : []),
        ...(caption.trim() ? [['alt', caption.trim().slice(0, 200)]] : []),
        ...hashtags
          .split(/[,\s]+/)
          .map((tag) => tag.replace(/^#/, '').trim().toLowerCase())
          .filter(Boolean)
          .map((tag) => ['t', tag]),
        ...(warningEnabled
          ? contentWarningTags({
              reason: warningReason,
              categories: warningCategories,
            })
          : []),
      ];

      await createEvent({
        kind: SHORT_VIDEO_KIND,
        content: caption.trim(),
        tags,
      });

      toast({
        title: 'Reel published',
        description: `Sent to ${writeUrls.length} ${
          writeUrls.length === 1 ? 'relay' : 'relays'
        }.`,
      });

      queryClient.invalidateQueries({ queryKey: ['reels'] });
      reset();
      onOpenChange(false);
    } catch (error) {
      toast({
        title: 'Failed to publish reel',
        description: (error as Error)?.message || 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsPublishing(false);
    }
  };

  const busy = isUploading || isPublishing;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Film className="h-4 w-4" />
            New reel
          </DialogTitle>
          <DialogDescription>
            Published as a NIP-71 short video (kind 22), so other Nostr clients
            can play it too.
          </DialogDescription>
        </DialogHeader>

        {!user ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Log in to publish a reel.
          </p>
        ) : (
          <div className="space-y-4">
            <input
              ref={inputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => {
                const picked = e.target.files?.[0];
                if (picked) selectFile(picked);
                e.target.value = '';
              }}
            />

            {previewUrl ? (
              <div className="relative mx-auto w-full max-w-[240px] overflow-hidden rounded-xl border bg-black">
                <video
                  src={previewUrl}
                  className="aspect-[9/16] w-full object-contain"
                  controls
                  playsInline
                />
                <Button
                  type="button"
                  variant="destructive"
                  size="icon"
                  className="absolute right-2 top-2 h-7 w-7"
                  aria-label="Remove video"
                  onClick={reset}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  const dropped = e.dataTransfer.files?.[0];
                  if (dropped) selectFile(dropped);
                }}
                className={cn(
                  'flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition-colors',
                  isDragging
                    ? 'border-primary bg-primary/5'
                    : 'hover:border-primary/50 hover:bg-accent/40'
                )}
              >
                <Upload className="h-6 w-6 text-muted-foreground" />
                <span className="text-sm font-medium">
                  Drop a video or browse
                </span>
                <span className="text-xs text-muted-foreground">
                  Vertical works best · up to 100MB
                </span>
              </button>
            )}

            <div className="space-y-2">
              <Label htmlFor="reel-title">Title</Label>
              <Input
                id="reel-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What's this reel about?"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="reel-caption">Caption</Label>
              <Textarea
                id="reel-caption"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Optional description"
                className="min-h-[70px] resize-none"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="reel-tags">Hashtags</Label>
              <Input
                id="reel-tags"
                value={hashtags}
                onChange={(e) => setHashtags(e.target.value)}
                placeholder="bitcoin, nostr, music"
              />
            </div>

            <ContentWarningField
              id="reel-warning"
              enabled={warningEnabled}
              onEnabledChange={setWarningEnabled}
              reason={warningReason}
              onReasonChange={setWarningReason}
              categories={warningCategories}
              onCategoriesChange={setWarningCategories}
            />

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                onClick={handlePublish}
                disabled={!file || busy}
                className=""
              >
                {busy ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-2 h-4 w-4" />
                )}
                {isUploading ? 'Uploading…' : isPublishing ? 'Publishing…' : 'Publish'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
