import type { ReactNode } from 'react';
import { ringFor, type RingStyle } from '@/lib/avatarRing';
import { cn } from '@/lib/utils';

/**
 * Wraps an avatar in whatever ring its owner has earned and chosen.
 *
 * Takes metadata rather than a pubkey on purpose: every place that draws an
 * avatar has already fetched the profile, and asking for it again here would
 * put a second lookup behind every face on the screen. The entitlement check
 * happens inside `ringFor`, from the lightning address in that same metadata,
 * so a ring somebody is not entitled to simply does not render — for them or
 * for anyone else.
 */
export function AvatarRing({
  metadata,
  children,
  className,
  /** Forces a specific ring, for the picker's own previews. */
  preview,
}: {
  metadata?: Record<string, unknown>;
  children: ReactNode;
  className?: string;
  preview?: RingStyle | null;
}) {
  const style = preview !== undefined ? preview : ringFor(metadata);

  // Nothing to draw, and nothing to wrap it in
  if (!style) return <>{children}</>;

  return (
    /*
     * No `aria-hidden` here, though the ring is decorative: it is drawn on a
     * pseudo-element, which assistive tech never sees in the first place, and
     * hiding this element would take the avatar inside it along too.
     */
    <span className={cn('avatar-ring', style.className, className)}>
      {children}
    </span>
  );
}
