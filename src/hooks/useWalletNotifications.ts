import { useEffect, useMemo, useRef } from 'react';

import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useLnbitsPayments } from '@/hooks/useLnbitsWallet';
import { useNotifications } from '@/hooks/useNotifications';
import { NOTIFY_PREF_KEY } from '@/hooks/useSystemNotifications';
import { useToast } from '@/hooks/useToast';
import { showNotice } from '@/lib/systemNotify';
import {
  describeIncoming,
  incomingSince,
  newestArrival,
  withoutZapped,
} from '@/lib/walletNotify';

/**
 * How many arrivals one poll may announce individually.
 *
 * Coming back to a busy hour should not produce twenty notifications. Past
 * this they become one line with the total on it, which is the thing somebody
 * actually wants to know anyway.
 */
const MAX_INDIVIDUAL = 3;

/**
 * Tells you when money lands, from the wallet rather than from a relay.
 *
 * The gap this fills: every other notification here is built from a Nostr
 * event, and a payment into your own LNbits wallet frequently produces none —
 * a plain lightning-address payment is not a zap and writes no receipt at all,
 * and a real zap's receipt goes to the *sender's* relays, which may not be
 * yours. Either way the sats are in the account and nothing says so, which is
 * the one failure a wallet must not have.
 *
 * Reads the ledger already being polled for the balance, so it costs no extra
 * request.
 *
 * Mounted once, in the layout, beside `useSystemNotifications`. Two copies
 * would announce everything twice.
 */
export function useWalletNotifications() {
  const { data: payments } = useLnbitsPayments();
  const { notifications } = useNotifications();
  const [enabled] = useLocalStorage(NOTIFY_PREF_KEY, false);
  const { toast } = useToast();

  /**
   * The moment already announced through.
   *
   * Seeded from the ledger on the first look rather than starting at zero, so
   * opening the app does not announce every payment it can still see as if it
   * had just arrived.
   */
  const announcedThrough = useRef<number | null>(null);

  /**
   * Invoices a zap receipt has already spoken for.
   *
   * The receipt is the better notification — it knows who sent it and what
   * they wrote — so when both exist the wallet stays quiet.
   */
  const zappedInvoices = useMemo(
    () =>
      notifications
        .filter((notification) => notification.type === 'zap')
        .map((notification) => notification.bolt11 ?? '')
        .filter(Boolean),
    [notifications]
  );

  useEffect(() => {
    if (!payments?.length) return;

    if (announcedThrough.current === null) {
      announcedThrough.current = newestArrival(payments, 0);
      return;
    }

    const fresh = withoutZapped(
      incomingSince(payments, announcedThrough.current),
      zappedInvoices
    );

    /*
     * The marker moves for everything that arrived, including what was
     * suppressed as a duplicate. Advancing it only past what we announced
     * would re-examine the suppressed rows on every poll — and announce them
     * the moment the zap receipt aged out of the notification window.
     */
    announcedThrough.current = newestArrival(
      payments,
      announcedThrough.current
    );

    /*
     * The switch is checked here rather than at the top of the effect. Bailing
     * out earlier would leave the marker unseeded, so turning notifications on
     * would immediately announce every payment still visible in the ledger as
     * if it had just arrived.
     */
    if (!fresh.length || !enabled) return;

    /**
     * Both, and neither is redundant.
     *
     * `showNotice` deliberately says nothing while the app is on screen, which
     * is right for a reply and wrong for money: somebody watching the wallet
     * page is the person most interested in a payment landing. The toast
     * covers that case, the system notification covers the other, and exactly
     * one of them fires.
     */
    const announce = (title: string, body: string, tag: string) => {
      const shown = showNotice({ title, body, url: '/wallet', tag });
      if (!shown) toast({ title, description: body });
    };

    if (fresh.length > MAX_INDIVIDUAL) {
      const total = fresh.reduce((sum, entry) => sum + entry.amountSats, 0);

      announce(
        `⚡ ${total.toLocaleString()} sats received`,
        `${fresh.length} payments landed in your NostrFeed wallet.`,
        // One tag, so a later burst replaces this rather than stacking
        'nostrfeed-wallet-batch'
      );
      return;
    }

    for (const payment of fresh) {
      const { title, body } = describeIncoming(payment);

      // Tagged per payment, so a refetch returning the same row replaces
      // itself rather than appearing twice
      announce(title, body, `nostrfeed-payment-${payment.checkingId}`);
    }
  }, [payments, zappedInvoices, enabled, toast]);
}
