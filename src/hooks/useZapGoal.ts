import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useRelays } from '@/hooks/useRelays';
import { useToast } from '@/hooks/useToast';
import { ZAP_RECEIPT_KIND } from '@/lib/zap';
import { summarizeZaps } from '@/lib/zapSummary';
import {
  GOAL_KIND,
  buildGoalTags,
  goalProgress,
  parseZapGoal,
  type GoalInput,
  type GoalProgress,
  type ZapGoal,
} from '@/lib/nip75';

/**
 * A goal and how much it has raised.
 *
 * Counted from the goal's own relays *and* the reader's, together. The goal's
 * are what the spec names and what makes two people arrive at the same number,
 * but reading only those is why a funded goal could sit at zero: those relays
 * may be unreachable from here, or the sender's client may not have honoured
 * the `relays` MUST — while the receipt is sitting on the reader's own relays,
 * which the zap request also lists. Asking both can only find more, and the
 * total is deduplicated on the receipt id so finding the same one twice does
 * not count it twice.
 *
 * Every receipt is then checked. A kind 9735 is an ordinary event anybody can
 * publish, and this one drives a progress bar about money.
 */
export function useZapGoal(goalEvent: { id: string } | undefined) {
  const { nostr } = useNostr();

  return useQuery<{
    goal: ZapGoal;
    progress: GoalProgress;
    /** True when no relay answered, which is not the same as no zaps. */
    unreachable: boolean;
  } | null>({
    queryKey: ['zap-goal', goalEvent?.id ?? ''],
    queryFn: async ({ signal }) => {
      const timeout = AbortSignal.any([signal, AbortSignal.timeout(5000)]);

      const [event] = await nostr.query(
        [{ ids: [goalEvent!.id], kinds: [GOAL_KIND], limit: 1 }],
        { signal: timeout }
      );

      const goal = event ? parseZapGoal(event) : null;
      if (!goal) return null;

      const filter = {
        kinds: [ZAP_RECEIPT_KIND],
        '#e': [goal.event.id],
        limit: 500,
      };

      /*
       * Both sources in parallel, and a failure of one is not a failure of
       * the tally. `.catch(() => [])` on a single query used to make an
       * unreachable relay indistinguishable from a goal nobody had funded —
       * the bar read 0% either way, with nothing to say which.
       */
      const [fromGoal, fromReader] = await Promise.all([
        nostr
          .group(goal.relays)
          .query([filter], { signal: timeout })
          .catch(() => null),
        nostr.query([filter], { signal: timeout }).catch(() => null),
      ]);

      const receipts = [...(fromGoal ?? []), ...(fromReader ?? [])];

      /**
       * The author, plus anyone the goal redirects its money to.
       *
       * A NIP-75 goal can raise for somebody else entirely through `zap`
       * tags, and the receipt then names that person rather than the author —
       * so checking against the author alone would reject every zap to such a
       * goal and report zero for a goal that had been funded.
       */
      const summary = summarizeZaps(receipts, {
        eventId: goal.event.id,
        recipientPubkey: [
          goal.event.pubkey,
          ...goal.beneficiaries.map((who) => who.pubkey),
        ],
      });

      const counted = summary.zappers.map((zapper) => ({
        amountMsat: zapper.sats * 1000,
        senderPubkey: zapper.pubkey,
        createdAt: zapper.at,
      }));

      return {
        goal,
        progress: goalProgress(goal, counted),
        unreachable: fromGoal === null && fromReader === null,
      };
    },
    enabled: !!goalEvent?.id,
    // Short, because somebody who has just zapped a goal is watching the bar
    staleTime: 15_000,
  });
}

/** Goals published by someone, newest first. */
export function useZapGoals(pubkey: string | undefined) {
  const { nostr } = useNostr();

  return useQuery<ZapGoal[]>({
    queryKey: ['zap-goals', pubkey ?? ''],
    queryFn: async ({ signal }) => {
      const events = await nostr.query(
        [{ kinds: [GOAL_KIND], authors: [pubkey!], limit: 20 }],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(4000)]) }
      );

      return events
        .sort((a, b) => b.created_at - a.created_at)
        .map(parseZapGoal)
        .filter((goal): goal is ZapGoal => !!goal);
    },
    enabled: !!pubkey,
    staleTime: 5 * 60_000,
  });
}

/** Publishing a goal of your own. */
export function useCreateZapGoal() {
  const { user } = useCurrentUser();
  const { mutateAsync: createEvent } = useNostrPublish();
  const { writeUrls } = useRelays();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (input: Omit<GoalInput, 'relays'> & { relays?: string[] }) => {
      if (!user) throw new Error('Log in first');

      /**
       * Defaulted to the author's own write relays, because these are not a
       * preference — they are where every zap toward this goal will be
       * published and where anyone tallying it will look. A goal published
       * with relays its author does not actually write to counts nothing.
       */
      const relays = (input.relays?.length ? input.relays : writeUrls).filter(
        (url) => url.startsWith('wss://') || url.startsWith('ws://')
      );

      /*
       * Filtered before the check, not after. `buildGoalTags` drops anything
       * that is not a websocket URL, so a list of https entries passed a
       * length check here and produced a goal with an empty relays tag —
       * publishable, unreadable, unfundable.
       */
      if (!relays.length) {
        throw new Error(
          'A goal has to name at least one relay for its zaps to be counted at.'
        );
      }

      return await createEvent({
        kind: GOAL_KIND,
        content: input.description,
        tags: buildGoalTags({ ...input, relays }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['zap-goals'] });
      toast({
        title: 'Goal published',
        description: 'Anyone can fund it by zapping it.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not publish that goal',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}
