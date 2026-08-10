import { useCallback, useMemo } from 'react';
import { useNostr } from '@nostrify/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useRelays } from '@/hooks/useRelays';
import { useToast } from '@/hooks/useToast';
import { canonicalTargets } from '@/lib/relayRouting';
import {
  conversationKey,
  createDirectMessage,
  rumorToMessage,
  unwrapMany,
  DM_RELAY_LIST_KIND,
  GIFT_WRAP_KIND,
  type ChatMessage,
} from '@/lib/nip17';

/**
 * Decrypted wraps, per account.
 *
 * Module scope rather than a ref: the page and the open thread both call
 * `useDirectMessages`, and a per-instance cache would go cold whenever the one
 * that happened to fetch unmounted, re-decrypting the whole inbox.
 */
const decryptCaches = new Map<string, Map<string, ChatMessage | null>>();

function decryptCacheFor(pubkey: string | undefined) {
  const key = pubkey ?? '';
  let cache = decryptCaches.get(key);
  if (!cache) {
    cache = new Map();
    decryptCaches.set(key, cache);
  }
  return cache;
}

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
  const { relays: configuredRelays } = useRelays();
  const { data: ownDmRelays } = useDmRelays(user?.pubkey);

  // Survives refetches and remounts, so only new wraps are ever decrypted
  const decrypted = decryptCacheFor(user?.pubkey);

  /**
   * Senders following NIP-17 publish gift wraps *only* to the relays the
   * recipient nominated in their kind 10050 list. Reading from the app's
   * configured relays alone means messages sent correctly are never seen, so
   * the inbox is the union of both sets.
   */
  const inboxRelays = useMemo(() => {
    const configured = configuredRelays
      .filter((relay) => relay.read)
      .map((relay) => relay.url);

    // Canonical, because a kind 10050 list is written by other clients and
    // may spell a relay we are already connected to with a trailing slash —
    // which the pool would answer with a second socket to the same relay
    return canonicalTargets([...(ownDmRelays ?? []), ...configured]);
  }, [ownDmRelays, configuredRelays]);

  const query = useQuery({
    queryKey: ['direct-messages', user?.pubkey, inboxRelays.join(',')],
    queryFn: async (c) => {
      if (!user) return [] as ChatMessage[];

      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(8000)]);
      const filters = [
        { kinds: [GIFT_WRAP_KIND], '#p': [user.pubkey], limit: 500 },
      ];

      const wraps = inboxRelays.length
        ? await nostr.group(inboxRelays).query(filters, { signal })
        : await nostr.query(filters, { signal });

      const messages = await unwrapMany(user.signer, wraps, decrypted);

      // The sender receives a copy of their own message, so ids can repeat
      const byId = new Map<string, ChatMessage>();
      for (const message of messages) {
        byId.set(message.id, message);
      }

      return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt);
    },
    enabled: !!user,
    // Cached decryption makes refetching cheap, so the inbox can stay fresh
    staleTime: 15 * 1000,
    refetchInterval: 15 * 1000,
  });

  // Just-sent messages, until the relay echo replaces them
  const { data: pending } = useQuery<ChatMessage[]>({
    queryKey: pendingKey(user?.pubkey),
    queryFn: () => [],
    enabled: !!user,
    staleTime: Infinity,
  });

  const messages = useMemo<ChatMessage[]>(() => {
    const confirmed = query.data ?? [];
    if (!pending?.length) return confirmed;

    const known = new Set(confirmed.map((message) => message.id));
    const stillPending = pending.filter((message) => !known.has(message.id));

    return [...stillPending, ...confirmed].sort(
      (a, b) => b.createdAt - a.createdAt
    );
  }, [query.data, pending]);

  const { readAt } = useChatReadState();

  const conversations = useMemo<Conversation[]>(() => {
    if (!user) return [];

    const grouped = new Map<string, ChatMessage[]>();
    for (const message of messages) {
      const key = conversationKey(message, user.pubkey);
      const bucket = grouped.get(key);
      if (bucket) bucket.push(message);
      else grouped.set(key, [message]);
    }

    return [...grouped.entries()]
      .map(([key, entries]) => {
        const ordered = entries.sort((a, b) => a.createdAt - b.createdAt);
        const lastMessage = ordered[ordered.length - 1];

        return {
          key,
          participants: key.split(',').filter(Boolean),
          messages: ordered,
          lastMessage,
          // Your own message is never unread, however recently it arrived
          unread:
            lastMessage.pubkey !== user.pubkey &&
            lastMessage.createdAt > (readAt[key] ?? 0),
        };
      })
      .sort((a, b) => b.lastMessage.createdAt - a.lastMessage.createdAt);
  }, [messages, user, readAt]);

  return {
    conversations,
    messages,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}

/**
 * Per-conversation read markers. Local rather than published, since which
 * threads you have opened is device state and nobody else's business.
 */
export function useChatReadState() {
  const [readAt, setReadAt] = useLocalStorage<Record<string, number>>(
    'nostr:chat-read-at',
    {}
  );

  const markRead = useCallback(
    (key: string, timestamp: number) => {
      setReadAt((current) =>
        (current[key] ?? 0) >= timestamp
          ? current
          : { ...current, [key]: timestamp }
      );
    },
    [setReadAt]
  );

  return { readAt, markRead };
}

/** Number of conversations with something new in them. */
export function useUnreadChatCount(): number {
  const { conversations } = useDirectMessages();
  return conversations.filter((conversation) => conversation.unread).length;
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

/**
 * Messages sent from this device that no relay has echoed back yet.
 *
 * Held in its own cache entry so refetching the inbox can't wipe them, and
 * merged into the thread by id — once the real copy arrives it takes over
 * without the bubble ever flickering or doubling.
 */
function pendingKey(pubkey: string | undefined) {
  return ['direct-messages-pending', pubkey];
}

/** Sends a NIP-17 private message to one or more recipients. */
export function useSendDirectMessage() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const appendMessage = (message: ChatMessage) => {
    queryClient.setQueryData<ChatMessage[]>(pendingKey(user?.pubkey), (current) => [
      ...(current ?? []),
      message,
    ]);
  };

  const removeMessage = (id: string) => {
    queryClient.setQueryData<ChatMessage[]>(pendingKey(user?.pubkey), (current) =>
      (current ?? []).filter((message) => message.id !== id)
    );
  };

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

      const { rumor, wraps } = await createDirectMessage(
        user.signer,
        user.pubkey,
        recipients,
        content.trim(),
        { replyTo, subject }
      );

      // Show it straight away. Waiting for a relay to accept the wrap and echo
      // it back leaves the composer looking like it swallowed the message.
      appendMessage(rumorToMessage(rumor));

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
          const urls = canonicalTargets(
            (latest?.tags ?? [])
              .filter(([name]) => name === 'relay')
              .map(([, url]) => url)
          );

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
        // Nothing was delivered, so the optimistic bubble would be a lie
        removeMessage(rumor.id);
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
