import { useEffect, useState } from 'react';
import { useIsFetching } from '@tanstack/react-query';

/**
 * How long a request may run before it is worth mentioning.
 *
 * Most queries answer from cache or a warm relay in well under this, and a bar
 * that flickers on every one of those reads as jitter rather than feedback.
 */
const SHOW_AFTER_MS = 400;

/**
 * How long the bar lingers after the last request lands.
 *
 * Queries land in bursts — a feed, then the profiles in it — and hiding
 * between them would blink the bar rather than show one continuous load.
 */
const LINGER_MS = 500;

/**
 * A thin bar across the top while anything is loading.
 *
 * With the last visit's cache restored, the app now paints content straight
 * away and refreshes behind it — which is faster, but silent. Without a sign
 * that anything is happening, a stale note or an old follower count looks like
 * a bug instead of a moment.
 *
 * Above the header rather than inside it, so it is the same in every layout
 * and on every route.
 */
export function LoadingBar() {
  const fetching = useIsFetching();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (fetching > 0) {
      if (visible) return;

      const timer = setTimeout(() => setVisible(true), SHOW_AFTER_MS);
      return () => clearTimeout(timer);
    }

    if (!visible) return;

    const timer = setTimeout(() => setVisible(false), LINGER_MS);
    return () => clearTimeout(timer);
  }, [fetching, visible]);

  if (!visible) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5 overflow-hidden"
      // Announced rather than described: there is nothing to read here, and a
      // screen reader repeating "loading" on every background refresh is noise
      role="presentation"
    >
      <div className="h-full w-full animate-progress-sweep bg-primary/80" />
    </div>
  );
}
