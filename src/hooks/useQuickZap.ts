import { useCallback, useMemo, useRef, useState } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { usePayAnyWallet } from '@/hooks/usePayAnyWallet';
import { useToast } from '@/hooks/useToast';
import { useZapPrefs } from '@/hooks/useZapPrefs';
import { useZaps } from '@/hooks/useZaps';
import { describeBlocker, zapReadiness } from '@/lib/zapPrefs';

/**
 * Zapping in one tap, when that is what somebody asked for.
 *
 * The dialog is not replaced. It is the right flow whenever the amount is the
 * point — a big one, a specific one, one with something to say — and it stays
 * reachable from every control. What this adds is the other case, which is
 * most of them: the same small amount, sent because a post was good.
 *
 * Everything is reused. `useZaps` builds the NIP-57 request and fetches the
 * invoice, `usePayAnyWallet` pays it from whichever wallet the person has.
 * There is no second payment path to keep correct.
 */
export function useQuickZap(target: NostrEvent | undefined) {
  const { user } = useCurrentUser();
  const { prefs } = useZapPrefs();
  const { toast } = useToast();

  const author = useAuthor(target?.pubkey);
  const metadata = author.data?.metadata;

  const { requestInvoice, confirmPaid } = useZaps(target as NostrEvent);
  const { pay, preferredFor, balanceSats, wallets } = usePayAnyWallet();

  const [isSending, setIsSending] = useState(false);

  /*
   * Guards against a second tap landing while the first is still paying.
   *
   * State is a frame behind on a phone — two quick taps both read `isSending`
   * as false and both pay — and this is the one place where losing that race
   * costs real money. A ref is written synchronously, so the second tap sees
   * it.
   */
  const inFlight = useRef(false);

  const readiness = useMemo(
    () =>
      zapReadiness({
        signedIn: !!user,
        isSelf: !!user && user.pubkey === target?.pubkey,
        recipientHasAddress: !!(metadata?.lud16 || metadata?.lud06),
        hasWallet: wallets.length > 0,
        balanceSats,
        amount: prefs.amount,
      }),
    [user, target?.pubkey, metadata, wallets.length, balanceSats, prefs.amount]
  );

  /**
   * Sends, or says why it cannot.
   *
   * Returns whether it went, so a caller can fall back to the dialog rather
   * than leaving somebody with a button that did nothing. A failure here is
   * never silent: money not moving when somebody pressed a paying button is
   * the worst thing this can do quietly.
   */
  const send = useCallback(async (): Promise<boolean> => {
    if (!target) return false;

    // One send per tap. A second tap is not a second zap
    if (inFlight.current) return true;

    if (!readiness.canOneTap) {
      const reason = describeBlocker(readiness.blocker, prefs.amount);
      if (reason) toast({ title: 'Cannot zap', description: reason });
      return false;
    }

    inFlight.current = true;
    setIsSending(true);

    try {
      const invoice = await requestInvoice(prefs.amount, prefs.message);
      if (!invoice?.bolt11) return false;

      const option = preferredFor(prefs.amount);
      const result = await pay({ bolt11: invoice.bolt11, optionId: option.id });

      if (!result?.paid) return false;

      confirmPaid();

      /*
       * A one-tap zap has no pay screen, which is where this is said in the
       * dialog — so without it here the commonest way to zap is also the one
       * that never mentions the money went somewhere no receipt will ever be
       * published from. That is the difference between "your zap is on its
       * way" and a count that stays at zero forever with no explanation.
       */
      toast({
        title: `Zapped ${prefs.amount.toLocaleString()} sats`,
        description: invoice.publishesReceipt
          ? prefs.message || undefined
          : "Their server doesn't publish zap receipts, so this won't show on the post.",
      });

      return true;
    } catch (error) {
      toast({
        title: 'Zap failed',
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
      return false;
    } finally {
      inFlight.current = false;
      setIsSending(false);
    }
  }, [
    target,
    readiness,
    prefs.amount,
    prefs.message,
    requestInvoice,
    preferredFor,
    pay,
    confirmPaid,
    toast,
  ]);

  return {
    /** Whether tapping should pay rather than open the dialog. */
    oneTap: prefs.oneTap && readiness.canOneTap,
    canOneTap: readiness.canOneTap,
    blocker: readiness.blocker,
    amount: prefs.amount,
    message: prefs.message,
    isSending,
    send,
  };
}
