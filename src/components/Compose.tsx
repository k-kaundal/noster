import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useUploadFile } from '@/hooks/useUploadFile';
import { useAuthor } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/useToast';
import { Image, X, Loader2 } from 'lucide-react';

export function Compose() {
  const [content, setContent] = useState('');
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { toast } = useToast();

  const { user } = useCurrentUser();
  const author = useAuthor(user?.pubkey || '');
  const { mutateAsync: createEvent } = useNostrPublish();
  const { mutateAsync: uploadFile, isPending: isUploading } = useUploadFile();

  const metadata = author.data?.metadata;
  const displayName = metadata?.display_name || metadata?.name || genUserName(user?.pubkey || '');
  const profileImage = metadata?.picture;

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    try {
      const file = files[0];

      // Check file size (max 10MB)
      if (file.size > 10 * 1024 * 1024) {
        toast({
          title: "File too large",
          description: "Please select an image smaller than 10MB.",
          variant: "destructive",
        });
        return;
      }

      // Check file type
      if (!file.type.startsWith('image/')) {
        toast({
          title: "Invalid file type",
          description: "Please select an image file.",
          variant: "destructive",
        });
        return;
      }

      const tags = await uploadFile(file);
      const imageUrl = tags[0][1]; // First tag contains the URL

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

    // Reset file input
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
        description: "Please log in to create a post.",
        variant: "destructive",
      });
      return;
    }

    if (!content.trim() && uploadedImages.length === 0) {
      toast({
        title: "Empty post",
        description: "Please add some content or an image.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      // Combine text content with image URLs
      let postContent = content.trim();
      if (uploadedImages.length > 0) {
        if (postContent) {
          postContent += '\n\n';
        }
        postContent += uploadedImages.join('\n');
      }

      // Create tags for images (NIP-94 compatible)
      const imageTags = uploadedImages.map(url => [
        'imeta',
        `url ${url}`,
        `m ${getImageMimeType(url)}`,
      ]);

      await createEvent({
        kind: 1,
        content: postContent,
        tags: imageTags,
      });

      toast({
        title: "Post created",
        description: "Your post has been published successfully.",
      });

      // Reset form
      setContent('');
      setUploadedImages([]);

      // Navigate back to home
      navigate('/');
    } catch (error) {
      console.error('Post creation error:', error);
      toast({
        title: "Failed to create post",
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

  if (!user) {
    return (
      <Card>
        <CardContent className="py-12 px-8 text-center">
          <p className="text-muted-foreground">
            Please log in to create a post.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="animate-slide-up hover-lift transition-all duration-200">
      <CardHeader>
        <CardTitle className="bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
          Create a new post
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex items-start space-x-3">
            <Avatar className="h-10 w-10">
              <AvatarImage src={profileImage} alt={displayName} />
              <AvatarFallback>{displayName.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="flex-1 space-y-3">
              <div className="flex items-center space-x-2">
                <span className="font-semibold">{displayName}</span>
                {metadata?.nip05 && (
                  <Badge variant="secondary" className="text-xs">
                    ✓
                  </Badge>
                )}
              </div>

              <Textarea
                placeholder="What's happening?"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="min-h-[120px] resize-none border-0 p-0 focus-visible:ring-0 text-lg"
                // maxLength={1000}
              />

              {/* <div className="text-sm text-muted-foreground text-right">
                {content.length}/1000
              </div> */}

              {/* Image Previews */}
              {uploadedImages.length > 0 && (
                <div className={`grid gap-2 ${uploadedImages.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                  {uploadedImages.map((url, index) => (
                    <div key={index} className="relative rounded-lg overflow-hidden border">
                      <img
                        src={url}
                        alt={`Upload ${index + 1}`}
                        className="w-full h-auto max-h-64 object-cover"
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

                <Button
                  type="submit"
                  disabled={isSubmitting || (!content.trim() && uploadedImages.length === 0)}
                  className="px-6 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 hover-lift transition-all duration-200"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Posting...
                    </>
                  ) : (
                    'Post'
                  )}
                </Button>
              </div>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}