import { useNostr } from "@nostrify/react";
import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";

import { useCurrentUser } from "./useCurrentUser";
import { cacheAuthorEvent } from "./useAuthor";
import { enqueue } from "@/lib/outbox";
import { describeSignerError } from "@/lib/signerErrors";
import { mineEvent, NONCE_TAG } from "@/lib/nip13";
import { clearSignerFailure, recordSignerFailure } from "@/lib/signerStatus";

import type { NostrEvent } from "@nostrify/nostrify";

/** How long to wait for a relay before treating the note as undelivered. */
const PUBLISH_TIMEOUT = 5000;

/**
 * How long to wait for a signature before assuming the signer is gone.
 *
 * Only remote signers can hang: an nsec signs in microseconds and an extension
 * either prompts or throws. A NIP-46 bunker publishes the request to a relay
 * and waits for an answer that may never come, and without a bound here the
 * mutation stays pending forever — a spinner that never resolves, which reads
 * as the app being broken rather than the signer being unreachable.
 */
const SIGN_TIMEOUT = 20_000;

/**
 * Bounds a signature request that has no timeout of its own.
 *
 * `AbortSignal` is not an option: `signEvent` takes no signal, so the only
 * lever available is to stop waiting. The signer may still answer afterwards
 * and its answer is simply dropped — an unwanted signature is harmless, an
 * indefinite spinner is not.
 */
function withTimeout(signing: Promise<NostrEvent>): Promise<NostrEvent> {
  return Promise.race([
    signing,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error('Signing timed out')),
        SIGN_TIMEOUT
      )
    ),
  ]);
}

export function useNostrPublish(): UseMutationResult<NostrEvent> {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      t: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'> & {
        /** NIP-13 target difficulty. Mined before signing when set. */
        pow?: number;
      }
    ) => {
      if (user) {
        const tags = t.tags ?? [];

        // Add the client tag if it doesn't exist
        if (location.protocol === "https:" && !tags.some(([name]) => name === "client")) {
          tags.push(["client", location.hostname]);
        }

        let template = {
          kind: t.kind,
          content: t.content ?? "",
          tags,
          created_at: t.created_at ?? Math.floor(Date.now() / 1000),
        };

        /**
         * Mined before signing, never after.
         *
         * The id does not commit to the signature — which is what lets NIP-13
         * mining be delegated at all — but it does commit to the tags and the
         * timestamp, both of which mining rewrites. Signing first would leave
         * a valid-looking event whose signature covers an id it no longer has.
         */
        if (t.pow && t.pow > 0 && !tags.some(([name]) => name === NONCE_TAG)) {
          const mined = await mineEvent({ ...template, pubkey: user.pubkey }, t.pow);
          template = {
            kind: mined.event.kind,
            content: mined.event.content,
            tags: mined.event.tags,
            created_at: mined.event.created_at,
          };
        }

        let event: NostrEvent;

        try {
          event = await withTimeout(user.signer.signEvent(template));
        } catch (error) {
          /**
           * Signing happens somewhere this app cannot see, so what comes back
           * is whatever that place decided to say. Raw, it told people their
           * post failed without telling them the one thing they could do
           * about it.
           */
          const problem = describeSignerError(error, { method: user.method });

          /**
           * A failed signature is the only unambiguous evidence that a remote
           * signer is out of reach, so it is kept rather than spent on one
           * toast — the next thing that needs signing already knows, and the
           * banner offering to reconnect can appear before it is needed.
           */
          recordSignerFailure(user.pubkey, problem.kind);

          throw new Error(`${problem.title}. ${problem.description}`);
        }

        // One working signature disproves any earlier verdict about the signer
        clearSignerFailure(user.pubkey);

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

        /**
         * A profile someone publishes is theirs to see immediately.
         *
         * Done here rather than at each call site because it was being done at
         * each call site: four of them remembered and signup did not, so a new
         * account filled in a name and picture and then looked at a generated
         * name and a grey circle. This runs even when the relay push failed
         * above and the event went to the outbox — it is signed either way,
         * and showing someone their own profile does not require a relay to
         * have acknowledged it.
         */
        cacheAuthorEvent(queryClient, event);

        return event;
      } else {
        throw new Error("User is not logged in");
      }
    },
  });
}
