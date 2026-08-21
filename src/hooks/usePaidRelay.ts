import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useRelayInfo } from '@/hooks/useRelayInfo';
import { useToast } from '@/hooks/useToast';
import {
  ADMISSION_SATS,
  ADMISSION_URL,
  PAID_RELAY_URL,
  admissionCheckUrl,
  admissionInvoicesUrl,
  admissionFeeSats,
  readAdmission,
  readInvoice,
  readInvoiceStatus,
  requiresPayment,
  type AdmissionInvoice,
  type AdmissionState,
} from '@/lib/paidRelay';

/** Long enough for a relay on a small box, short enough not to hang a page. */
const TIMEOUT = 8000;

/** How often to re-ask while waiting for a payment to register. */
const CONFIRM_INTERVAL = 4000;

/** And for how long: two minutes of asking, then it stops on its own. */
const CONFIRM_ATTEMPTS = 30;

/** How often to poll an invoice that is waiting to be paid. */
const WATCH_INTERVAL = 3000;

/** Fifteen minutes, which outlasts a bolt11 but not a forgotten tab. */
const WATCH_ATTEMPTS = 300;

/**
 * Where the signed-in account stands with the paid relay.
 *
 * The relay is asked directly, every time, rather than a purchase being
 * remembered here. That is the whole point: a record in this browser says what
 * somebody paid, and only the relay knows what that bought — they are
 * different questions, and the page was answering the wrong one.
 *
 * A failed request resolves to `unknown` rather than throwing. This crosses an
 * origin boundary, so it depends on CORS headers the relay's nginx has to be
 * configured to send; until it is, every check fails. Treating that as "has
 * not paid" would invite somebody to buy admission they already hold.
 */
export function useAdmission(who?: string) {
  const { user } = useCurrentUser();

  /*
   * Anybody's, not only the signed-in reader's. The relay answers for any key,
   * which is what lets a profile show whether that person can write here —
   * asked once per profile, and deliberately never per row in a feed, since
   * that is one cross-origin request per post on screen.
   */
  const pubkey = who ?? user?.pubkey;

  const query = useQuery<AdmissionState>({
    queryKey: ['relay-admission', ADMISSION_URL, pubkey ?? ''],
    queryFn: async ({ signal }) => {
      try {
        const response = await fetch(admissionCheckUrl(pubkey!), {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT)]),
        });

        if (!response.ok) return 'unknown';

        const admitted = readAdmission(await response.json());
        return admitted === null ? 'unknown' : admitted ? 'admitted' : 'unpaid';
      } catch {
        // Blocked by CORS, offline, timed out, or answering something that is
        // not JSON. None of those is the relay saying no.
        return 'unknown';
      }
    },
    enabled: !!pubkey,
    staleTime: 30 * 1000,
    retry: false,
  });

  /**
   * Waits for a payment to register, for a while.
   *
   * The relay does not admit a key the instant the invoice is paid — the
   * payment has to reach nostream and be processed — so checking once
   * immediately after paying reports `unpaid`, which is both wrong and
   * alarming to somebody whose sats have just left.
   *
   * Bounded, unlike the loop in the integration notes. An unbounded
   * `while (!admitted)` keeps hitting the relay every four seconds for the
   * life of the tab if the payment never arrives — which is exactly what
   * happens when somebody opens the pay page and closes it. This gives up and
   * says so, leaving "Check again" for whenever they actually pay.
   */
  const confirm = useCallback(async (): Promise<AdmissionState> => {
    for (let attempt = 0; attempt < CONFIRM_ATTEMPTS; attempt += 1) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, CONFIRM_INTERVAL));
      }

      const { data } = await query.refetch();
      if (data === 'admitted') return data;
    }

    return query.data ?? 'unknown';
  }, [query]);

  return {
    state: query.data ?? 'unknown',
    isLoading: query.isLoading,
    /** Asks again, once. */
    refetch: query.refetch,
    /** Asks repeatedly for a bounded while, for straight after a payment. */
    confirm,
    isChecking: query.isFetching,
  };
}

/**
 * What the paid relay says about itself.
 *
 * The price comes from here rather than from a constant, because the operator
 * changes it in nostream's settings and restarts — at which point a number
 * compiled into a static site is wrong in the direction that produces an
 * underpaid invoice.
 *
 * `live` is worth its own answer: until certbot has run on the relay's host,
 * this fetch reaches nginx's default page rather than a NIP-11 document, and
 * the page should say the relay is not reachable rather than quote a price
 * nobody can pay.
 */
