import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { ArrowDownLeft, ArrowUpRight, Coins, Zap } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { useAuthor } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';
import { relativeTime } from '@/lib/time';
import {
  describeTransaction,
  isEcash,
  type WalletTransaction,
} from '@/lib/walletTransaction';
import { cn } from '@/lib/utils';

const ICONS = {
  zap: Zap,
  lightning: ArrowUpRight,
  ecash: Coins,
} as const;

/**
 * One movement, said in full.
 *
 * The reason it happened is the headline and the amount is beside it, rather
 * than the other way round — "+10,000 sats" answers a question nobody had, and
 * "Ecash minted at mint.nostrfeed.com" answers the one they did.
 */
export function TransactionCard({
  transaction,
  className,
}: {
  transaction: WalletTransaction;
  className?: string;
}) {
  const label = describeTransaction(transaction);
  const incoming = transaction.direction === 'incoming';

  const counterparty = incoming ? transaction.sender : transaction.receiver;
  const author = useAuthor(counterparty?.pubkey);
  const metadata = author.data?.metadata;

  const name =
    counterparty?.name ||
    metadata?.name ||
    metadata?.display_name ||
    (counterparty?.pubkey ? genUserName(counterparty.pubkey) : undefined);

  const Icon =
    label.icon === 'lightning' && incoming ? ArrowDownLeft : ICONS[label.icon];

  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-muted/50',
        className
      )}
    >
      <div
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
          isEcash(transaction.type)
            ? 'bg-primary/10 text-primary'
            : incoming
              ? 'bg-success/10 text-success-strong'
              : 'bg-muted text-muted-foreground'
        )}
      >
        <Icon className="h-4 w-4" />
      </div>

      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">{label.title}</p>
          {transaction.status === 'pending' && (
            <Badge variant="outline" className="h-4 px-1 text-[10px] font-normal">
              waiting
            </Badge>
          )}
          {transaction.status === 'failed' && (
            <Badge variant="outline" className="h-4 px-1 text-[10px] font-normal text-destructive">
              failed
            </Badge>
          )}
        </div>

        {/* Who, when there is a who — a zap has one, a mint quote does not */}
        {counterparty?.pubkey ? (
          <Link
            to={`/${nip19.npubEncode(counterparty.pubkey)}`}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <Avatar className="h-4 w-4">
              <AvatarImage src={counterparty.avatar ?? metadata?.picture} alt="" />
              <AvatarFallback className="text-[8px]">
                {(name ?? '??').slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            {name}
          </Link>
        ) : (
          label.detail && (
            <p className="truncate text-xs text-muted-foreground">
              {label.detail}
            </p>
          )
        )}

        {transaction.nostr?.comment && (
          <p className="line-clamp-2 text-xs italic text-muted-foreground">
            “{transaction.nostr.comment}”
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          {relativeTime(transaction.timestamp * 1000)}
          {transaction.fee !== undefined && transaction.fee > 0 && (
            <> · {transaction.fee.toLocaleString()} sats fee</>
          )}
        </p>
      </div>

      <p
        className={cn(
          'shrink-0 font-mono text-sm font-medium tabular-nums',
          incoming && 'text-success-strong',
          transaction.status !== 'settled' && 'text-muted-foreground'
        )}
      >
        {incoming ? '+' : '−'}
        {transaction.amount.toLocaleString()}
      </p>
    </div>
  );
}
