import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { timeAgo } from '@/lib/time';
import { BadgeCheck } from 'lucide-react';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { genUserName } from '@/lib/genUserName';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import type { Conversation } from '@/hooks/useDirectMessages';
import { cn } from '@/lib/utils';

interface ConversationListProps {
  conversations: Conversation[];
  activeKey?: string;
  isLoading?: boolean;
}

export function ConversationList({
  conversations,
  activeKey,
  isLoading,
}: ConversationListProps) {
  if (isLoading) {
    return (
      <ul className="divide-y">
        {Array.from({ length: 5 }).map((_, i) => (
          <li key={i} className="flex items-center gap-3 p-3">
            <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-3 w-40" />
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <ul className="divide-y">
      {conversations.map((conversation) => (
        <ConversationRow
          key={conversation.key}
          conversation={conversation}
          isActive={conversation.key === activeKey}
        />
      ))}
    </ul>
  );
}

function ConversationRow({
  conversation,
  isActive,
}: {
  conversation: Conversation;
  isActive: boolean;
}) {
  const { user } = useCurrentUser();
  // Group threads are labelled by their first participant plus a count
  const primary = conversation.participants[0] ?? conversation.key;
  const author = useAuthor(primary);
  const metadata = author.data?.metadata;

  const displayName =
    metadata?.display_name || metadata?.name || genUserName(primary);
  const isGroup = conversation.participants.length > 1;
  const isSelf = conversation.participants.length === 0;
  const fromMe = conversation.lastMessage.pubkey === user?.pubkey;

  const label = isSelf
    ? 'Notes to self'
    : isGroup
      ? `${displayName} +${conversation.participants.length - 1}`
      : displayName;

  return (
    <li>
      <Link
        to={`/chat/${nip19.npubEncode(primary)}`}
        className={cn(
          'flex items-center gap-3 p-3 transition-colors hover:bg-accent/60',
          isActive && 'bg-accent'
        )}
      >
        <Avatar className="h-10 w-10 shrink-0">
          <AvatarImage src={metadata?.picture} alt="" />
          <AvatarFallback className="text-xs">
            {label.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="truncate text-sm font-semibold">{label}</span>
            {metadata?.nip05 && !isGroup && (
              <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
            )}
            <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
              {timeAgo(conversation.lastMessage.createdAt * 1000)}
            </span>
          </div>

          <p
            className={cn(
              'truncate text-xs',
              conversation.unread
                ? 'font-medium text-foreground'
                : 'text-muted-foreground'
            )}
          >
            {fromMe && <span className="text-foreground/70">You: </span>}
            {conversation.lastMessage.content}
          </p>
        </div>

        {conversation.unread && (
          <span
            className="h-2 w-2 shrink-0 rounded-full bg-primary"
            aria-label="Unread"
          />
        )}
      </Link>
    </li>
  );
}
