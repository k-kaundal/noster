import { useMemo, useState } from 'react';
import { type NostrEvent } from '@nostrify/nostrify';
import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { useAuthor } from '@/hooks/useAuthor';
import { useLightbox } from '@/hooks/useLightbox';
import { UserHoverCard } from '@/components/UserHoverCard';
import { genUserName } from '@/lib/genUserName';
import { cn } from '@/lib/utils';

interface NoteContentProps {
  event: NostrEvent;
  className?: string;
}

type Media =
  | { type: 'image'; url: string }
  | { type: 'video'; url: string }
  | { type: 'youtube'; url: string; id: string }
  | { type: 'vimeo'; url: string; id: string };

const TOKEN_REGEX =
  /(https?:\/\/[^\s<>"']+)|nostr:((?:npub1|note1|nprofile1|nevent1|naddr1)[023456789acdefghjklmnpqrstuvwxyz]+)|(^|\s)(#[\p{L}\p{N}_]+)/giu;

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|bmp|svg)(\?[^\s]*)?$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v)(\?[^\s]*)?$/i;

function classifyUrl(url: string): Media | null {
  if (IMAGE_EXT.test(url)) return { type: 'image', url };
  if (VIDEO_EXT.test(url)) return { type: 'video', url };

  const youtube = url.match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/i
  );
  if (youtube) return { type: 'youtube', url, id: youtube[1] };

  const vimeo = url.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
  if (vimeo) return { type: 'vimeo', url, id: vimeo[1] };

  return null;
}

/**
 * Renders the plaintext `content` of a note: URLs, Nostr references and
 * hashtags become links, while images and videos are lifted out of the text
 * and embedded below it so the same URL is never shown twice.
 */
export function NoteContent({ event, className }: NoteContentProps) {
  const { inline, media } = useMemo(() => {
    const text = event.content.trim();
    const inline: React.ReactNode[] = [];
    const media: Media[] = [];
    const seenMedia = new Set<string>();

    const pushMedia = (item: Media) => {
      if (seenMedia.has(item.url)) return;
      seenMedia.add(item.url);
      media.push(item);
    };

    // Picture and video posts carry their media in imeta tags rather than in
    // the body, so a note with tags but no text is not actually empty.
    for (const tag of event.tags) {
      if (tag[0] !== 'imeta') continue;
      const urlField = tag.find((part) => part.startsWith('url '));
      if (!urlField) continue;

      const url = urlField.slice(4).trim();
      const mimeField = tag.find((part) => part.startsWith('m '));
      const mime = mimeField?.slice(2).trim();

      if (mime?.startsWith('audio/')) continue;
      if (mime?.startsWith('video/')) {
        pushMedia({ type: 'video', url });
        continue;
      }
      const classified = classifyUrl(url);
      pushMedia(classified ?? { type: 'image', url });
    }

    let lastIndex = 0;
    let key = 0;
    let match: RegExpExecArray | null;

    // `lastIndex` state is per-call, so the regex is rebuilt on every parse
    const regex = new RegExp(TOKEN_REGEX.source, TOKEN_REGEX.flags);

    const pushText = (value: string) => {
      if (value) inline.push(value);
    };

    while ((match = regex.exec(text)) !== null) {
      const [full, url, nostrRef, hashtagLead, hashtag] = match;

      pushText(text.slice(lastIndex, match.index));
      lastIndex = match.index + full.length;

      if (url) {
        const asMedia = classifyUrl(url);
        if (asMedia) {
          pushMedia(asMedia);
          continue;
        }
        inline.push(
          <a
            key={`url-${key++}`}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="break-words font-medium text-primary underline-offset-2 hover:underline"
          >
            {url}
          </a>
        );
        continue;
      }

      if (nostrRef) {
        try {
          const decoded = nip19.decode(nostrRef);
          if (decoded.type === 'npub') {
            inline.push(
              <NostrMention key={`mention-${key++}`} pubkey={decoded.data} />
            );
          } else if (decoded.type === 'nprofile') {
            inline.push(
              <NostrMention
                key={`mention-${key++}`}
                pubkey={decoded.data.pubkey}
              />
            );
          } else {
            inline.push(
              <Link
                key={`ref-${key++}`}
                to={`/${nostrRef}`}
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                {`${nostrRef.slice(0, 12)}…`}
              </Link>
            );
          }
        } catch {
          pushText(full);
        }
        continue;
      }

      if (hashtag) {
        // The leading space is part of the match, so it is re-emitted here
        pushText(hashtagLead);
        inline.push(
          <Link
            key={`hashtag-${key++}`}
            to={`/t/${encodeURIComponent(hashtag.slice(1).toLowerCase())}`}
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            {hashtag}
          </Link>
        );
      }
    }

    pushText(text.slice(lastIndex));

    return { inline, media };
  }, [event.content, event.tags]);

  return (
    <div className={cn('space-y-3', className)}>
      {inline.length > 0 && (
        <div className="whitespace-pre-wrap break-words text-base leading-relaxed sm:text-base text-sm">
          {inline}
        </div>
      )}
      {media.length > 0 && <MediaGrid media={media} />}
    </div>
  );
}

