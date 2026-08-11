import type { NostrEvent } from '@nostrify/nostrify';

/**
 * NIP-39, linking a profile to accounts elsewhere.
 *
 * A kind 10011 event carries `i` tags of the form
 * `["i", "<platform>:<identity>", "<proof>"]`, where the proof points at
 * something published on that platform containing the author's npub. The link
 * runs both ways — the Nostr key names the account, the account names the key
 * — and only both together mean anything.
 *
 * Nothing here verifies. Fetching a Gist, a tweet or a Mastodon post from the
 * browser means a cross-origin request that most of these platforms refuse, so
 * a client that tried would show "unverified" for real claims depending on who
 * blocks CORS this month, which is worse than not claiming to know. What this
 * does instead is build the proof URL so a reader can check in one click, and
 * never render a claim as though it had been checked.
 */

export const IDENTITY_KIND = 10011;

export interface IdentityClaim {
  /** Lowercased platform id, e.g. `github`. Never contains `:`. */
  platform: string;
  /** The account on that platform, normalised to lowercase. */
  identity: string;
  /** Points at the post proving control. Its shape is per-platform. */
  proof: string;
}

export interface PlatformSpec {
  id: string;
  label: string;
  /** What to ask for, in the words that platform uses. */
  identityLabel: string;
  identityPlaceholder: string;
  proofLabel: string;
  proofPlaceholder: string;
  /** Where the proof lives, so a reader can check it. */
  proofUrl(claim: IdentityClaim): string;
  /** The account itself, when it can be addressed directly. */
  profileUrl?(claim: IdentityClaim): string;
  /**
   * The text that must appear in the proof post. Exact, including quoting —
   * GitHub's is the one without quotes around the npub, and a client that
   * tells someone to post the wrong string produces a claim nobody can verify.
   */
  proofText(npub: string): string;
}

export const PLATFORMS: PlatformSpec[] = [
  {
    id: 'github',
    label: 'GitHub',
    identityLabel: 'Username',
    identityPlaceholder: 'semisol',
    proofLabel: 'Gist ID',
    proofPlaceholder: '9721ce4ee4fceb91c9711ca2a6c9a5ab',
    proofUrl: ({ identity, proof }) =>
      `https://gist.github.com/${identity}/${proof}`,
    profileUrl: ({ identity }) => `https://github.com/${identity}`,
    // No quotes around the npub here, unlike every other platform below
    proofText: (npub) =>
      `Verifying that I control the following Nostr public key: ${npub}`,
  },
  {
    id: 'twitter',
    label: 'X / Twitter',
    identityLabel: 'Username',
    identityPlaceholder: 'semisol_public',
    proofLabel: 'Tweet ID',
    proofPlaceholder: '1619358434134196225',
    proofUrl: ({ identity, proof }) =>
      `https://twitter.com/${identity}/status/${proof}`,
    profileUrl: ({ identity }) => `https://twitter.com/${identity}`,
    proofText: (npub) =>
      `Verifying my account on nostr My Public Key: "${npub}"`,
  },
  {
    id: 'mastodon',
    label: 'Mastodon',
    identityLabel: 'Instance and handle',
    identityPlaceholder: 'bitcoinhackers.org/@semisol',
    proofLabel: 'Post ID',
    proofPlaceholder: '109775066355589974',
    proofUrl: ({ identity, proof }) => `https://${identity}/${proof}`,
    profileUrl: ({ identity }) => `https://${identity}`,
    proofText: (npub) =>
      `Verifying that I control the following Nostr public key: "${npub}"`,
  },
  {
    id: 'telegram',
    label: 'Telegram',
    identityLabel: 'User ID',
    identityPlaceholder: '1087295469',
    proofLabel: 'Channel and message',
    proofPlaceholder: 'nostrdirectory/770',
    proofUrl: ({ proof }) => `https://t.me/${proof}`,
    proofText: (npub) =>
      `Verifying that I control the following Nostr public key: "${npub}"`,
  },
];

const BY_ID = new Map(PLATFORMS.map((platform) => [platform.id, platform]));

export function platformSpec(id: string): PlatformSpec | undefined {
  return BY_ID.get(id.toLowerCase());
}

