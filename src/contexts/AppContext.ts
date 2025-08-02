import { NostrSigner } from "@nostrify/nostrify";
import { createContext } from "react";

import { z } from 'zod';

export type Theme = 'dark' | 'light' | 'system';

export interface AppConfig {
  theme: Theme;
  relayUrl: string;
}

export interface AppContextType {
  config: AppConfig;
  updateConfig: (updater: (currentConfig: AppConfig) => AppConfig) => void;
  presetRelays?: { name: string; url: string; active?: boolean }[];
  syncAccountToRelays: (signer: NostrSigner, profileData?: any, contacts?: string[]) => Promise<void>;
}

export const AppConfigSchema: z.ZodType<AppConfig, z.ZodTypeDef, unknown> = z.object({
  theme: z.enum(['dark', 'light', 'system']),
  relayUrl: z.string().url(),
});

export const AppContext = createContext<AppContextType | undefined>(undefined);
