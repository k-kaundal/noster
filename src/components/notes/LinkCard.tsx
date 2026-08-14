import { useState } from 'react';
import { ArrowUpRight, Globe } from 'lucide-react';
import { readLink } from '@/lib/linkPreview';
import { cn } from '@/lib/utils';

/**
 * Where a link goes, as a card rather than a coloured string.
 *
 * A note about an article used to render as raw `https://` and nothing else,
 * so deciding whether to tap meant reading a URL character by character. The
 * domain is what a person actually wants — everything else on this card is
 * secondary to "is this the site I trust".
 *
 * Built from the URL alone. No page is fetched: reading somebody else's title
 * and thumbnail from a browser needs a CORS proxy, and that means handing
 * every link in the feed, and the reader's IP, to a third party.
 */
export function LinkCard({
  url,
  className,
}: {
  url: string;
  className?: string;
}) {
  const [iconFailed, setIconFailed] = useState(false);
  const link = readLink(url);

  if (!link) return null;

  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      /*
       * `not-prose` and the explicit colours because this sits inside note
       * bodies that style their own links — without it the card inherits the
       * underline and accent meant for inline text.
       */
      className={cn(
        'group flex items-center gap-3 rounded-xl border bg-muted/30 p-3 no-underline transition-colors',
        'active:bg-muted/60 lg:hover:border-primary/40 lg:hover:bg-muted/50',
        className
      )}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-background">
        {iconFailed ? (
          <Globe className="h-4 w-4 text-muted-foreground" />
        ) : (
          <img
            src={link.faviconUrl}
            alt=""
            width={20}
            height={20}
            loading="lazy"
            /*
             * A site with no favicon, or one that blocks the request, is the
             * common case rather than the exception — the globe is the design,
             * not a fallback nobody sees.
             */
            onError={() => setIconFailed(true)}
            className="h-5 w-5 object-contain"
          />
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-foreground">
          {link.domain}
        </span>
        {link.path && (
          <span className="block truncate text-xs text-muted-foreground">
            {link.path}
          </span>
        )}
      </span>

      <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform lg:group-hover:-translate-y-0.5 lg:group-hover:translate-x-0.5 lg:group-hover:text-primary" />
    </a>
  );
}
