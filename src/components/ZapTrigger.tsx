import { Slot } from '@radix-ui/react-slot';
import { useCallback, useState } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';
import { ZapDialog } from '@/components/ZapDialog';
import { useHoldGesture } from '@/hooks/useHoldGesture';
import { useQuickZap } from '@/hooks/useQuickZap';
import { useToast } from '@/hooks/useToast';
import { describeBlocker } from '@/lib/zapPrefs';

interface ZapTriggerProps {
  target: NostrEvent;
  /**
   * The control, which must be a single focusable element — a `Button`, in
   * practice. Handlers are merged onto it rather than onto a wrapper, because
   * a button inside a clickable span reads as one control to a mouse and two
   * to a screen reader.
   */
  children: React.ReactElement;
}

/**
 * A zap control that sends in one tap when that is what somebody asked for.
 *
 * Both paths stay reachable from the same button. Tapping does whatever the
 * setting says — pay directly, or open the dialog — and holding always opens
 * the dialog, so a different amount or a note to go with it is one gesture
 * away rather than behind a second control on every post.
 *
 * Falling back is the important part. When one-tap is on but cannot happen —
 * no wallet connected, not enough balance, an amount over the ceiling — the
 * tap opens the dialog rather than doing nothing. A payment control that
 * silently ignores a press is worse than one that asks a question.
 */
export function ZapTrigger({ target, children }: ZapTriggerProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const quickZap = useQuickZap(target);
  const { toast } = useToast();

  /**
   * Falls back to the dialog, or says why there isn't one.
   *
   * `ZapDialog` renders nothing at all when nobody is logged in, when the note
   * is your own, or when the author published no lightning address — so those
   * three cannot be handled by opening it. Without this a logged-out tap did
   * nothing whatsoever, which is the same thing a broken button does.
   */
  const openDialog = useCallback(() => {
    const blocker = quickZap.blocker;

    if (blocker === 'signed-out' || blocker === 'self' || blocker === 'no-address') {
      toast({
        title: blocker === 'signed-out' ? 'Login required' : 'Cannot zap',
        description: describeBlocker(blocker, quickZap.amount) ?? undefined,
        variant: 'destructive',
      });
      return;
    }

    setDialogOpen(true);
  }, [quickZap.amount, quickZap.blocker, toast]);

  const onTap = useCallback(async () => {
    if (!quickZap.oneTap) {
      openDialog();
      return;
    }

    const sent = await quickZap.send();
    if (!sent) openDialog();
  }, [openDialog, quickZap]);

  const hold = useHoldGesture({ onTap, onHold: openDialog });

  return (
    <>
      <Slot {...hold} data-zapping={quickZap.isSending || undefined}>
        {children}
      </Slot>

      <ZapDialog
        target={target}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </>
  );
}
