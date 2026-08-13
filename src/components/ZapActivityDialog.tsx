import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { Zap } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuthor } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';
import { handleFor } from '@/lib/handle';
import { formatSats } from '@/lib/zap';
import type { ZapSummary, Zapper } from '@/lib/zapSummary';

/**
 * Who paid, and what they said.
 *
 * A total on its own is a number; this is the part people actually want from
 * it. It is also the part that makes the total checkable — every row here came
 * from a receipt that passed NIP-57 validation, so a reader can see the total
 * is made of named payments rather than taking it on faith.
 */
export function ZapActivityDialog({
  summary,
  open,
  onOpenChange,
}: {
  summary: ZapSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-zap/10">
              <Zap className="h-4 w-4 text-zap" />
            </div>
            Zaps
          </DialogTitle>
          <DialogDescription>
            {summary.count === 1
              ? 'One zap on this note.'
              : `${summary.count} zaps on this note.`}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          <ul className="space-y-1 pr-3">
            {summary.zappers.map((zapper) => (
              <ZapperRow key={zapper.receiptId} zapper={zapper} />
            ))}
          </ul>
        </ScrollArea>

        <div className="flex items-baseline justify-between border-t pt-3">
          <span className="text-sm text-muted-foreground">Total</span>
          <span className="tabular text-lg font-semibold text-zap">
            {summary.totalSats.toLocaleString()} sats
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ZapperRow({ zapper }: { zapper: Zapper }) {
  const author = useAuthor(zapper.pubkey);
  const metadata = author.data?.metadata;

  const displayName =
    metadata?.display_name || metadata?.name || genUserName(zapper.pubkey);
  const npub = nip19.npubEncode(zapper.pubkey);

  return (
    <li>
      <Link
        to={`/${npub}`}
        className="flex items-start gap-3 rounded-lg p-2 transition-colors hover:bg-muted/50"
      >
        <Avatar className="h-8 w-8 shrink-0">
          <AvatarImage src={metadata?.picture} alt="" />
          <AvatarFallback className="text-xs">
            {displayName.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-sm font-medium">{displayName}</span>
            <span className="tabular shrink-0 text-sm font-semibold text-zap">
              {formatSats(zapper.sats)}
            </span>
          </div>

          <p className="truncate text-xs text-muted-foreground">
            @{handleFor(metadata, zapper.pubkey)}
          </p>

          {/* The message, when there is one — half the reason people zap */}
          {zapper.comment && (
            <p className="mt-1 break-words text-sm text-foreground">
              {zapper.comment}
            </p>
          )}
        </div>
      </Link>
    </li>
  );
}
