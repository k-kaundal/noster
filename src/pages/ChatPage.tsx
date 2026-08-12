import { useParams } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { MessagesSquare, ShieldCheck } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { ConversationList } from '@/components/chat/ConversationList';
import { ChatThread } from '@/components/chat/ChatThread';
import { Card } from '@/components/ui/card';
import { LoginArea } from '@/components/auth/LoginArea';
import { useDirectMessages } from '@/hooks/useDirectMessages';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useSeo } from '@/hooks/useSeo';
import { cn } from '@/lib/utils';

/** Decodes the `npub`/`nprofile` in the route to a raw pubkey. */
function usePeerPubkey(): string | undefined {
  const { npub } = useParams<{ npub: string }>();
  if (!npub) return undefined;

  try {
    const decoded = nip19.decode(npub);
    if (decoded.type === 'npub') return decoded.data;
    if (decoded.type === 'nprofile') return decoded.data.pubkey;
    return undefined;
  } catch {
    return undefined;
  }
}

export function ChatPage() {
  useSeo({
    title: 'Messages',
    description:
      'End-to-end encrypted private messages on Nostr, using NIP-17 sealed and gift-wrapped events.',
    path: '/chat',
    noindex: true,
  });

  const { user } = useCurrentUser();
  const peerPubkey = usePeerPubkey();
  const { conversations, isLoading, isError } = useDirectMessages();

  if (!user) {
    return (
      <Layout>
        <div className="space-y-5">
          <PageHeader icon={MessagesSquare} title="Messages" />
          <EmptyState
            icon={ShieldCheck}
            title="Log in to read your messages"
            description="Private messages are encrypted to your key, so they can only be opened by you."
            action={<LoginArea className="mx-auto max-w-60" />}
          />
        </div>
      </Layout>
    );
  }

  return (
    <Layout fullWidth>
      <div className="space-y-4">
        <PageHeader
          icon={MessagesSquare}
          title="Messages"
          description="Sealed and gift-wrapped with NIP-17, so relays can't see who you're talking to."
        />

        {/* Below lg the list and thread swap places rather than sharing a row */}
        <Card
          /*
           * Two heights, because the chrome around this differs by more than
           * the old single value allowed for. On a phone there is a 56px
           * header, the page title, and a 96px bottom gap for the tab bar —
           * about 276px in total against the 224px this assumed, so the card
           * ran 52px past the bottom and took the message box with it. The
           * composer was under the tab bar and could not be reached.
           */
          className="grid h-[calc(100dvh-18rem)] overflow-hidden sm:h-[calc(100dvh-16rem)] lg:h-[calc(100dvh-15rem)] lg:grid-cols-[20rem_1fr]"
        >
          <div
            className={cn(
              'overflow-y-auto border-r scrollbar-thin',
              peerPubkey && 'hidden lg:block'
            )}
          >
            {isError ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                Couldn't load your messages from these relays.
              </p>
            ) : !isLoading && conversations.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                No conversations yet. Open someone's profile and start one.
              </p>
            ) : (
              <ConversationList
                conversations={conversations}
                activeKey={peerPubkey}
                isLoading={isLoading}
              />
            )}
          </div>

          <div className={cn('min-h-0', !peerPubkey && 'hidden lg:block')}>
            {peerPubkey ? (
              <ChatThread peerPubkey={peerPubkey} />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
                <MessagesSquare className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Pick a conversation to start reading.
                </p>
              </div>
            )}
          </div>
        </Card>
      </div>
    </Layout>
  );
}

export default ChatPage;
