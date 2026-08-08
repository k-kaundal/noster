import { NostrMetadata, NostrSigner } from "@nostrify/nostrify";
import { createContext } from "react";

import { z } from 'zod';
import type { RelayEntry } from '@/lib/relay';
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

const RelayEntrySchema = z.object({
  url: z.string().url(),
  read: z.boolean(),
  write: z.boolean(),
});

/** This platform's own relay, which every install should be reading from. */
export const HOUSE_RELAY = 'wss://relay.nostrfeed.com';

/**
 * Configs stored before multi-relay support have no `relays` array, and those
 * stored before theming have no `accent`. Both are optional here and
 * backfilled, so an older saved config still parses.
 *
 * The house relay is also added to older configs that predate it. Their stored
 * list would otherwise never include it, so existing users would silently keep
 * reading from everywhere except our own relay. Removing it afterwards is
 * still their call — this only seeds it, and only once, because the result is
 * written back to storage.
 */
export const AppConfigSchema: z.ZodType<AppConfig, z.ZodTypeDef, unknown> = z
  .object({
    theme: z.enum(['dark', 'light', 'system']),
    accent: z.string().optional(),
    relayUrl: z.string().url(),
    relays: z.array(RelayEntrySchema).optional(),
    /** Set once the house relay has been seeded, so a removal isn't undone. */
    seededHouseRelay: z.boolean().optional(),
  })
  .transform((config) => {
    const relays = config.relays?.length
      ? config.relays
      : [{ url: config.relayUrl, read: true, write: true }];

    const needsHouseRelay =
      !config.seededHouseRelay && !relays.some((r) => r.url === HOUSE_RELAY);

    return {
      ...config,
      accent: config.accent ?? DEFAULT_ACCENT,
      seededHouseRelay: true,
      // Seeded at the head, since the routers treat list order as priority
      relays: needsHouseRelay
        ? [{ url: HOUSE_RELAY, read: true, write: true }, ...relays]
        : relays,
    };
  });

export const AppContext = createContext<AppContextType | undefined>(undefined);
