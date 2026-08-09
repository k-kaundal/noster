import { useMemo } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useAuthors } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';
import { cn } from '@/lib/utils';

interface AvatarStackProps {
  pubkeys: string[];
  /** How many faces to show before the rest become a count. */
  max?: number;
  className?: string;
}

/**
 * A row of overlapping faces, for the people behind something.
 *
 * A count on its own ("14 moderators") says how many without saying who,
 * which is the part worth knowing when deciding whether to open a place.
 * Faces answer that at a glance, and are recognisable long before a name is
 * read.
 *
 * Only the faces shown are fetched. The overflow stays a number rather than
 * loading profiles nobody will see.
 */
export function AvatarStack({ pubkeys, max = 8, className }: AvatarStackProps) {
  const shown = useMemo(() => pubkeys.slice(0, max), [pubkeys, max]);
  const overflow = pubkeys.length - shown.length;
  const authors = useAuthors(shown);

  if (!pubkeys.length) return null;

  return (
    <div className={cn('flex items-center -space-x-2', className)}>
      {authors.map(({ pubkey, metadata }) => {
        const name = metadata?.display_name || metadata?.name || genUserName(pubkey);

        return (
          <Avatar
            key={pubkey}
            // The ring separates one face from the next; without it a row of
            // dark avatars reads as a single smudge
            className="h-7 w-7 ring-2 ring-card"
            title={name}
          >
            <AvatarImage src={metadata?.picture} alt="" />
            <AvatarFallback className="text-[10px]">
              {name.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        );
      })}

      {overflow > 0 && (
        <span className="flex h-7 items-center rounded-full bg-muted px-2 text-[10px] font-medium text-muted-foreground ring-2 ring-card">
          +{overflow}
        </span>
      )}
    </div>
  );
}
