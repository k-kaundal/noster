import { useState } from 'react';
import { Search } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useGifSearch } from '@/hooks/useGifSearch';
import type { GifResult } from '@/lib/gif';
import { cn } from '@/lib/utils';

/**
 * A GIF picker dialog.
 *
 * Opens to trending, searches after a debounce, and hands the selected GIF
 * back through `onSelect`. The grid is two columns on a phone, three on
 * anything wider — the same layout Damus and Twitter both landed on.
 *
 * The picker itself is a dialog rather than a popover because it needs the
 * screen space: a search box, a grid, and a keyboard that would fight the
 * composer's textarea for focus.
 */
export function GifPicker({
  onSelect,
  children,
}: {
  /** Called with the selected GIF. The dialog closes itself. */
  onSelect: (gif: GifResult) => void;
  /** The button that opens the picker. */
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { gifs, input, setInput, isSearching, isLoading, isError } = useGifSearch();

  const handleSelect = (gif: GifResult) => {
    onSelect(gif);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>

      <DialogContent className="flex max-h-[80vh] flex-col gap-4 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Choose a GIF</DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search GIFs…"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            className="pl-9"
            autoFocus
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading && !gifs.length ? (
            <GifGridSkeleton />
          ) : isError ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <p className="text-sm text-muted-foreground">
                Could not load GIFs. Check your connection and try again.
              </p>
            </div>
          ) : !gifs.length ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <p className="text-sm text-muted-foreground">
                {isSearching
                  ? `No GIFs found for "${input}".`
                  : 'No trending GIFs right now.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {gifs.map((gif) => (
                <GifCell key={gif.id} gif={gif} onSelect={handleSelect} />
              ))}
            </div>
          )}
        </div>

        <p className="text-center text-[10px] text-muted-foreground/60">
          Powered by KLIPY
        </p>
      </DialogContent>
    </Dialog>
  );
}

function GifCell({
  gif,
  onSelect,
}: {
  gif: GifResult;
  onSelect: (gif: GifResult) => void;
}) {
  const [loaded, setLoaded] = useState(false);

  return (
    <button
      type="button"
      onClick={() => onSelect(gif)}
      className={cn(
        'group relative aspect-square overflow-hidden rounded-lg border bg-muted',
        'transition-transform hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-primary'
      )}
      aria-label={gif.title}
    >
      {!loaded && (
        <Skeleton className="absolute inset-0" />
      )}
      <img
        src={gif.previewUrl}
        alt={gif.title}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        className={cn(
          'h-full w-full object-cover transition-opacity',
          loaded ? 'opacity-100' : 'opacity-0'
        )}
      />
    </button>
  );
}

function GifGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {Array.from({ length: 9 }).map((_, index) => (
        <Skeleton key={index} className="aspect-square rounded-lg" />
      ))}
    </div>
  );
}
