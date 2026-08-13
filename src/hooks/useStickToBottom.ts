import { useCallback, useEffect, useRef, useState } from 'react';

/** How far from the bottom still counts as "reading the latest". */
const NEAR_BOTTOM_PX = 120;

/**
 * A scroller that follows new content, unless somebody is reading older
 * content.
 *
 * Both halves matter. A chat that does not follow leaves replies arriving off
 * screen; a chat that always follows yanks the thread away from somebody
 * scrolled up reading yesterday. So it sticks only while already at the
 * bottom, and offers a way back when it is not.
 */
export function useStickToBottom<T extends HTMLElement>(dependency: unknown) {
  const ref = useRef<T>(null);
  const [atBottom, setAtBottom] = useState(true);

  // Read by the effect below without making it re-run and re-scroll
  const atBottomRef = useRef(true);
  atBottomRef.current = atBottom;

  const scrollToBottom = useCallback((smooth = false) => {
    const element = ref.current;
    if (!element) return;

    element.scrollTo({
      top: element.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto',
    });
  }, []);

  const onScroll = useCallback(() => {
    const element = ref.current;
    if (!element) return;

    const distance =
      element.scrollHeight - element.scrollTop - element.clientHeight;

    setAtBottom(distance <= NEAR_BOTTOM_PX);
  }, []);

  useEffect(() => {
    if (atBottomRef.current) scrollToBottom();
  }, [dependency, scrollToBottom]);

  /*
   * Images and embeds settle after the messages do, and each one that loads
   * pushes the newest message up out of view. Watching the content rather
   * than the message count is what keeps the bottom actually at the bottom.
   */
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      if (atBottomRef.current) scrollToBottom();
    });

    for (const child of Array.from(element.children)) {
      observer.observe(child);
    }

    return () => observer.disconnect();
  }, [dependency, scrollToBottom]);

  return { ref, atBottom, onScroll, scrollToBottom };
}
