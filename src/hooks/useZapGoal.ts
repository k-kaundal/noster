import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useRelays } from '@/hooks/useRelays';
import { useToast } from '@/hooks/useToast';
import { ZAP_RECEIPT_KIND, parseZapReceipt } from '@/lib/zap';
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
 * The tally is read from the relays the goal itself names, not from the
 * reader's. That is the whole mechanism: a goal declares where its receipts
 * live so that everyone counting arrives at the same number, and counting from
 * somewhere else produces a total that is quietly short by whatever those
 * relays never saw.
 */
export function useZapGoal(goalEvent: { id: string } | undefined) {
  const { nostr } = useNostr();

  return useQuery<{ goal: ZapGoal; progress: GoalProgress } | null>({
    queryKey: ['zap-goal', goalEvent?.id ?? ''],
    queryFn: async ({ signal }) => {
      const timeout = AbortSignal.any([signal, AbortSignal.timeout(5000)]);

      const [event] = await nostr.query(
        [{ ids: [goalEvent!.id], kinds: [GOAL_KIND], limit: 1 }],
        { signal: timeout }
      );

      const goal = event ? parseZapGoal(event) : null;
      if (!goal) return null;

      /**
       * Asked of the goal's own relays specifically. `NPool.group` opens
       * exactly these rather than routing through the reader's set, which is
       * what makes two people looking at the same goal see the same total.
       */
      const receipts = await nostr
        .group(goal.relays)
        .query([{ kinds: [ZAP_RECEIPT_KIND], '#e': [goal.event.id], limit: 500 }], {
          signal: timeout,
        })
        .catch(() => [] as never[]);

      const parsed = receipts.map((receipt) => {
        const zap = parseZapReceipt(receipt);

        return {
          amountMsat: (zap.amountSats ?? 0) * 1000,
          senderPubkey: zap.senderPubkey ?? undefined,
          createdAt: receipt.created_at,
        };
      });

      return { goal, progress: goalProgress(goal, parsed) };
    },
    enabled: !!goalEvent?.id,
    staleTime: 60_000,
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
      const relays = input.relays?.length ? input.relays : writeUrls;

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
