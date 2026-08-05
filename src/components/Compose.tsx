import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, Image, Loader2, PenSquare, Send, X } from 'lucide-react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useUploadFile } from '@/hooks/useUploadFile';
import { useAuthor } from '@/hooks/useAuthor';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useToast } from '@/hooks/useToast';
import { genUserName } from '@/lib/genUserName';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { LoginArea } from '@/components/auth/LoginArea';
import { NoteContent } from '@/components/NoteContent';
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
  const [content, setContent] = useLocalStorage<string>('nostr:draft', '');
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { toast } = useToast();

  const { user } = useCurrentUser();
  const author = useAuthor(user?.pubkey || '');
  const { mutateAsync: createEvent } = useNostrPublish();
  const { mutateAsync: uploadFile, isPending: isUploading } = useUploadFile();

  const metadata = author.data?.metadata;
  const displayName =
    metadata?.display_name || metadata?.name || genUserName(user?.pubkey || '');

  const hashtags = extractHashtags(content);
  const canSubmit = !!content.trim() || uploadedImages.length > 0;

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

      const tags = [
        ...uploadedImages.map((url) => [
          'imeta',
          `url ${url}`,
          `m ${getImageMimeType(url)}`,
        ]),
        ...hashtags.map((tag) => ['t', tag]),
      ];

      await createEvent({ kind: 1, content: postContent, tags });

      toast({
        title: 'Post published',
        description: 'Your note is on its way to the relay.',
      });

      setContent('');
      setUploadedImages([]);
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

  if (!user) {
    return (
      <Card>
        <CardContent className="space-y-4 px-8 py-14 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <PenSquare className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <h2 className="font-semibold">Log in to post</h2>
            <p className="text-sm text-muted-foreground">
              You need a Nostr identity to publish notes.
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
        <CardTitle className="text-lg">New note</CardTitle>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
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
                <Textarea
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
                className="bg-brand-gradient px-6"
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
