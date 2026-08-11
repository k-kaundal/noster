import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useListingActions } from '@/hooks/useListings';
import { useUploadFile } from '@/hooks/useUploadFile';
import { useToast } from '@/hooks/useToast';
import {
  COMMON_CURRENCIES,
  PRICE_FREQUENCIES,
  slugify,
  type Listing,
} from '@/lib/nip99';

/**
 * Writing a listing.
 *
 * Editing keeps the original `d` and `published_at`. Changing either publishes
 * a second listing instead of revising the first, which leaves the old one on
 * relays at the old price with no way for its author to take it down.
 */
export function ListingEditor({
  listing,
  open,
  onOpenChange,
}: {
  listing?: Listing;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { publish, isPublishing } = useListingActions();
  const { mutateAsync: uploadFile, isPending: isUploading } = useUploadFile();
  const { toast } = useToast();

  const [title, setTitle] = useState(listing?.title ?? '');
  const [summary, setSummary] = useState(listing?.summary ?? '');
  const [content, setContent] = useState(listing?.content ?? '');
  const [amount, setAmount] = useState(
    listing?.price ? String(listing.price.amount) : ''
  );
  const [currency, setCurrency] = useState(listing?.price?.currency ?? 'USD');
  const [frequency, setFrequency] = useState(listing?.price?.frequency ?? 'none');
  const [location, setLocation] = useState(listing?.location ?? '');
  const [hashtags, setHashtags] = useState(listing?.hashtags.join(', ') ?? '');
  const [images, setImages] = useState(listing?.images ?? []);

  const addImage = async (file: File) => {
    try {
      const tags = await uploadFile(file);
      const url = tags[0]?.[1];
      if (!url) throw new Error('The upload returned no URL.');

      /**
       * `dim` from the NIP-94 tags becomes the `image` tag's second value, so
       * a gallery can reserve the right space before the picture arrives.
       */
      const dimensions = tags.find(([name]) => name === 'dim')?.[1];
      setImages((current) => [...current, { url, dimensions }]);
    } catch (error) {
      toast({
        title: 'Could not upload that image',
        description: (error as Error).message,
        variant: 'destructive',
      });
    }
  };

  const save = async (asDraft: boolean) => {
    const parsed = Number.parseFloat(amount.replace(/,/g, ''));

    await publish({
      asDraft,
      input: {
        // Kept on edit; only a new listing gets a slug from its title
        slug: listing?.slug ?? slugify(title),
        title,
        summary,
        content,
        price:
          Number.isFinite(parsed) && parsed >= 0 && currency
            ? {
                amount: parsed,
                currency,
                frequency: frequency === 'none' ? undefined : frequency,
              }
            : undefined,
        location,
        images,
        hashtags: hashtags
          .split(/[,\n]/)
          .map((tag) => tag.replace(/^#/, '').trim())
          .filter(Boolean),
        status: listing?.status ?? 'active',
        publishedAt: listing?.publishedAt,
      },
    }).catch(() => undefined);

    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {listing ? 'Edit listing' : 'New listing'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="listing-title">Title</Label>
            <Input
              id="listing-title"
              value={title}
              onChange={(changed) => setTitle(changed.target.value)}
              placeholder="What are you offering?"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="listing-summary">Summary</Label>
            <Input
              id="listing-summary"
              value={summary}
              onChange={(changed) => setSummary(changed.target.value)}
              placeholder="One line, shown in the grid"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="listing-amount">Price</Label>
              <Input
                id="listing-amount"
                value={amount}
                onChange={(changed) => setAmount(changed.target.value)}
                placeholder="100"
                inputMode="decimal"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="listing-currency">Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger id="listing-currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMMON_CURRENCIES.map((entry) => (
                    <SelectItem key={entry} value={entry}>
                      {entry}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="listing-frequency">Repeats</Label>
              <Select value={frequency} onValueChange={setFrequency}>
                <SelectTrigger id="listing-frequency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">One-off</SelectItem>
                  {PRICE_FREQUENCIES.map((entry) => (
                    <SelectItem key={entry} value={entry}>
                      per {entry}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="listing-location">Location</Label>
              <Input
                id="listing-location"
                value={location}
                onChange={(changed) => setLocation(changed.target.value)}
                placeholder="Berlin, or Anywhere"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="listing-tags">Categories</Label>
              <Input
                id="listing-tags"
                value={hashtags}
                onChange={(changed) => setHashtags(changed.target.value)}
                placeholder="electronics, bikes"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Photos</Label>
            <div className="flex flex-wrap gap-2">
              {images.map((image, index) => (
                <div key={image.url} className="relative">
                  <img
                    src={image.url}
                    alt=""
                    className="h-20 w-20 rounded-lg border object-cover"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setImages((current) =>
                        current.filter((_, at) => at !== index)
                      )
                    }
                    className="absolute -right-1.5 -top-1.5 rounded-full bg-background p-0.5 shadow"
                    aria-label="Remove image"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}

              <label className="flex h-20 w-20 cursor-pointer items-center justify-center rounded-lg border border-dashed text-muted-foreground hover:bg-muted/50">
                <Plus className="h-5 w-5" />
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={isUploading}
                  onChange={(changed) => {
                    const file = changed.target.files?.[0];
                    if (file) void addImage(file);
                    changed.target.value = '';
                  }}
                />
              </label>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="listing-content">Details</Label>
            <Textarea
              id="listing-content"
              value={content}
              onChange={(changed) => setContent(changed.target.value)}
              placeholder="Condition, delivery, anything a buyer should know. Markdown works."
              rows={8}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => save(true)}
            disabled={isPublishing || !title.trim()}
          >
            Save as draft
          </Button>
          <Button
            onClick={() => save(false)}
            disabled={isPublishing || !title.trim()}
          >
            {isPublishing ? 'Publishing…' : 'Publish'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
