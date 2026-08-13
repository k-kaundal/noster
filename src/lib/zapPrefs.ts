/**
 * How somebody wants zapping to feel.
 *
 * Two modes, and the difference is who the flow is for. Choosing an amount
 * every time is right when the amount is the point — a big one, a specific
 * one, one with something to say. Most zaps are not that: they are the same
 * small amount, sent because a post was good, and a dialog for those is three
 * taps where one would do.
 *
 * So one-tap sending is on by default, with the amount and message decided
 * once in settings. It stays honest about what it is: the button says what it
 * will send, holding it opens the dialog instead, and the amount is small
 * enough that a mis-tap costs less than a coffee. Anyone who would rather
 * choose every time turns it off in one switch.
 */

/** What a zap sends when nobody has changed anything. */
export const DEFAULT_ZAP_SATS = 50;

/** Below this, no lightning invoice is payable at all. */
export const MIN_ZAP_SATS = 1;

/**
 * A ceiling on one-tap sends, whatever is configured.
 *
 * Not on zaps — the dialog will send whatever somebody types. This is on the
 * mode where a single tap moves money with no confirmation, and it exists
 * because the failure there is silent and repeatable: a mis-tap on a phone
 * costs a real amount, and a mis-tap on a list of posts costs it several
 * times.
 */
export const MAX_ONE_TAP_SATS = 10_000;

export interface ZapPrefs {
  /** Sats a one-tap zap sends, and the amount the dialog opens on. */
  amount: number;
  /** Sent with every zap unless the dialog is used and the text changed. */
  message: string;
  /**
   * Whether tapping ⚡ pays immediately rather than opening the dialog.
   *
   * On by default. The dialog remains reachable either way — holding the
   * button opens it, on every surface.
   */
  oneTap: boolean;
}

/**
 * Marks prefs as written by a version of the app that had these defaults.
 *
 * Without it there is no way to tell "chose 21 sats and no instant send" from
 * "was given them", and changing a default would silently leave everybody on
 * the old one — stored values always win, so an unmarked record has to be
 * read as never configured.
 *
 * Bump only when a default changes in a way everyone should get.
 */
export const ZAP_PREFS_VERSION = 2;

export const DEFAULT_ZAP_PREFS: ZapPrefs = {
  amount: DEFAULT_ZAP_SATS,
  message: '',
  oneTap: true,
};

/**
 * Messages worth having ready.
 *
 * A zap with words attached is worth more than one without — the amount says
 * how much, the message says what for — and most people will not type one
 * every time. These are deliberately short and specific: "thanks" applied to
 * everything says nothing, while "this helped" is a fact about the post.
 */
export const MESSAGE_PRESETS = [
  '',
  '⚡',
  'Great post',
  'This helped',
  'Thanks for writing this',
  'Keep going',
] as const;

/**
 * Reads stored preferences, repairing anything unusable.
 *
 * Storage is edited by hand, survives releases, and arrives from another
 * device. An amount of `"lots"` or `-5` has to become a number that can be
 * paid rather than an invoice nobody can settle.
 */
export function readZapPrefs(stored: unknown): ZapPrefs {
  if (!stored || typeof stored !== 'object') return DEFAULT_ZAP_PREFS;

  const prefs = stored as Partial<ZapPrefs> & { version?: number };

  // Written before this version's defaults existed, so it records no choice
  if (prefs.version !== ZAP_PREFS_VERSION) return DEFAULT_ZAP_PREFS;

  const amount = Number(prefs.amount);
  const usable = Number.isFinite(amount) && amount >= MIN_ZAP_SATS;

  return {
    amount: usable ? Math.floor(amount) : DEFAULT_ZAP_SATS,
    message: typeof prefs.message === 'string' ? prefs.message.slice(0, 200) : '',
    // Anything but an explicit false leaves it on, which is the default
    oneTap: prefs.oneTap !== false,
  };
}

export type ZapBlocker =
  /** Nobody is signed in. */
  | 'signed-out'
  /** The recipient published no lightning address, so nobody can pay them. */
  | 'no-address'
  /** Their own note. */
  | 'self'
  /** One-tap is on but there is no wallet to send from. */
  | 'no-wallet'
  /** There is a wallet and not enough in it. */
  | 'insufficient'
  /** Too large to move without confirming, whatever the setting says. */
  | 'over-limit'
  | null;

export interface ZapReadiness {
  /** Whether a one-tap send can go through right now. */
  canOneTap: boolean;
  /** Why not, when it cannot. */
  blocker: ZapBlocker;
}

/**
 * Whether a one-tap zap can actually happen, and what to say when it cannot.
 *
 * The distinction that matters: some blockers should disable the button and
 * some should not. Nobody can pay a person with no lightning address, so that
 * one is dead everywhere. But having no wallet only blocks *one-tap* — the
 * dialog can still produce an invoice to pay from a phone — so it must not
 * disable the control, only fall back.
 */
export function zapReadiness(input: {
  signedIn: boolean;
  isSelf: boolean;
  recipientHasAddress: boolean;
  hasWallet: boolean;
  balanceSats: number;
  amount: number;
}): ZapReadiness {
  if (!input.signedIn) return { canOneTap: false, blocker: 'signed-out' };
  if (input.isSelf) return { canOneTap: false, blocker: 'self' };
  if (!input.recipientHasAddress) {
    return { canOneTap: false, blocker: 'no-address' };
  }

  /*
   * Checked before the wallet, because it is a fact about the amount rather
   * than about this device: a stored setting above the ceiling should fall
   * back to the dialog on every device, whether or not one of them happens to
   * have a wallet connected.
   */
  if (input.amount > MAX_ONE_TAP_SATS) {
    return { canOneTap: false, blocker: 'over-limit' };
  }

  if (!input.hasWallet) return { canOneTap: false, blocker: 'no-wallet' };

  /*
   * Compared against the balance the app can see, which is the custodial
   * one. A connected NWC wallet does not report a balance here, and its
   * absence is not evidence of an empty wallet — so a zero balance blocks
   * only when this app is the wallet.
   */
  if (input.balanceSats < input.amount) {
    return { canOneTap: false, blocker: 'insufficient' };
  }

  return { canOneTap: true, blocker: null };
}

/** What to tell somebody about a blocker, or nothing when it is not theirs. */
export function describeBlocker(
  blocker: ZapBlocker,
  amount: number
): string | null {
  switch (blocker) {
    case 'no-address':
      return 'They have no lightning address, so nobody can zap them.';
    case 'self':
      return "You can't zap your own note.";
    case 'no-wallet':
      return 'Connect a wallet to send instantly. You can still zap by invoice.';
    case 'insufficient':
      return `Not enough sats for a ${amount.toLocaleString()} sat zap.`;
    case 'over-limit':
      return `Amounts over ${MAX_ONE_TAP_SATS.toLocaleString()} sats are confirmed before sending.`;
    case 'signed-out':
      return 'Log in to zap.';
    default:
      return null;
  }
}
