import type { NostrMetadata } from '@nostrify/nostrify';

/**
 * What a new account still has to do, read from the profile it already has.
 *
 * Deliberately answered from kind 0 alone. Every field below is in the
 * metadata the app has already fetched to draw somebody's avatar, so asking
 * this question costs nothing — which is what makes it affordable in the left
 * rail, on every page, rather than on a settings screen nobody visits twice.
 *
 * The tempting extra steps all cost a request. "Follow some people" needs a
 * kind 3, "buy a name" needs LNbits, "join the paid relay" needs a
 * cross-origin check. Each would turn a decoration into a fetch on every page
 * load, and none of them is more urgent than having a name and a way to be
 * paid.
 */
export interface SetupStep {
  id: 'name' | 'picture' | 'about' | 'address';
  /** Two or three words, for a row. */
  label: string;
  /** Where pressing it goes. */
  href: string;
  done: boolean;
}

export function setupSteps(
  metadata: NostrMetadata | undefined,
  /**
   * Where this person's own profile lives.
   *
   * Taken rather than written, because there is no `/profile` route — a
   * profile is addressed by npub, and hardcoding a tidier-looking path here
   * sent every step to the 404 page.
   */
  profilePath: string
): SetupStep[] {
  const has = (value: string | undefined) => !!value?.trim();

  return [
    {
      id: 'name',
      label: 'Pick a display name',
      href: profilePath,
      done: has(metadata?.display_name) || has(metadata?.name),
    },
    {
      id: 'picture',
      label: 'Add a profile picture',
      href: profilePath,
      done: has(metadata?.picture),
    },
    {
      id: 'about',
      label: 'Write a short bio',
      href: profilePath,
      done: has(metadata?.about),
    },
    {
      /*
       * Last, and pointed at the wallet rather than the profile form, because
       * it is the only step that is not typing: the address has to be claimed
       * before there is anything to publish.
       */
      id: 'address',
      label: 'Turn on zaps',
      href: '/wallet',
      done: has(metadata?.lud16) || has(metadata?.lud06),
    },
  ];
}

export interface SetupProgress {
  steps: SetupStep[];
  done: number;
  total: number;
  /** The first thing still outstanding, or null when there is none. */
  next: SetupStep | null;
  /** Whether there is anything left worth showing a card for. */
  complete: boolean;
}

export function setupProgress(
  metadata: NostrMetadata | undefined,
  profilePath: string
): SetupProgress {
  const steps = setupSteps(metadata, profilePath);
  const done = steps.filter((step) => step.done).length;

  return {
    steps,
    done,
    total: steps.length,
    next: steps.find((step) => !step.done) ?? null,
    complete: done === steps.length,
  };
}