function MediaGrid({ media }: { media: Media[] }) {
  // The lightbox steps through a note's images, so it needs them all up front
  const images = media
    .filter((item) => item.type === 'image')
    .map((item) => item.url);

  return (
    <div
      className={cn(
        'grid gap-2',
        media.length > 1 ? 'grid-cols-2' : 'grid-cols-1'
      )}
    >
      {media.map((item, index) => (
        <MediaItem
          key={`${item.url}-${index}`}
          item={item}
          images={images}
          // A lone image keeps its aspect ratio; grids stay on a tidy square
          fill={media.length > 1}
        />
      ))}
    </div>
  );
}

function MediaItem({
  item,
  fill,
  images,
}: {
  item: Media;
  fill: boolean;
  images: string[];
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const { open } = useLightbox();

  if (item.type === 'image') {
    if (failed) {
      return (
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center rounded-lg border border-dashed p-4 text-xs text-muted-foreground hover:bg-accent/60"
        >
          Image failed to load — open original
        </a>
      );
    }

    return (
      <button
        type="button"
        onClick={() => open(images, images.indexOf(item.url))}
        aria-label="View image"
        className={cn(
          'block w-full cursor-zoom-in overflow-hidden rounded-lg border bg-muted',
          // A note's own images arrive with no dimensions, so the card grows
          // when each one lands and shoves the rest of the feed down the page.
          // Holding a minimum height until then keeps the scroll position
          // where the reader put it.
          !loaded && !fill && 'min-h-48 animate-pulse'
        )}
      >
        <img
          src={item.url}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={cn(
            'w-full transition-opacity duration-300 hover:opacity-95',
            loaded ? 'opacity-100' : 'opacity-0',
            fill ? 'aspect-square object-cover' : 'max-h-[32rem] object-contain'
          )}
        />
      </button>
    );
  }

  if (item.type === 'video') {
    return (
      <video
        controls
        preload="metadata"
        // Letterboxing stays black in both themes, as video players conventionally do
        className="w-full rounded-lg border bg-black"
      >
        <source src={item.url} />
        Your browser does not support the video tag.
      </video>
    );
  }

  const src =
    item.type === 'youtube'
      ? `https://www.youtube-nocookie.com/embed/${item.id}`
      : `https://player.vimeo.com/video/${item.id}`;

  return (
    <iframe
      src={src}
      title={item.type === 'youtube' ? 'YouTube video' : 'Vimeo video'}
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowFullScreen
      loading="lazy"
      className="aspect-video w-full rounded-lg border"
    />
  );
}

/** Inline `@name` link for a mentioned pubkey. */
function NostrMention({ pubkey }: { pubkey: string }) {
  const author = useAuthor(pubkey);
  const npub = nip19.npubEncode(pubkey);
  const hasRealName = !!author.data?.metadata?.name;
  const displayName = author.data?.metadata?.name ?? genUserName(pubkey);

  return (
    <UserHoverCard pubkey={pubkey}>
      <Link
        to={`/${npub}`}
        className={cn(
          'font-medium underline-offset-2 hover:underline',
          hasRealName ? 'text-primary' : 'text-muted-foreground'
        )}
        title={`View @${displayName}'s profile`}
      >
        @{displayName}
      </Link>
    </UserHoverCard>
  );
}
