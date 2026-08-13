import { useEffect, useState } from 'react';

/**
 * How much of the screen the on-screen keyboard is covering.
 *
 * Needed because a phone keyboard is invisible to CSS. `100dvh` accounts for
 * the browser's own chrome and nothing else, so on iOS a layout pinned to the
 * bottom of the viewport stays pinned to a point now underneath the keyboard —
 * which for a chat means the message box you just tapped disappears behind it.
 *
 * Android has a real fix: `interactive-widget=resizes-content` in the viewport
 * meta shrinks the layout viewport, and everything sized in `dvh` follows. iOS
 * ignores that entirely, and the only thing that knows the truth there is
 * `visualViewport` — so this measures the gap and hands it back as a number to
 * pad with.
 *
 * Returns 0 wherever nothing is covered, which is every desktop and every
 * phone with the keyboard closed.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const measure = () => {
      /*
       * `offsetTop` matters as much as the height. iOS scrolls the visual
       * viewport up to keep a focused field visible, and without that term
       * the inset reads as the keyboard height while the page has already
       * moved by part of it — so the composer lifts twice as far as it
       * should and leaves a gap.
       */
      const covered =
        window.innerHeight - viewport.height - viewport.offsetTop;

      /*
       * Small values are ignored. Address bars collapse and expand by a few
       * dozen pixels as you scroll, and treating that as a keyboard makes the
       * whole thread jump while somebody is reading it.
       */
      setInset(covered > 80 ? Math.round(covered) : 0);
    };

    measure();
    viewport.addEventListener('resize', measure);
    viewport.addEventListener('scroll', measure);

    return () => {
      viewport.removeEventListener('resize', measure);
      viewport.removeEventListener('scroll', measure);
    };
  }, []);

  return inset;
}
