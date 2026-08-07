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

/**
 * Configs stored before multi-relay support have no `relays` array, and those
 * stored before theming have no `accent`. Both are optional here and
 * backfilled, so an older saved config still parses.
 */
export const AppConfigSchema: z.ZodType<AppConfig, z.ZodTypeDef, unknown> = z
  .object({
    theme: z.enum(['dark', 'light', 'system']),
    accent: z.string().optional(),
    relayUrl: z.string().url(),
    relays: z.array(RelayEntrySchema).optional(),
  })
  .transform((config) => ({
    ...config,
    accent: config.accent ?? DEFAULT_ACCENT,
    relays: config.relays?.length
      ? config.relays
      : [{ url: config.relayUrl, read: true, write: true }],
  }));

export const AppContext = createContext<AppContextType | undefined>(undefined);