export function usePaidRelayInfo() {
  const { data: info, isLoading, isError } = useRelayInfo(PAID_RELAY_URL);

  /**
   * The price from the endpoint that will actually charge it.
   *
   * Asked as well as NIP-11 rather than instead, because the two fail
   * independently and either answering is enough. NIP-11 needs an
   * `application/nostr+json` Accept header, which is not a CORS-simple value
   * and so needs a preflight; this one is a plain JSON GET. Gating the whole
   * card on NIP-11 alone meant a relay that could be paid perfectly well was
   * announced as not answering.
   */
  const quote = useQuery({
    queryKey: ['relay-admission-fee', ADMISSION_URL],
    queryFn: async ({ signal }) => {
      const response = await fetch(admissionInvoicesUrl(), {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT)]),
      });

      if (!response.ok) throw new Error(`Relay returned ${response.status}`);

      const body = (await response.json()) as Record<string, unknown>;
      const sats = Number(body.amount_sats);

      return Number.isFinite(sats) && sats > 0 ? Math.round(sats) : null;
    },
    staleTime: 10 * 60 * 1000,
    retry: false,
  });

  // The minting endpoint outranks the description of it
  const feeSats = quote.data ?? admissionFeeSats(info);

  return {
    info,
    isLoading: isLoading || quote.isLoading,
    /**
     * Whether anything on that host answered. Either source will do — the
     * question this gates is "can somebody buy admission", and one reachable
     * endpoint is enough to say yes.
     */
    live: (!isError && !!info) || quote.isSuccess,
    /** Whether it advertises paid writes, which is the claim that matters. */
    paid: requiresPayment(info),
    /** The relay's own price, falling back to the documented one. */
    feeSats: feeSats ?? ADMISSION_SATS,
    /** Whether that price is the relay's or our copy of it. */
    feeFromRelay: feeSats !== null,
  };
}

export function useAdmissionInvoice() {
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<AdmissionInvoice> => {
      if (!user) throw new Error('Log in first');

      const url = admissionInvoicesUrl();

      /*
       * JSON first, form-encoded second, because the relay documents both and
       * they fail differently. JSON is a non-simple content type, so it needs
       * a CORS preflight the relay's nginx has to answer; form-encoded needs
       * none. Trying the documented shape first and falling back to the one
       * that cannot be preflighted away means a misconfigured `OPTIONS` costs
       * a round trip rather than the whole feature.
       */
      const attempts: RequestInit[] = [
        {
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            pubkey: user.pubkey,
            tosAccepted: true,
            feeSchedule: 'admission',
          }),
        },
        {
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            pubkey: user.pubkey,
            tosAccepted: 'yes',
            feeSchedule: 'admission',
          }),
        },
      ];

      let failure = 'The relay did not answer';

      for (const attempt of attempts) {
        try {
          const response = await fetch(url, {
            method: 'POST',
            ...attempt,
            signal: AbortSignal.timeout(TIMEOUT),
          });

          if (!response.ok) {
            failure = `The relay returned ${response.status}`;
            continue;
          }

          const invoice = readInvoice(await response.json());
          if (invoice) return invoice;

          failure = 'The relay did not return an invoice';
        } catch (error) {
          failure = error instanceof Error ? error.message : failure;
        }
      }

      throw new Error(failure);
    },
    onSuccess: (invoice) => {
      // An admitted key comes back with no invoice, and the card should say so
      if (invoice.userAdmitted) {
        queryClient.invalidateQueries({ queryKey: ['relay-admission'] });
      }
    },
    onError: (error: Error) => {
      /*
       * Named as a reachability problem rather than a payment one, because
       * that is overwhelmingly what it is — the relay is on another origin and
       * this fails whenever its CORS headers are missing.
       */
      toast({
        title: "Couldn't reach the relay",
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}

/**
 * Watches one invoice until it is paid, expires, or the caller gives up.
 *
 * Polls the relay's own `status_url` and the admission check together, because
 * they can disagree and either one saying yes is enough: the status route
 * knows the payment settled, the check knows the key was admitted, and the
 * gap between those two facts is exactly the window somebody sits staring at a
 * QR code they have already paid.
 *
 * Bounded, and cancellable. The integration notes poll in a bare
 * `while (true)`, which never stops — close the dialog without paying and it
 * keeps hitting the relay every three seconds for the life of the tab.
 */
export function useInvoiceWatcher() {
  const queryClient = useQueryClient();

  return useCallback(
    async (
      invoice: AdmissionInvoice,
      pubkey: string,
      signal: AbortSignal
    ): Promise<'paid' | 'expired' | 'gave-up'> => {
      const checkUrl = admissionCheckUrl(pubkey);

      const settled = () => {
        queryClient.invalidateQueries({ queryKey: ['relay-admission'] });
        return 'paid' as const;
      };

      for (let attempt = 0; attempt < WATCH_ATTEMPTS; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, WATCH_INTERVAL));
        if (signal.aborted) return 'gave-up';

        const [status, admitted] = await Promise.all([
          invoice.statusUrl
            ? fetch(invoice.statusUrl, {
                headers: { Accept: 'application/json' },
                signal,
              })
                .then((response) => (response.ok ? response.json() : null))
                .then(readInvoiceStatus)
                .catch(() => 'unknown' as const)
            : Promise.resolve('unknown' as const),
          fetch(checkUrl, { headers: { Accept: 'application/json' }, signal })
            .then((response) => (response.ok ? response.json() : null))
            .then(readAdmission)
            .catch(() => null),
        ]);

        if (status === 'completed' || admitted === true) return settled();

        /*
         * Only the relay's own verdict expires an invoice. A clock on this
         * device that is a few minutes fast would otherwise close a dialog on
         * an invoice that is still perfectly payable.
         */
        if (status === 'expired') return 'expired';
      }

      return 'gave-up';
    },
    [queryClient]
  );
}
