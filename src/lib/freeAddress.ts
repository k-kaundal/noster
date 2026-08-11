/**
 * The address someone gets without paying for one.
 *
 * Two tiers, and the difference between them is the *name*, not whether money
 * arrives. A free address works exactly as well as a paid one — it receives
 * zaps from every client, forever. What it does not do is say who you are:
 * it is assigned, not chosen, and looks it.
 *
 * That is deliberate, and worth being honest about in the UI rather than
 * dressing up. Someone who wants `alice@` can buy `alice@`; someone who does
 * not still gets paid. A free tier that could not receive money would push
 * people off Nostr rather than towards a purchase.
 */

/**
 * Derived from the pubkey rather than randomly generated.
 *
 * Three things fall out of that, all of which matter more than novelty:
 *
 * - **Stable.** The same key produces the same address on every device and
 *   after every reinstall, so an address handed to somebody keeps working and
 *   re-claiming is idempotent rather than a second address.
 * - **Unique without asking.** Pubkeys do not collide, so neither do these —
 *   no availability check, no retry loop, no race between two people claiming
 *   at once.
 * - **Nothing leaked.** It is a slice of a public key, published next to that
 *   same key in the profile it goes on.
 */
const PREFIX = 'u';

/** How much of the key to use. Long enough not to collide, short enough to type. */
const LENGTH = 12;

export function generateFreeName(pubkey: string): string {
  const hex = pubkey.trim().toLowerCase().replace(/[^0-9a-f]/g, '');

  /**
   * A pubkey that is not hex at all should still produce something usable
   * rather than an empty local part, which LNbits would reject and which
   * would leave someone with no address at all.
   */
  if (hex.length < LENGTH) {
    return `${PREFIX}${hex.padEnd(LENGTH, '0')}`.slice(0, PREFIX.length + LENGTH);
  }

  return `${PREFIX}${hex.slice(0, LENGTH)}`;
}

/**
 * Whether a name looks like one this app assigned.
 *
 * Used to tell "you have a free address" from "you chose this name", which
 * decides whether to offer the upgrade. Matched on shape rather than kept in
 * storage, so it still works for an address claimed on another device.
 */
export function isGeneratedName(name: string): boolean {
  return new RegExp(`^${PREFIX}[0-9a-f]{${LENGTH}}$`).test(name.trim().toLowerCase());
}

/** Whether this person is still on the assigned name. */
export function hasChosenName(name: string | null | undefined): boolean {
  return !!name && !isGeneratedName(name);
}

/** What a person is allowed to hold, at the moment they ask for a name. */
export interface ClaimEntitlement {
  /** The name derived from their key. Always theirs, free, and only theirs. */
  freeName: string;
  /** Names they have bought — a paid NIP-05 name earns the matching address. */
  paidNames: string[];
  /** Names they already hold; re-claiming one is idempotent, not a new grant. */
  ownedNames: (string | undefined)[];
}

/**
 * Whether this person may claim this name.
 *
 * The gate between the tiers, in the one place every claim passes through.
 * Without it the free tier is not a tier: the claim endpoint takes any name,
 * so anyone could type `alice` into the "add another" box and have for nothing
 * the thing the verified-name flow charges for. Checking it in the UI alone
 * would leave the loophole one direct call away.
 *
 * Deliberately permissive about names already held. Someone who bought a name
 * last year and reconnects today is re-claiming, and the request is answered
 * from the pay link that already exists — refusing it because their receipt is
 * not in this list would lock them out of their own address.
 */
export function mayClaim(username: string, entitlement: ClaimEntitlement): boolean {
  const wanted = username.trim().toLowerCase();
  if (!wanted) return false;

  const allowed = [
    entitlement.freeName,
    ...entitlement.paidNames,
    ...entitlement.ownedNames,
  ];

  return allowed.some((name) => name?.trim().toLowerCase() === wanted);
}
