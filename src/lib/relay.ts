/** Helpers for normalizing, comparing and displaying relay URLs. */

/** A relay in the user's list, with NIP-65 read/write intent. */
export interface RelayEntry {
  url: string;
  /** Query this relay for events. */
  read: boolean;
  /** Publish this user's events here. */
  write: boolean;
}

/**
 * Canonical form of a relay URL: `wss://` scheme, no trailing slash, lowercase
 * host. Two entries that normalize alike are the same relay.
 */
export function normalizeRelayUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';

  const withScheme = /^wss?:\/\//i.test(trimmed)
    ? trimmed
    : `wss://${trimmed.replace(/^\/+/, '')}`;

  try {
    const url = new URL(withScheme);
    url.hostname = url.hostname.toLowerCase();
    if (url.pathname === '/') url.pathname = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

/** True when the input parses as a usable `ws://` or `wss://` endpoint. */
export function isValidRelayUrl(input: string): boolean {
  const normalized = normalizeRelayUrl(input);
  if (!normalized) return false;
  try {
    const url = new URL(normalized);
    return (
      (url.protocol === 'wss:' || url.protocol === 'ws:') && !!url.hostname
    );
  } catch {
    return false;
  }
}

/** Host and path, for compact display: `wss://relay.damus.io` -> `relay.damus.io`. */
export function relayDisplayName(url: string): string {
  return url.replace(/^wss?:\/\//i, '').replace(/\/$/, '');
}

/** The HTTPS origin used to fetch a relay's NIP-11 document. */
export function relayHttpUrl(url: string): string {
  return url.replace(/^ws:/i, 'http:').replace(/^wss:/i, 'https:');
}

/** Removes duplicates while preserving order, merging read/write intent. */
export function dedupeRelays(entries: RelayEntry[]): RelayEntry[] {
  const merged = new Map<string, RelayEntry>();

  for (const entry of entries) {
    const url = normalizeRelayUrl(entry.url);
    if (!url) continue;

    const existing = merged.get(url);
    merged.set(url, {
      url,
      read: (existing?.read ?? false) || entry.read,
      write: (existing?.write ?? false) || entry.write,
    });
  }

  return [...merged.values()];
}

/** Relays to query, falling back to the whole list if none are marked read. */
export function readRelays(entries: RelayEntry[]): string[] {
  const reads = entries.filter((entry) => entry.read).map((entry) => entry.url);
  return reads.length ? reads : entries.map((entry) => entry.url);
}

/** Relays to publish to, falling back to the whole list if none are marked write. */
export function writeRelays(entries: RelayEntry[]): string[] {
  const writes = entries.filter((entry) => entry.write).map((entry) => entry.url);
  return writes.length ? writes : entries.map((entry) => entry.url);
}

/** Builds NIP-65 `r` tags, omitting the marker when a relay is read+write. */
export function toRelayListTags(entries: RelayEntry[]): string[][] {
  return entries
    .filter((entry) => entry.read || entry.write)
    .map((entry) => {
      if (entry.read && entry.write) return ['r', entry.url];
      return ['r', entry.url, entry.read ? 'read' : 'write'];
    });
}

/** Parses NIP-65 `r` tags back into entries. A missing marker means read+write. */
export function fromRelayListTags(tags: string[][]): RelayEntry[] {
  const entries: RelayEntry[] = [];

  for (const [name, url, marker] of tags) {
    if (name !== 'r' || !url) continue;
    const normalized = normalizeRelayUrl(url);
    if (!normalized) continue;

    entries.push({
      url: normalized,
      read: marker !== 'write',
      write: marker !== 'read',
    });
  }

  return dedupeRelays(entries);
}
