import { NostrMetadata, NostrSigner } from "@nostrify/nostrify";
import { createContext } from "react";

import { dedupeRelays, normalizeRelayUrl, type RelayEntry } from '@/lib/relay';
import { DEFAULT_ACCENT } from '@/lib/theme';

export type Theme = 'dark' | 'light' | 'system';

export interface AppConfig {
  theme: Theme;
  /** Id of the accent palette applied on top of the light/dark mode. */
  accent: string;
  /** The primary relay — used for single-relay operations and as a fallback. */
  relayUrl: string;
  /** Every relay the user has enabled, with NIP-65 read/write intent. */
  relays: RelayEntry[];
  /**
   * Whether the house relay has already been seeded into `relays`. Without
   * this the migration would re-add it every load, undoing a deliberate
   * removal.
   */
  seededHouseRelay?: boolean;
}

export interface AppContextType {
  config: AppConfig;
  updateConfig: (updater: (currentConfig: AppConfig) => AppConfig) => void;
  presetRelays?: { name: string; url: string; active?: boolean }[];
  syncAccountToRelays: (signer: NostrSigner, profileData?: NostrMetadata, contacts?: string[]) => Promise<void>;
}

/** This platform's own relay, which every install should be reading from. */
export const HOUSE_RELAY = 'wss://relay.nostrfeed.com';

/** Whether a string is a URL at all. Relay URLs are `wss:`, not `https:`. */
function isUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value) return false;

  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function isRelayEntry(value: unknown): value is RelayEntry {
  if (!value || typeof value !== 'object') return false;

  const entry = value as Record<string, unknown>;
  return (
    isUrl(entry.url) &&
    typeof entry.read === 'boolean' &&
    typeof entry.write === 'boolean'
  );
}

/**
 * Reads a stored config, migrating older shapes forward.
 *
 * Hand-written rather than a schema library. This is the only validation left
 * in the app, it runs once per load, and the library that used to do it was
 * the largest thing in the first chunk the browser had to parse — a hundred
 * and forty kilobytes to check five fields.
 *
 * Throws on anything it cannot make sense of, which `useLocalStorage` catches
 * and answers with the defaults. A corrupt config should reset, not crash.
 *
 * Two migrations live here. Configs stored before multi-relay support have no
 * `relays` array and configs stored before theming have no `accent`; both are
 * backfilled. And the house relay is seeded into lists that predate it, since
 * those users would otherwise read from everywhere except our own relay —
 * seeded once only, because the result is written back, so removing it stays
 * the user's decision.
 */
export function parseAppConfig(value: unknown): AppConfig {
  if (!value || typeof value !== 'object') {
    throw new Error('Stored config is not an object');
  }

  const stored = value as Record<string, unknown>;
  const { theme } = stored;

  if (theme !== 'dark' && theme !== 'light' && theme !== 'system') {
    throw new Error(`Stored config has an unknown theme: ${String(theme)}`);
  }

  if (!isUrl(stored.relayUrl)) {
    throw new Error('Stored config has no usable relay URL');
  }

  const relayUrl = normalizeRelayUrl(stored.relayUrl) || stored.relayUrl;

  const listed = Array.isArray(stored.relays)
    ? stored.relays.filter(isRelayEntry)
    : [];

  /**
   * Canonical form, every load.
   *
   * The pool opens one socket per distinct string it is handed, so a list
   * holding both `wss://nos.lol` and `wss://nos.lol/` is two connections to
   * one relay — and the health probes, the header dot and the relay page all
   * double up behind it. Older builds stored whatever was typed or imported
   * from a NIP-65 list, so this runs on read rather than only on write, and
   * the result is written back.
   */
  const relays = dedupeRelays(
    listed.length ? listed : [{ url: relayUrl, read: true, write: true }]
  );

  const needsHouseRelay =
    stored.seededHouseRelay !== true &&
    !relays.some((relay) => relay.url === HOUSE_RELAY);

  return {
    theme,
    accent: typeof stored.accent === 'string' ? stored.accent : DEFAULT_ACCENT,
    relayUrl,
    seededHouseRelay: true,
    // Seeded at the head, since the routers treat list order as priority
    relays: needsHouseRelay
      ? [{ url: HOUSE_RELAY, read: true, write: true }, ...relays]
      : relays,
  };
}

export const AppContext = createContext<AppContextType | undefined>(undefined);
