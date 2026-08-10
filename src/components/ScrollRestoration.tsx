import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { defineKey, readStore, writeStore } from '@/lib/store';

/**
 * Where the reader was, per visited location.
 *
 * Per tab, not per browser: two tabs on the same feed are two places in it,
 * and restoring one into the other would be worse than not restoring at all.
 */
const positionsKey = defineKey<Record<string, number>>(
  'nostr:scroll',
  {},
  { backing: 'session' }
);

/** Locations remembered. Enough for a session's worth of back-navigation. */
const MAX_ENTRIES = 40;

/**
 * How long to keep trying to reach a saved position.
 *
 * A feed restored from cache paints immediately, but one that has to come off
 * a relay grows for a second or so afterwards, and a page cannot be scrolled
 * to a point it is not yet tall enough to have.
 */
const RESTORE_FRAMES = 60;

/**
 * Puts the reader back where they were.
 *
 * Every navigation used to jump to the top, including going back — so opening
 * a post from four hundred pixels down the feed and returning meant finding
 * your place again by hand, on a timeline that had moved on in the meantime.
 * That is the single thing that made the app feel like a set of pages rather
 * than one continuous thing.
 *
 * Forward navigation still starts at the top, which is what a new page should
 * do. Only back and forward restore, because only those are a return to
 * somewhere the reader has already been.
 */
export function ScrollRestoration() {
  const location = useLocation();
  const navigationType = useNavigationType();

  /**
   * The location being scrolled right now.
   *
   * A ref because the scroll listener is installed once and must attribute
   * each position to whatever is on screen at the time, not to whichever
   * location was current when it was created.
   */
  const currentKey = useRef(location.key);

  // Recorded continuously rather than on the way out: by the time a route
  // change is observable the browser may already have moved the page
  useEffect(() => {
    let frame: number | undefined;

    const record = () => {
      frame = undefined;

      writeStore(positionsKey, (positions) => {
        const next = { ...positions, [currentKey.current]: window.scrollY };
        const names = Object.keys(next);

        // Insertion order is visit order, so the oldest go first
        if (names.length > MAX_ENTRIES) {
          for (const name of names.slice(0, names.length - MAX_ENTRIES)) {
            delete next[name];
          }
        }

        return next;
      });
    };

    // One write per frame at most: a scroll event fires far more often than
    // the page can paint, and each one here is a JSON round trip
    const onScroll = () => {
      if (frame === undefined) frame = requestAnimationFrame(record);
    };

    window.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, []);

  useLayoutEffect(() => {
    currentKey.current = location.key;

    const saved = readStore(positionsKey)[location.key];
    const returning = navigationType === 'POP' && typeof saved === 'number';

    if (!returning) {
      window.scrollTo(0, 0);
      return;
    }

    if (saved <= 0) return;

    let frame: number;
    let attempts = 0;

    /**
     * Retried, because the page arrives in pieces.
     *
     * The route's chunk loads, then its data, then the images inside it — and
     * a scroll issued before the content exists is silently clamped to
     * whatever height the document had at the time. Reissuing until it takes
     * is what makes the difference between landing in the right place and
     * landing near the top.
     */
    const settle = () => {
      window.scrollTo(0, saved);

      if (Math.abs(window.scrollY - saved) < 2 || attempts >= RESTORE_FRAMES) {
        return;
      }

      attempts += 1;
      frame = requestAnimationFrame(settle);
    };

    frame = requestAnimationFrame(settle);

    // A reader who navigates again mid-restore has overtaken it
    return () => cancelAnimationFrame(frame);
  }, [location.key, navigationType]);

  return null;
}

export default ScrollRestoration;
