import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { formatDistanceToNow } from 'date-fns';
import { AtSign, MessageCircle, Repeat2, Zap } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useAuthor } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';
import { formatSats } from '@/lib/zap';
import type { Notification } from '@/lib/notifications';
import { cn } from '@/lib/utils';

const TYPE_META = {
  mention: { icon: AtSign, label: 'mentioned you', tone: 'text-reply' },
  reply: { icon: MessageCircle, label: 'replied to you', tone: 'text-reply' },
  reaction: { icon: null, label: 'reacted to your note', tone: 'text-like' },
  repost: { icon: Repeat2, label: 'reposted your note', tone: 'text-repost' },
  zap: { icon: Zap, label: 'zapped you', tone: 'text-zap' },
} as const;

interface NotificationRowProps {
  notification: Notification;
  unread?: boolean;
  /** Denser layout for the header popover. */
  compact?: boolean;
}

export function NotificationRow({
  notification,
  unread = false,
  compact = false,
}: NotificationRowProps) {
  const author = useAuthor(notification.pubkey);
  const metadata = author.data?.metadata;
  const displayName =
    metadata?.display_name || metadata?.name || genUserName(notification.pubkey);

  const meta = TYPE_META[notification.type];
  const Icon = meta.icon;

  const label =
    notification.type === 'zap' && notification.amountSats
      ? `zapped you ${formatSats(notification.amountSats)} sats`
      : meta.label;

  // Reactions, reposts and zaps point at the note they targeted. A mention has
  // no target, so it links to itself.
  const href = notification.targetEventId
    ? `/${nip19.noteEncode(notification.targetEventId)}`
    : `/${nip19.noteEncode(notification.event.id)}`;

  return (
    <li className={cn(unread && 'bg-primary/5')}>
      <Link
        to={href}
        className={cn(
          'flex items-start gap-3 transition-colors hover:bg-accent/60',
          compact ? 'px-4 py-3' : 'px-4 py-3.5 sm:px-5'
        )}
      >
        <div className="relative shrink-0">
          <Avatar className={compact ? 'h-8 w-8' : 'h-9 w-9'}>
            <AvatarImage src={metadata?.picture} alt="" />
            <AvatarFallback className="text-[10px]">
              {displayName.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>

          <span
            className={cn(
              'absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-background text-[10px] leading-none',
              meta.tone
            )}
          >
            {Icon ? (
              <Icon className="h-3.5 w-3.5" />
            ) : (
              // The reaction itself is more informative than a generic heart
              <span aria-hidden>{notification.content.slice(0, 2)}</span>
            )}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug">
            <span className="font-medium">{displayName}</span>{' '}
            <span className="text-muted-foreground">{label}</span>
          </p>

          {notification.type !== 'reaction' && notification.content && (
            <p
              className={cn(
                'mt-1 break-words text-sm text-muted-foreground',
                compact ? 'line-clamp-2' : 'line-clamp-3'
              )}
            >
              {notification.content}
            </p>
          )}

          <p className="mt-1 text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(notification.createdAt * 1000), {
              addSuffix: true,
            })}
          </p>
        </div>
      </Link>
    </li>
  );
}
