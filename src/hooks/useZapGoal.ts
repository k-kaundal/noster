import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useDeleteEvent } from '@/hooks/useDeleteEvent';
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

export interface GoalTallyOptions {
  /**
   * An event that announces this goal, whose zaps also count.
   *
   * The reason a funded goal reads zero. NIP-75 counts receipts that name the
   * kind 9041, but almost nobody zaps a kind 9041 — a goal is announced in a
   * note, the note is what appears in a feed, and a client that has never
   * heard of NIP-75 tags the note it can see. The money arrives, the receipt
   * names the note, and the bar never moves.
   *
   * Only ever the event carrying a `goal` tag pointing back here, which is
   * the author saying zaps on it are for this goal. That is a claim by the
   * one person entitled to make it: the goal is theirs, and so is the note.
   */
  announcedBy?: string;
  /**
   * Where to look for the goal itself, from a `goal` tag's relay hint.
   *
   * Often the only thing that says where a goal lives. An event linking to a
   * goal travels far beyond the relays that hold it, so a reader who finds the
   * link on one relay has no other way to reach the goal on another — and a
   * goal that cannot be fetched renders as nothing at all.
   */
  relay?: string;
}

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
export function useZapGoal(
  goalEvent: NostrEvent | { id: string } | undefined,
  options: GoalTallyOptions = {}
) {
  const { nostr } = useNostr();
  const { announcedBy, relay } = options;

  return useQuery<{
    goal: ZapGoal;
    progress: GoalProgress;
    /** True when no relay answered, which is not the same as no zaps. */
    unreachable: boolean;
  } | null>({
    queryKey: ['zap-goal', goalEvent?.id ?? '', announcedBy ?? ''],
    queryFn: async ({ signal }) => {
      const timeout = AbortSignal.any([signal, AbortSignal.timeout(6000)]);

      /**
       * The goal we were handed, when we were handed one.
       *
       * Most callers already have it — a card in a feed is rendering the very
       * event it passes in — and re-fetching it meant the card vanished
       * whenever the reader's relays were slow to hand back an event that was
       * already on screen. Only a `goal` tag's bare id needs looking up, and
       * that lookup asks the hint first.
       */
      const known =
        goalEvent && 'kind' in goalEvent ? (goalEvent as NostrEvent) : null;

      const event =
        known ??
        (
          await (relay ? nostr.group([relay]) : nostr)
            .query([{ ids: [goalEvent!.id], kinds: [GOAL_KIND], limit: 1 }], {
              signal: timeout,
            })
            .catch(() => [] as NostrEvent[])
        )[0] ??
        // The hint may be down, or wrong, or the goal may have spread past it
        (
          await nostr
            .query([{ ids: [goalEvent!.id], kinds: [GOAL_KIND], limit: 1 }], {
              signal: timeout,
            })
            .catch(() => [] as NostrEvent[])
        )[0];

      const goal = event ? parseZapGoal(event) : null;
      if (!goal) return null;

      /**
       * Every event a zap toward this goal might name.
       *
       * A receipt on the announcement is only counted when the announcement
       * was published after the goal — the note is what points here, so a zap
       * that landed before the goal existed was for something else, and
       * counting it would credit a goal with money raised before it was asked
       * for.
       */
      const targets = [goal.event.id, ...(announcedBy ? [announcedBy] : [])];

      const filter = {
        kinds: [ZAP_RECEIPT_KIND],
        '#e': targets,
        limit: 500,
      };

      /**
       * One request per relay, and every answer kept.
       *
       * This used to be two: the reader's pool, and a single group query
       * across all of the goal's relays at once. A group waits for the whole
       * set, so one relay that never answers took the request past its
       * deadline and the abort threw away the receipts the other four had
       * already returned — a goal whose relay list included anything slow
       * read zero no matter how well funded it was. Asked separately, a relay
       * can only lose its own answer.
       *
       * The reader's pool is in the list because a receipt may be sitting on
       * it whether or not the sender honoured the `relays` MUST, and finding
       * the same receipt twice costs nothing: the total is deduplicated on the
       * receipt id.
       */
      const sources = [
        nostr,
        ...goal.relays.map((url) => nostr.group([url])),
      ];

      const answers = await Promise.allSettled(
        sources.map((source) => source.query([filter], { signal: timeout }))
      );

      const receipts = answers.flatMap((answer) =>
        answer.status === 'fulfilled' ? answer.value : []
      );

      /*
       * Only when nothing at all came back. "0 of 1M sats" reads identically
       * whether nobody has zapped or nothing could be asked, and one of those
       * is a fact about the goal while the other is a fact about the network.
       */
      const unreachable = answers.every(
        (answer) => answer.status === 'rejected'
      );

      /**
       * The author, plus anyone the goal redirects its money to.
       *
       * A NIP-75 goal can raise for somebody else entirely through `zap`
       * tags, and the receipt then names that person rather than the author —
       * so checking against the author alone would reject every zap to such a
       * goal and report zero for a goal that had been funded.
       */
      const summary = summarizeZaps(receipts, {
        eventId: targets,
        recipientPubkey: [
          goal.event.pubkey,
          ...goal.beneficiaries.map((who) => who.pubkey),
        ],
      });

      /*
       * `goalProgress` drops anything outside the goal's window, which now
       * has a start as well as a deadline — see `countsTowardGoal`.
       */
      const counted = summary.zappers.map((zapper) => ({
        amountMsat: zapper.sats * 1000,
        senderPubkey: zapper.pubkey,
        createdAt: zapper.at,
      }));

      return { goal, progress: goalProgress(goal, counted), unreachable };
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

/**
 * Changing a goal, which the protocol does not really allow.
 *
 * Kind 9041 is a regular event: it has no `d` tag, so a second publish is a
 * second goal rather than a new version of the first. There is no edit to
 * make — what happens instead is a new goal published and a NIP-09 deletion
 * requested for the old one.
 *
 * That has a consequence worth being loud about, and `ZapGoalEditor` is: every
 * zap already received names the old event, and the tally follows the event.
 * So editing a goal that has been funded starts its progress bar at zero,
 * whatever it read a moment ago. Editing one nobody has zapped yet costs
 * nothing, which is the case this is really for — a typo in the title, a
 * target set an order of magnitude wrong.
 *
 * The deletion is a request, not an act. Relays are free to ignore it, so the
 * old goal may keep appearing elsewhere; there is nothing this or any client
 * can do about that beyond asking.
 */
export function useReplaceZapGoal() {
  const { user } = useCurrentUser();
  const { mutateAsync: createEvent } = useNostrPublish();
  const { deleteEvents } = useDeleteEvent();
  const { writeUrls } = useRelays();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      previous,
      ...input
    }: Omit<GoalInput, 'relays'> & {
      relays?: string[];
      previous: NostrEvent;
    }) => {
      if (!user) throw new Error('Log in first');
      if (previous.pubkey !== user.pubkey) {
        throw new Error('You can only edit your own goals');
      }

      const relays = (input.relays?.length ? input.relays : writeUrls).filter(
        (url) => url.startsWith('wss://') || url.startsWith('ws://')
      );

      if (!relays.length) {
        throw new Error(
          'A goal has to name at least one relay for its zaps to be counted at.'
        );
      }

      const replacement = await createEvent({
        kind: GOAL_KIND,
        content: input.description,
        tags: buildGoalTags({ ...input, relays }),
      });

      /*
       * After the replacement is published, not before. A deletion that went
       * first and a publish that then failed would leave somebody with no goal
       * at all rather than the one they were trying to change.
       */
      await deleteEvents({
        events: [previous],
        reason: 'Replaced by an edited goal',
      }).catch(() => {
        // The new goal exists either way, which is the part that mattered
      });

      return replacement;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['zap-goals'] });
      toast({
        title: 'Goal updated',
        description: 'The old one has been asked to be deleted.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not update that goal',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}

/**
 * Announcing a goal as an ordinary note.
 *
 * The thing that makes a goal fundable by people who are not using this app.
 * A kind 9041 does not appear in anybody's feed and most clients will not zap
 * one — so the goal is announced in a kind 1, which every client renders and
 * every client can zap, carrying a `goal` tag back to it. Zaps on that note
 * are counted toward the goal by `useZapGoal`.
 *
 * The relay hint is not decoration here. It is often the only thing telling a
 * reader's client where to find a goal it has never seen.
 */
export function useAnnounceZapGoal() {
  const { user } = useCurrentUser();
  const { mutateAsync: createEvent } = useNostrPublish();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ goal, content }: { goal: ZapGoal; content: string }) => {
      if (!user) throw new Error('Log in first');

      const text = content.trim();
      if (!text) throw new Error('Say something about what you are raising for');

      return await createEvent({
        kind: 1,
        content: text,
        tags: [['goal', goal.event.id, goal.relays[0] ?? '']],
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['zap-goal'] });
      toast({
        title: 'Goal announced',
        description: 'Zaps on that post now count toward it.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not post that',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}

/** Asks relays to drop a goal entirely. */
export function useRetireZapGoal() {
  const { deleteEvents, isDeleting } = useDeleteEvent();
  const queryClient = useQueryClient();

  return {
    isDeleting,
    retire: async (goal: NostrEvent) => {
      await deleteEvents({ events: [goal], reason: 'Goal withdrawn' });
      queryClient.invalidateQueries({ queryKey: ['zap-goals'] });
    },
  };
}
