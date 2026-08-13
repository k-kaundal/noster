/**
 * The money services NostrFeed runs, promoted inside the app.
 *
 * Kept as data in one file because this is marketing copy: it changes for
 * reasons that have nothing to do with the code, and hunting it across three
 * components every time a tagline is reworded is how it goes stale instead.
 *
 * Everything here is public — three URLs anyone can visit — so none of it is
 * configuration in the secret sense.
 */
export interface Service {
  id: 'lightning' | 'mint' | 'wallet' | 'names';
  name: string;
  host: string;
  url: string;
  /** One line, said as a promise rather than a feature. */
  tagline: string;
  /** Two or three sentences for the card body. */
  body: string;
  /** Short, concrete claims. Three at most — a fourth stops being read. */
  points: string[];
  /** Text on the button. */
  cta: string;
  /** Where the same thing lives inside this app, when it does. */
  internalPath?: string;
  internalLabel?: string;
}

export const SERVICES: Service[] = [
  {
    /**
     * The name, sold on its own terms.
     *
     * It was missing from this page entirely, which made the best thing here
     * the hardest to find: the wallet and the mint are infrastructure people
     * accept, and the name is the part somebody actually wants and pays for.
     * It runs on the same LNbits instance as the wallet — one service on
     * several hostnames — but a domain is not an implementation detail when
     * it is the thing being bought.
     */
    id: 'names',
    name: 'GetZap',
    host: 'getzap.me',
    url: 'https://getzap.me',
    tagline: 'A name people can zap.',
    body: 'Your own name at getzap.me — short, memorable, and yours. It takes zaps from any Nostr client and puts a ✓ against everything you post.',
    points: [
      'you@getzap.me, for zaps and identity',
      'A ✓ on every post, verified by NIP-05',
      'Paid into whichever wallet you choose',
    ],
    cta: 'Get your name',
    internalPath: '/wallet',
    internalLabel: 'Claim it here',
  },
  {
    id: 'lightning',
    name: 'NostrFeed Lightning',
    host: 'ln.nostrfeed.com',
    url: 'https://ln.nostrfeed.com',
    tagline: 'A lightning wallet that opens with your Nostr key.',
    body: 'No signup, no password, no email. Sign once to prove the key is yours and the wallet is there — with a lightning address people can zap from any Nostr client.',
    points: [
      'Your Nostr key is the account',
      'A free address, at ln.nostrfeed.com or getzap.me',
      'Send and receive in seconds',
    ],
    cta: 'Open the wallet',
    internalPath: '/wallet',
    internalLabel: 'Set it up here',
  },
  {
    id: 'mint',
    name: 'NostrFeed Mint',
    host: 'mint.nostrfeed.com',
    url: 'https://mint.nostrfeed.com',
    tagline: 'Ecash the mint cannot trace back to you.',
    body: 'A Cashu mint. Sats become blinded tokens the mint signs without being able to read, so it knows some were issued and some were spent — not that the same person did both.',
    points: [
      'Bearer tokens, held by you',
      'Works in any Cashu wallet',
      'Lightning in, lightning out',
    ],
    cta: 'Use the mint',
    internalPath: '/ecash',
    internalLabel: 'Hold ecash here',
  },
  {
    id: 'wallet',
    name: 'NostrFeed Wallet',
    host: 'wallet.nostrfeed.com',
    url: 'https://wallet.nostrfeed.com',
    tagline: 'The whole wallet, in its own tab.',
    body: 'The full wallet as a site of its own — open it on any device, on any browser, without the feed around it. The same wallet as ln.nostrfeed.com behind a different door: one balance, one key, more room to work.',
    points: [
      'Every device, one balance',
      'Nothing to install',
      'Opens straight to your sats',
    ],
    cta: 'Open wallet.nostrfeed.com',
  },
];

export function serviceById(id: Service['id']): Service {
  const service = SERVICES.find((entry) => entry.id === id);
  if (!service) throw new Error(`Unknown service: ${id}`);
  return service;
}
