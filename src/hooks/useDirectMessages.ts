import { useCallback, useEffect, useMemo } from 'react';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';
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
import { GIFT_WRAP_DRIFT } from '@/lib/nip59';
import { isPaidRelay } from '@/lib/paidRelay';

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

/**
 * The live subscriptions, one per account and relay set, shared by everything
 * that reads the inbox and stopped only when the last reader goes.
 */
const streams = new Map<string, { count: number; stop: () => void }>();

function release(key: string) {
  const entry = streams.get(key);
  if (!entry) return;

  entry.count -= 1;
  if (entry.count > 0) return;

  streams.delete(key);
  entry.stop();
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
    /*
     * A backstop now, not the way messages arrive. The subscription below is
     * what makes a message appear when it is sent; this catches whatever a
     * dropped socket missed, and refetching is cheap because decryption is
     * cached. Polling this often *was* the delivery mechanism, which is why a
     * message could sit unseen for fifteen seconds.
     */
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
  });

  useDirectMessageStream(inboxRelays, decrypted);

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

  /*
   * Which messages the relays have not echoed back yet. Kept as a set of ids
   * rather than a flag on the message so the shape a relay returns and the
   * shape we made locally stay identical — the difference is delivery state,
   * which belongs to this client and not to the message.
   */
  const pendingIds = useMemo(() => {
    const confirmed = new Set((query.data ?? []).map((message) => message.id));
    return new Set(
      (pending ?? [])
        .map((message) => message.id)
        .filter((id) => !confirmed.has(id))
    );
  }, [query.data, pending]);

  return {
    conversations,
    messages,
    pendingIds,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}

/**
 * Messages, as they arrive.
 *
 * Chat was polled — every fifteen seconds the whole inbox was fetched again,
 * so a message could be written, accepted by a relay, and still sit unseen for
 * most of a minute across the two clients involved. Relays already push: a
 * `REQ` left open delivers each event the moment it lands.
 *
 * The window is the part that is easy to get wrong. Subscribing with
 * `since: now` looks obviously right and receives nothing, because a gift wrap
 * carries a timestamp up to two days in the past — the relay matches the
 * filter against that, not against when the event showed up. So the window
 * reaches back the full drift, and the replay it pulls on connect is the
 * reconnect backfill.
 */
function useDirectMessageStream(
  inboxRelays: string[],
  decrypted: Map<string, ChatMessage | null>
) {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();

  const relayKey = inboxRelays.join(',');

  useEffect(() => {
    if (!user) return;

    /*
     * One socket however many callers there are. The conversation list and the
     * open thread both call this hook, and a subscription per caller would ask
     * every relay for the same events twice — paid for in bandwidth by the
     * relay operator, and in duplicate decrypt work here.
     */
    const shared = `${user.pubkey}|${relayKey}`;
    const running = streams.get(shared);
    if (running) {
      running.count += 1;
      return () => release(shared);
    }

    const controller = new AbortController();
    streams.set(shared, { count: 1, stop: () => controller.abort() });

    const key = ['direct-messages', user.pubkey, relayKey];

    /** Merges one message in, newest first, without disturbing the rest. */
    const receive = (message: ChatMessage) => {
      queryClient.setQueryData<ChatMessage[]>(key, (current) => {
        const existing = current ?? [];
        if (existing.some((entry) => entry.id === message.id)) return existing;

        return [...existing, message].sort((a, b) => b.createdAt - a.createdAt);
      });
    };

    void (async () => {
      /*
       * Relays close subscriptions — on their own timers, on deploys, and
       * whenever a laptop sleeps. Without this the stream ends silently and
       * chat quietly reverts to the one-minute poll, which is the failure it
       * was built to remove. Backs off so a relay that refuses is not hammered.
       */
      let delay = 1000;

      while (!controller.signal.aborted) {
        try {
          const relay = inboxRelays.length
            ? nostr.group(inboxRelays)
            : nostr;

          const filters = [
            {
              kinds: [GIFT_WRAP_KIND],
              '#p': [user.pubkey],
              since: Math.floor(Date.now() / 1000) - GIFT_WRAP_DRIFT,
            },
          ];

          for await (const message of relay.req(filters, {
            signal: controller.signal,
          })) {
            if (message[0] !== 'EVENT') continue;

            // Connected and being served, so the next drop starts over patient
            delay = 1000;

            const [unwrapped] = await unwrapMany(
              user.signer,
              [message[2] as NostrEvent],
              decrypted
            );
            if (unwrapped) receive(unwrapped);
          }
        } catch {
          // Aborted, or the relay went away. Either way, the wait below.
        }

        if (controller.signal.aborted) return;

        await new Promise((resolve) => setTimeout(resolve, delay));
        delay = Math.min(delay * 2, 30_000);
      }
    })();

    return () => release(shared);
  }, [nostr, user, relayKey, inboxRelays, decrypted, queryClient]);
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
  const { conversations, pendingIds, isLoading, isError } = useDirectMessages();

  const conversation = useMemo(
    () => conversations.find((entry) => entry.key === peerPubkey),
    [conversations, peerPubkey]
  );

  return {
    messages: conversation?.messages ?? [],
    /** Sent from here, not yet echoed back by a relay. */
    pendingIds,
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
  const { relays: configuredRelays } = useRelays();
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

      /** Configured relays a gift wrap may legitimately go to. */
      const dmFallbackRelays = canonicalTargets(
        configuredRelays
          .filter((relay) => relay.write && !isPaidRelay(relay.url))
          .map((relay) => relay.url)
      );

      /**
       * NIP-17 requires each wrap to go to the relays its recipient nominated
       * in their kind 10050 list — publishing elsewhere means they may simply
       * never see it. Recipients without a list fall back to the default
       * routing, which is the best that can be done for them.
       *
       * That fallback is why the paid relay is excluded below. Adding it as a
       * write relay puts it in the default routing, so a wrap for somebody
       * with no kind 10050 list would be published there — to a relay that
       * refuses writes from anyone who has not paid admission, and that the
       * recipient has no reason to be reading. Both halves are wrong, and the
       * spec says so plainly: DMs stay on the free relay.
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

          if (urls.length) {
            return nostr.group(urls).event(wrap, { signal });
          }

          return dmFallbackRelays.length
            ? nostr.group(dmFallbackRelays).event(wrap, { signal })
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
