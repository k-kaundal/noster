/**
 * Where uploaded media goes.
 *
 * Blossom servers, addressed by the hash of the file — which is what makes a
 * list useful rather than merely redundant. The same upload has the same URL
 * path on every server, so a file that survives on any one of them stays
 * reachable, and a server going away does not rot the note that embedded it.
 */
export interface UploadServer {
  url: string;
  label: string;
}

const DEFAULTS: UploadServer[] = [
  { url: 'https://blossom.band/', label: 'blossom.band' },
  { url: 'https://blossom.primal.net/', label: 'blossom.primal.net' },
  { url: 'https://nostr.build/', label: 'nostr.build' },
];

/**
 * The configured servers, in the order they are tried.
 *
 * Order is the whole configuration: the first that accepts the file wins, and
 * the rest exist so an outage costs a retry rather than the upload.
 */
export function uploadServers(): UploadServer[] {
  const configured = (import.meta.env.VITE_BLOSSOM_SERVERS || '')
    .split(',')
    .map((entry: string) => entry.trim())
    .filter(Boolean)
    .map((url: string) => ({ url: normalizeServer(url), label: hostOf(url) }));

  return configured.length ? configured : DEFAULTS;
}

/** Blossom paths are appended to the server root, so it needs its slash. */
export function normalizeServer(url: string): string {
  const trimmed = url.trim();
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  return withScheme.endsWith('/') ? withScheme : `${withScheme}/`;
}

export function hostOf(url: string): string {
  try {
    return new URL(normalizeServer(url)).hostname;
  } catch {
    return url;
  }
}

/**
 * One message naming every server that refused.
 *
 * "Upload failed" after trying three servers hides which of them is broken,
 * and whether the file itself was the problem — a size limit rejected by all
 * three reads very differently from one host being down.
 */
export function describeUploadFailure(
  failures: { label: string; message: string }[]
): string {
  if (!failures.length) return 'No upload server is configured.';

  if (failures.length === 1) {
    return `${failures[0].label} refused it: ${failures[0].message}`;
  }

  return `No server accepted it. ${failures
    .map((failure) => `${failure.label}: ${failure.message}`)
    .join('; ')}`;
}
