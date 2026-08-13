import { useCallback, useEffect, useRef } from 'react';

/** Long enough to be deliberate, short enough not to feel broken. */
const HOLD_MS = 400;

export interface HoldHandlers {
  onPointerDown: () => void;
  onPointerUp: () => void;
  onPointerLeave: () => void;
  onContextMenu: (event: { preventDefault: () => void }) => void;
  onClick: () => void;
}

/**
 * A control that does one thing on a tap and another on a hold.
 *
 * Needed wherever a single tap spends money: the fast path has to stay fast,
 * and the deliberate path — a different amount, a different message — has to
 * stay reachable without a second button cluttering every post. Holding is
 * the gesture people already expect for "more options", and right-clicking is
 * its desktop equivalent, so the browser menu is suppressed there rather than
 * appearing over a payment control somebody was aiming at.
 *
 * The tap is suppressed after a hold fires. A press that already opened the
 * dialog must not also pay on release.
 */
export function useHoldGesture({
  onTap,
  onHold,
}: {
  onTap: () => void;
  onHold?: () => void;
}): HoldHandlers {
  const held = useRef(false);
  const timer = useRef<number | null>(null);

  const cancel = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  // A component unmounted mid-press — a feed re-rendering under a thumb —
  // would otherwise fire a payment nobody is looking at
  useEffect(() => cancel, [cancel]);

  const onPointerDown = useCallback(() => {
    if (!onHold) return;

    held.current = false;
    timer.current = window.setTimeout(() => {
      held.current = true;
      onHold();
    }, HOLD_MS);
  }, [onHold]);

  const onContextMenu = useCallback(
    (event: { preventDefault: () => void }) => {
      if (!onHold) return;
      event.preventDefault();
      cancel();
      held.current = true;
      onHold();
    },
    [cancel, onHold]
  );

  const onClick = useCallback(() => {
    if (held.current) {
      held.current = false;
      return;
    }
    onTap();
  }, [onTap]);

  return {
    onPointerDown,
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onContextMenu,
    onClick,
  };
}