/** Platform names are restricted to these, and must not contain `:`. */
const PLATFORM_PATTERN = /^[a-z0-9._\-/]+$/;

/**
 * Splits `platform:identity` at the first colon only.
 *
 * The first, because the platform half is the one forbidden to contain a
 * colon — the identity half has no such rule, and splitting greedily would
 * mangle any future platform whose usernames contain one.
 */
export function parseIdentityClaim(tag: string[]): IdentityClaim | null {
  const [name, joined, proof] = tag;
  if (name !== 'i' || !joined || !proof) return null;

  const separator = joined.indexOf(':');
  if (separator <= 0) return null;

  const platform = joined.slice(0, separator).trim().toLowerCase();
  const identity = joined.slice(separator + 1).trim();

  if (!platform || !identity || !PLATFORM_PATTERN.test(platform)) return null;

  /**
   * Identities are normalised to lowercase, as the spec asks. Only the
   * identity: the proof is an opaque id and case can be significant in one.
   */
  return { platform, identity: identity.toLowerCase(), proof: proof.trim() };
}

/**
 * Every claim on an identity event.
 *
 * Tags with more than the two required values are kept, not dropped — "Clients
 * SHOULD process any `i` tags with more than 2 values for future
 * extensibility", so extra values are ignored rather than treated as making
 * the tag malformed.
 */
export function readIdentityClaims(event: NostrEvent | undefined): IdentityClaim[] {
  if (!event || event.kind !== IDENTITY_KIND) return [];

  const claims: IdentityClaim[] = [];
  const seen = new Set<string>();

  for (const tag of event.tags) {
    const claim = parseIdentityClaim(tag);
    if (!claim) continue;

    const key = `${claim.platform}:${claim.identity}`;
    if (seen.has(key)) continue;

    seen.add(key);
    claims.push(claim);
  }

  return claims;
}

/** The `i` tags for a set of claims, ready to publish as kind 10011. */
export function buildIdentityTags(claims: IdentityClaim[]): string[][] {
  return claims.map((claim) => [
    'i',
    `${claim.platform}:${claim.identity}`,
    claim.proof,
  ]);
}

/** Where the proof lives, or null for a platform this client does not know. */
export function proofUrl(claim: IdentityClaim): string | null {
  return platformSpec(claim.platform)?.proofUrl(claim) ?? null;
}

/** The account itself, when the platform can be linked to directly. */
export function profileUrl(claim: IdentityClaim): string | null {
  return platformSpec(claim.platform)?.profileUrl?.(claim) ?? null;
}

/** What to call a claim on screen. */
export function describeClaim(claim: IdentityClaim): string {
  const spec = platformSpec(claim.platform);
  return `${spec?.label ?? claim.platform}: ${claim.identity}`;
}

export interface ClaimProblem {
  field: 'identity' | 'proof';
  message: string;
}

/**
 * Whether a claim is well-formed enough to publish.
 *
 * Shape only — that the Gist exists and says the right thing is not knowable
 * from here. Catching the shape still helps: a Gist *URL* pasted where the id
 * belongs produces a proof link that 404s, and the author has no reason to
 * suspect it until somebody tells them.
 */
export function validateClaim(claim: IdentityClaim): ClaimProblem | null {
  if (!claim.identity.trim()) {
    return { field: 'identity', message: 'Required.' };
  }

  if (claim.identity.includes(' ')) {
    return { field: 'identity', message: 'No spaces.' };
  }

  if (!claim.proof.trim()) {
    return { field: 'proof', message: 'Required.' };
  }

  if (/^https?:\/\//i.test(claim.proof)) {
    return {
      field: 'proof',
      message: 'Just the id, not the whole URL.',
    };
  }

  if (claim.platform === 'mastodon' && !claim.identity.includes('/@')) {
    return {
      field: 'identity',
      message: 'Use instance/@username, like bitcoinhackers.org/@semisol.',
    };
  }

  if (claim.platform === 'telegram' && !claim.proof.includes('/')) {
    return {
      field: 'proof',
      message: 'Use channel/message-id, like nostrdirectory/770.',
    };
  }

  return null;
}
