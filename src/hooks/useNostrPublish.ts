import { useNostr } from "@nostrify/react";
import { useMutation, type UseMutationResult } from "@tanstack/react-query";

import { useCurrentUser } from "./useCurrentUser";
import { enqueue } from "@/lib/outbox";

import type { NostrEvent } from "@nostrify/nostrify";

/** How long to wait for a relay before treating the note as undelivered. */
const PUBLISH_TIMEOUT = 5000;

export function useNostrPublish(): UseMutationResult<NostrEvent> {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  return useMutation({
    mutationFn: async (t: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>) => {
      if (user) {
        const tags = t.tags ?? [];

        // Add the client tag if it doesn't exist
        if (location.protocol === "https:" && !tags.some(([name]) => name === "client")) {
          tags.push(["client", location.hostname]);
        }

        const event = await user.signer.signEvent({
          kind: t.kind,
          content: t.content ?? "",
          tags,
          created_at: t.created_at ?? Math.floor(Date.now() / 1000),
        });

        try {
          await nostr.event(event, {
            signal: AbortSignal.timeout(PUBLISH_TIMEOUT),
          });
        } catch (error) {
          /**
           * Kept rather than lost.
           *
           * The event is signed, so delivering it later needs no key and no
           * prompt — only a working relay. Failing the mutation here would
           * hand the caller an error for something that is going to be sent,
           * and would throw away what the person wrote in the meantime.
           */
          enqueue(event, error as Error);
        }

        return event;
      } else {
        throw new Error("User is not logged in");
      }
    },
  });
}
