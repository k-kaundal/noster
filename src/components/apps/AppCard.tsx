import { ExternalLink } from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { useAuthor } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';
import type { RankedApp } from '@/hooks/useAppDirectory';

/**
 * A card for one app in the directory.
 *
 * Shows what the app is called, who made it, what kinds it opens, and how
 * many people recommended it. The whole card links out to wherever the app
 * lives — nothing here runs inside NostrFeed.
 */
export function AppCard({ app }: { app: RankedApp }) {
  const { handler, recommendations } = app;

  const author = useAuthor(handler.author);
  const metadata = author.data?.metadata;
  const authorName =
    metadata?.display_name || metadata?.name || genUserName(handler.author);

  return (
    <Card className="transition-colors hover:bg-accent/50">
      <CardContent className="space-y-4 p-4">
        <div className="flex items-start gap-3">
          <Avatar className="h-10 w-10 shrink-0 rounded-lg">
            <AvatarImage src={handler.picture} alt="" className="rounded-lg" />
            <AvatarFallback className="rounded-lg text-sm">
              {handler.name.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>

          <div className="min-w-0 flex-1 space-y-1">
            <h3 className="font-semibold leading-tight">{handler.name}</h3>
            <p className="text-xs text-muted-foreground">by {authorName}</p>
          </div>
        </div>

        {handler.about && (
          <p className="line-clamp-2 text-sm text-muted-foreground">
            {handler.about}
          </p>
        )}

        <div className="flex flex-wrap gap-1">
          {handler.kinds.slice(0, 4).map((kind) => (
            <Badge key={kind} variant="secondary" className="text-xs">
              kind {kind}
            </Badge>
          ))}
          {handler.kinds.length > 4 && (
            <Badge variant="outline" className="text-xs">
              +{handler.kinds.length - 4} more
            </Badge>
          )}
        </div>

        <div className="flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
          <span>
            {recommendations} {recommendations === 1 ? 'person uses' : 'people use'} this
          </span>

          {handler.urlTemplate && (
            <a
              href={handler.urlTemplate.replace('<bech32>', '')}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-primary hover:underline"
            >
              Open
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
