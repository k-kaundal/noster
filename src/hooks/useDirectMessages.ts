import { useMemo } from 'react';
import { useNostr } from '@nostrify/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useToast } from '@/hooks/useToast';
import {
  conversationKey,
  createDirectMessage,
  unwrapDirectMessage,
  DM_RELAY_LIST_KIND,
  GIFT_WRAP_KIND,
  type ChatMessage,
} from '@/lib/nip17';

export interface Conversation {
  /** Sorted, comma-joined pubkeys of everyone except the current user. */
  key: string;
  participants: string[];
  lastMessage: ChatMessage;
  messages: ChatMessage[];
  unread: boolean;
}

/**
 * Every private message the current user can read.
 *
 * Gift wraps carry randomized timestamps up to two days in the past, so the
 * query window reaches further back than the messages it is looking for.
 */
export function useDirectMessages() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  const query = useQuery({
    queryKey: ['direct-messages', user?.pubkey],
    queryFn: async (c) => {
      if (!user) return [] as ChatMessage[];

      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(8000)]);
      const wraps = await nostr.query(
        [{ kinds: [GIFT_WRAP_KIND], '#p': [user.pubkey], limit: 500 }],
        { signal }
      );

      const messages = await Promise.all(
        wraps.map((wrap) => unwrapDirectMessage(user.signer, wrap))
      );

      // The sender receives a copy of their own message, so ids can repeat
      const byId = new Map<string, ChatMessage>();
      for (const message of messages) {
        if (message) byId.set(message.id, message);
      }

      return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt);
    },
    enabled: !!user,
    // Decrypting hundreds of wraps is expensive, so results are held a while
    staleTime: 60 * 1000,
    refetchInterval: 30 * 1000,
  });

  const conversations = useMemo<Conversation[]>(() => {
    if (!user || !query.data) return [];

    const grouped = new Map<string, ChatMessage[]>();
    for (const message of query.data) {
      const key = conversationKey(message, user.pubkey);
      const bucket = grouped.get(key);
      if (bucket) bucket.push(message);
      else grouped.set(key, [message]);
    }

    return [...grouped.entries()]
      .map(([key, messages]) => {
        const ordered = messages.sort((a, b) => a.createdAt - b.createdAt);
        return {
          key,
          participants: key.split(',').filter(Boolean),
          messages: ordered,
          lastMessage: ordered[ordered.length - 1],
          unread: false,
        };
      })
      .sort((a, b) => b.lastMessage.createdAt - a.lastMessage.createdAt);
  }, [query.data, user]);

  return {
    conversations,
    messages: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}

/** Messages exchanged with one peer, oldest first. */
export function useChatThread(peerPubkey: string | undefined) {
  const { conversations, isLoading, isError } = useDirectMessages();

  const conversation = useMemo(
    () => conversations.find((entry) => entry.key === peerPubkey),
    [conversations, peerPubkey]
  );

  return {
    messages: conversation?.messages ?? [],
    isLoading,
    isError,
  };
}

/**
 * The relays a user wants their private messages delivered to (NIP-17
 * kind 10050). Publishing anywhere else means the recipient never sees it.
 */
export function useDmRelays(pubkey: string | undefined) {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['dm-relays', pubkey],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(4000)]);
      const events = await nostr.query(
        [{ kinds: [DM_RELAY_LIST_KIND], authors: [pubkey as string], limit: 1 }],
        { signal }
      );

      const latest = events.sort((a, b) => b.created_at - a.created_at)[0];
      if (!latest) return [] as string[];

      return latest.tags
        .filter(([name]) => name === 'relay')
        .map(([, url]) => url)
        .filter(Boolean);
    },
    enabled: !!pubkey,
    staleTime: 10 * 60 * 1000,
  });
}

/** Sends a NIP-17 private message to one or more recipients. */
export function useSendDirectMessage() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      recipients,
      content,
      replyTo,
      subject,
    }: {
      recipients: string[];
      content: string;
      replyTo?: string;
      subject?: string;
    }) => {
      if (!user) throw new Error('You must be logged in to send a message');
      if (!content.trim()) throw new Error('Message is empty');

      const wraps = await createDirectMessage(
        user.signer,
        user.pubkey,
        recipients,
        content.trim(),
        { replyTo, subject }
      );

      /**
       * NIP-17 requires each wrap to go to the relays its recipient nominated
       * in their kind 10050 list — publishing elsewhere means they may simply
       * never see it. Recipients without a list fall back to the default
       * routing, which is the best that can be done for them.
       */
      const relaysFor = async (pubkey: string): Promise<string[]> => {
        const cacheKey = ['dm-relays', pubkey];
        const cached = queryClient.getQueryData<string[]>(cacheKey);
        if (cached) return cached;

        try {
          const events = await nostr.query(
            [{ kinds: [DM_RELAY_LIST_KIND], authors: [pubkey], limit: 1 }],
            { signal: AbortSignal.timeout(4000) }
          );
          const latest = events.sort((a, b) => b.created_at - a.created_at)[0];
          const urls = (latest?.tags ?? [])
            .filter(([name]) => name === 'relay')
            .map(([, url]) => url)
            .filter(Boolean);

          queryClient.setQueryData(cacheKey, urls);
          return urls;
        } catch {
          return [];
        }
      };

      const audience = [...new Set(recipients)].filter(Boolean);
      // Wraps come back in recipient order, with the sender's copy last
      const targets = [...audience, user.pubkey];

      const results = await Promise.allSettled(
        wraps.map(async (wrap, index) => {
          const urls = await relaysFor(targets[index]);
          const signal = AbortSignal.timeout(8000);

          return urls.length
            ? nostr.group(urls).event(wrap, { signal })
            : nostr.event(wrap, { signal });
        })
      );

      // The recipient's copy is the one that matters; the self-copy is history
      if (results.slice(0, audience.length).every((r) => r.status === 'rejected')) {
        throw new Error('No relay accepted the message');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['direct-messages', user?.pubkey],
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Message not sent',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}
