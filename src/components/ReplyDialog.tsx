import { useState, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useUploadFile } from '@/hooks/useUploadFile';
import { useAuthor } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';
import { buildReplyTags } from '@/lib/thread';
import { useToast } from '@/hooks/useToast';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Image, X, Loader2 } from 'lucide-react';
import { Post } from '@/components/Post';

interface ReplyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  replyingTo: NostrEvent;
}

export function ReplyDialog({ open, onOpenChange, replyingTo }: ReplyDialogProps) {
  const [content, setContent] = useState('');
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { user } = useCurrentUser();
  const currentUserAuthor = useAuthor(user?.pubkey || '');
  const { mutateAsync: createEvent } = useNostrPublish();
  const { mutateAsync: uploadFile, isPending: isUploading } = useUploadFile();

  const currentUserMetadata = currentUserAuthor.data?.metadata;
  const currentUserDisplayName = currentUserMetadata?.display_name || currentUserMetadata?.name || genUserName(user?.pubkey || '');
  const currentUserProfileImage = currentUserMetadata?.picture;

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    try {
      const file = files[0];

      if (file.size > 10 * 1024 * 1024) {
        toast({
          title: "File too large",
          description: "Please select an image smaller than 10MB.",
          variant: "destructive",
        });
        return;
      }

      if (!file.type.startsWith('image/')) {
        toast({
          title: "Invalid file type",
          description: "Please select an image file.",
          variant: "destructive",
        });
        return;
      }

      const tags = await uploadFile(file);
      const imageUrl = tags[0][1];

      setUploadedImages(prev => [...prev, imageUrl]);
      toast({
        title: "Image uploaded",
        description: "Your image has been uploaded successfully.",
      });
    } catch (error) {
      console.error('Upload error:', error);
      toast({
        title: "Upload failed",
        description: "Failed to upload image. Please try again.",
        variant: "destructive",
      });
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeImage = (index: number) => {
    setUploadedImages(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!user) {
      toast({
        title: "Not logged in",
        description: "Please log in to reply.",
        variant: "destructive",
      });
      return;
    }

    if (!content.trim() && uploadedImages.length === 0) {
      toast({
        title: "Empty reply",
        description: "Please add some content or an image.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      let replyContent = content.trim();
      if (uploadedImages.length > 0) {
        if (replyContent) {
          replyContent += '\n\n';
        }
        replyContent += uploadedImages.join('\n');
      }

      const imageTags = uploadedImages.map(url => [
        'imeta',
        `url ${url}`,
        `m ${getImageMimeType(url)}`,
      ]);

      await createEvent({
        kind: 1,
        content: replyContent,
        tags: [...buildReplyTags(replyingTo), ...imageTags],
      });

      toast({
        title: "Reply posted",
        description: "Your reply has been published successfully.",
      });

      // The reply belongs to a thread, not just to its parent
      queryClient.invalidateQueries({ queryKey: ['thread'] });
      queryClient.invalidateQueries({ queryKey: ['note-stats', replyingTo.id] });
      queryClient.invalidateQueries({ queryKey: ['replies', replyingTo.id] });

      setContent('');
      setUploadedImages([]);
      onOpenChange(false);
    } catch (error) {
      console.error('Reply creation error:', error);
      toast({
        title: "Failed to post reply",
        description: "Something went wrong. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const getImageMimeType = (url: string): string => {
    const extension = url.split('.').pop()?.toLowerCase();
    switch (extension) {
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'png':
        return 'image/png';
      case 'gif':
        return 'image/gif';
      case 'webp':
        return 'image/webp';
      default:
        return 'image/jpeg';
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Reply to post</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* The note being replied to, rendered read-only */}
          <Card className="overflow-hidden border-l-4 border-l-primary bg-muted/30">
            <Post event={replyingTo} showReplies={false} embedded />
          </Card>

          {/* Reply Form */}
          {user ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="flex items-start space-x-3">
                <Avatar className="h-10 w-10">
                  <AvatarImage src={currentUserProfileImage} alt={currentUserDisplayName} />
                  <AvatarFallback>{currentUserDisplayName.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="flex-1 space-y-3">
                  <div className="flex items-center space-x-2">
                    <span className="font-semibold">{currentUserDisplayName}</span>
                    {currentUserMetadata?.nip05 && (
                      <Badge variant="secondary" className="text-xs">
                        ✓
                      </Badge>
                    )}
                  </div>

                  <Textarea
                    placeholder="Write your reply..."
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                        e.preventDefault();
                        handleSubmit(e);
                      }
                    }}
                    className="min-h-[110px] resize-none"
                    autoFocus
                  />

                  <div className="flex items-center justify-end gap-3 text-xs text-muted-foreground">
                    <span>
                      <kbd className="rounded border bg-muted px-1 font-mono">⌘</kbd>
                      {' + '}
                      <kbd className="rounded border bg-muted px-1 font-mono">↵</kbd>
                      {' to send'}
                    </span>
                    <span className="tabular-nums">{content.length}</span>
                  </div>

                  {uploadedImages.length > 0 && (
                    <div className={`grid gap-2 ${uploadedImages.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                      {uploadedImages.map((url, index) => (
                        <div key={index} className="relative rounded-lg overflow-hidden border">
                          <img
                            src={url}
                            alt={`Upload ${index + 1}`}
                            className="w-full h-auto max-h-32 object-cover"
                          />
                          <Button
                            type="button"
                            variant="destructive"
                            size="icon"
                            className="absolute top-2 right-2 h-6 w-6"
                            onClick={() => removeImage(index)}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-3 border-t">
                    <div className="flex items-center space-x-2">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleImageUpload}
                        className="hidden"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isUploading || uploadedImages.length >= 4}
                      >
                        {isUploading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Image className="h-4 w-4" />
                        )}
                      </Button>
                      {uploadedImages.length >= 4 && (
                        <span className="text-xs text-muted-foreground">
                          Maximum 4 images
                        </span>
                      )}
                    </div>

                    <div className="flex items-center space-x-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        disabled={isSubmitting || (!content.trim() && uploadedImages.length === 0)}
                        className="px-6"
                      >
                        {isSubmitting ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Replying...
                          </>
                        ) : (
                          'Reply'
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </form>
          ) : (
            <div className="text-center py-8">
              <p className="text-muted-foreground">
                Please log in to reply to this post.
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

