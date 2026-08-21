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
  admissionPayUrl,
  admissionFeeSats,
  readAdmission,
  requiresPayment,
  type AdmissionState,
} from '@/lib/paidRelay';

/** Long enough for a relay on a small box, short enough not to hang a page. */
const TIMEOUT = 8000;

/** How often to re-ask while waiting for a payment to register. */
const CONFIRM_INTERVAL = 4000;

/** And for how long: two minutes of asking, then it stops on its own. */
const CONFIRM_ATTEMPTS = 30;

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
export function useAdmission() {
  const { user } = useCurrentUser();
  const pubkey = user?.pubkey;

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

  return {
    info,
    isLoading,
    /** Whether a NIP-11 document came back at all. */
    live: !isError && !!info,
    /** Whether it advertises paid writes, which is the claim that matters. */
    paid: requiresPayment(info),
    /** The relay's own price, falling back to the documented one. */
    feeSats: admissionFeeSats(info) ?? ADMISSION_SATS,
    /** Whether that price is the relay's or our copy of it. */
    feeFromRelay: admissionFeeSats(info) !== null,
  };
}

interface AdmissionInvoice {
  /** The bolt11 to pay, with whatever wallet they have. */
  bolt11: string;
  /** nostream's id for it, for polling the status afterwards. */
  invoiceId?: string;
  amountSats: number;
}

function readInvoice(body: unknown): AdmissionInvoice | null {
  if (!body || typeof body !== 'object') return null;

  const row = body as Record<string, unknown>;

  /*
   * nostream has moved this field between versions and wraps it differently
   * depending on whether the response came from the API or the pay page, so
   * every spelling it has used is accepted rather than pinning one and
   * breaking on the next upgrade.
   */
  const nested = (row.invoice ?? {}) as Record<string, unknown>;

  const bolt11 = [
    row.bolt11,
    row.paymentRequest,
    row.payment_request,
    nested.bolt11,
    nested.paymentRequest,
    nested.payment_request,
  ].find((value): value is string => typeof value === 'string' && !!value);

  if (!bolt11) return null;

  const id = [row.id, nested.id].find(
    (value): value is string => typeof value === 'string' && !!value
  );

  const amount = Number(row.amount ?? nested.amount);

  return {
    bolt11,
    invoiceId: id,
    // nostream quotes invoice amounts in millisats
    amountSats: Number.isFinite(amount) && amount > 0 ? Math.ceil(amount / 1000) : 0,
  };
}

/**
 * Buys admission for the signed-in key.
 *
 * Returns an invoice rather than paying it, so the existing wallet picker can
 * settle it from the NostrFeed wallet, a NWC connection, WebLN, or by copying
 * it into a phone — the same choice every other payment in this app offers.
 * Nobody should have to move their money here to write to a relay.
 *
 * Accepting the terms of service is part of the request because nostream
 * requires it, and sending `tosAccepted=yes` on somebody's behalf without
 * showing them the terms would be agreeing to something for them. The caller
 * passes it only after they have.
 */
export function useAdmissionInvoice() {
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<AdmissionInvoice> => {
      if (!user) throw new Error('Log in first');

      /*
       * Form-encoded, which is what nostream's route expects — and which is
       * also a CORS-simple content type, so this is one fewer preflight to
       * have configured on the relay's nginx.
       */
      const body = new URLSearchParams({
        pubkey: user.pubkey,
        tosAccepted: 'yes',
        feeSchedule: 'admission',
      });

      const response = await fetch(admissionPayUrl(), {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
        signal: AbortSignal.timeout(TIMEOUT),
      });

      if (!response.ok) {
        throw new Error(`The relay returned ${response.status}`);
      }

      const invoice = readInvoice(await response.json());
      if (!invoice) throw new Error('The relay did not return an invoice');

      return invoice;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['relay-admission'] });
    },
    onError: (error: Error) => {
      /*
       * Named as a reachability problem rather than a payment one, because
       * that is overwhelmingly what it is — the relay is on another origin and
       * this fails whenever its CORS headers are missing. The pay page always
       * works, so the message points there.
       */
      toast({
        title: "Couldn't create the invoice here",
        description: `${error.message}. Open the admission page to pay instead.`,
        variant: 'destructive',
      });
    },
  });
}
