import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';
import { formatDistanceToNow } from 'date-fns';
import { nip19 } from 'nostr-tools';
import { AtSign, Bell, Heart, Repeat2, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAuthor } from '@/hooks/useAuthor';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { genUserName } from '@/lib/genUserName';
import { cn } from '@/lib/utils';

const KIND_META = {
  1: { icon: AtSign, label: 'mentioned you', tone: 'text-reply' },
  6: { icon: Repeat2, label: 'reposted your note', tone: 'text-repost' },
  7: { icon: Heart, label: 'reacted to your note', tone: 'text-like' },
  9735: { icon: Zap, label: 'zapped you', tone: 'text-zap' },
} as const;

type NotificationKind = keyof typeof KIND_META;

function useNotifications(pubkey?: string) {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['notifications', pubkey],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(4000)]);

      const events = await nostr.query(
        [
          {
            kinds: [1, 6, 7, 9735],
            '#p': [pubkey as string],
            since: Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60,
            limit: 50,
          },
        ],
        { signal }
      );

      return events
        .filter((event) => event.pubkey !== pubkey)
        .sort((a, b) => b.created_at - a.created_at);
    },
    enabled: !!pubkey,
    refetchInterval: 5 * 60 * 1000,
  });
}

/** Bell button with an unread count and a preview list of recent activity. */
export function NotificationBadge() {
  const { user } = useCurrentUser();
  const { data: events, isLoading } = useNotifications(user?.pubkey);
  const [lastSeen, setLastSeen] = useLocalStorage<number>(
    'nostr:notifications-seen',
    0
  );

  const unreadCount = useMemo(
    () => (events ?? []).filter((event) => event.created_at > lastSeen).length,
    [events, lastSeen]
  );

  const markSeen = (open: boolean) => {
    if (open && events?.length) {
      setLastSeen(events[0].created_at);
    }
  };

  return (
    <Popover onOpenChange={markSeen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={
            unreadCount > 0
              ? `Notifications, ${unreadCount} unread`
              : 'Notifications'
          }
        >
          <Bell className="h-[1.2rem] w-[1.2rem]" />
          {unreadCount > 0 && (
            <span className="absolute right-1 top-1 flex min-w-[1.1rem] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-destructive-foreground">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-semibold">Notifications</h3>
          {unreadCount > 0 && (
            <span className="text-xs text-muted-foreground">
              {unreadCount} new
            </span>
          )}
        </div>

        {!user ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            Log in to see your notifications.
          </p>
        ) : isLoading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-2/3" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : !events?.length ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            Nothing yet. Mentions, reposts and zaps will show up here.
          </p>
        ) : (
          <ScrollArea className="max-h-96">
            <ul className="divide-y">
              {events.slice(0, 20).map((event) => (
                <NotificationRow
                  key={event.id}
                  event={event}
                  unread={event.created_at > lastSeen}
                />
              ))}
            </ul>
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  );
}

function NotificationRow({
  event,
  unread,
}: {
  event: NostrEvent;
  unread: boolean;
}) {
  const author = useAuthor(event.pubkey);
  const metadata = author.data?.metadata;
  const displayName =
    metadata?.display_name || metadata?.name || genUserName(event.pubkey);

  const meta = KIND_META[event.kind as NotificationKind] ?? KIND_META[1];
  const Icon = meta.icon;

  // Reactions and zaps point at the note they target; mentions link to themselves.
  const targetId =
    event.kind === 1
      ? event.id
      : event.tags.find(([name]) => name === 'e')?.[1] ?? event.id;

  return (
    <li className={cn(unread && 'bg-primary/5')}>
      <Link
        to={`/${nip19.noteEncode(targetId)}`}
        className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-accent/60"
      >
        <div className="relative">
          <Avatar className="h-8 w-8">
            <AvatarImage src={metadata?.picture} alt="" />
            <AvatarFallback className="text-[10px]">
              {displayName.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <Icon
            className={cn(
              'absolute -bottom-1 -right-1 h-4 w-4 rounded-full bg-background p-0.5',
              meta.tone
            )}
          />
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug">
            <span className="font-medium">{displayName}</span>{' '}
            <span className="text-muted-foreground">{meta.label}</span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(event.created_at * 1000), {
              addSuffix: true,
            })}
          </p>
        </div>
      </Link>
    </li>
  );
}
