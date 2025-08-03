import { ReactNode, useEffect, useCallback } from 'react';
import { z } from 'zod';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { AppContext, type AppConfig, type AppContextType, type Theme } from '@/contexts/AppContext';
import { SimplePool, Event, EventTemplate, Filter } from 'nostr-tools';
import { NostrSigner } from '@nostrify/nostrify';

// Validation schemas remain unchanged
const ProfileSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  about: z.string().max(500).optional(),
  picture: z.string().url().optional(),
  lud16: z.string().email().optional(),
});

const ContactsSchema = z.array(z.string().regex(/^[0-9a-f]{64}$/, 'Invalid pubkey'));

const AppConfigSchema: z.ZodType<AppConfig, z.ZodTypeDef, unknown> = z.object({
  theme: z.enum(['dark', 'light', 'system']),
  relayUrl: z.string().url(),
});

interface AppProviderProps {
  children: ReactNode;
  storageKey: string;
  defaultConfig: AppConfig;
  presetRelays?: { name: string; url: string; active?: boolean }[];
}

export function AppProvider(props: AppProviderProps) {
  const { children, storageKey, defaultConfig, presetRelays } = props;

  const [config, setConfig] = useLocalStorage<AppConfig>(
    storageKey,
    defaultConfig,
    {
      serialize: JSON.stringify,
      deserialize: (value: string) => {
        const parsed = JSON.parse(value);
        return AppConfigSchema.parse(parsed);
      },
    }
  );

  const updateConfig = useCallback((updater: (currentConfig: AppConfig) => AppConfig) => {
    setConfig(updater);
  }, [setConfig]);

  const syncAccountToRelays = useCallback(
    async (
      user: NostrSigner,
      profileData?: any,
      contacts?: string[],
      options: { forceSync?: boolean; relayUrls?: string[] } = {}
    ) => {
      const { forceSync = false, relayUrls } = options;
      const relays = relayUrls || (presetRelays?.filter(relay => relay.active).map(relay => relay.url) || [config.relayUrl]);
      const pool = new SimplePool();
      const events: Event[] = [];

      // Get pubkey from user
      let pubkey: string;
      try {
        pubkey = await user.getPublicKey();
      } catch (error) {
        console.error('Failed to get public key:', error);
        throw new Error('No public key available for user');
      }

      // Validate profile data
      let validatedProfile: any = null;
      if (profileData) {
        try {
          validatedProfile = ProfileSchema.parse(profileData);
        } catch (error) {
          console.error('Invalid profile data:', error);
          throw new Error('Profile data validation failed');
        }
      }

      // Validate contacts
      let validatedContacts: string[] = [];
      if (contacts) {
        try {
          validatedContacts = ContactsSchema.parse(contacts);
        } catch (error) {
          console.error('Invalid contacts data:', error);
          throw new Error('Contacts validation failed');
        }
      }

      // Check if profile or contacts exist on any relay
      let hasProfile = false;
      let hasContacts = false;
      const existingEvents: { [kind: number]: Event | null } = { 0: null, 3: null };

      for (const url of relays) {
        try {
          const relay = await pool.ensureRelay(url);
          const filter: Filter = { kinds: [0, 3], authors: [pubkey] };
          const collectedEvents: Event[] = [];

          // Use subscription to collect events
          await new Promise<void>((resolve, reject) => {
            const sub = relay.subscribe([filter], {
              onevent: (event: Event) => {
                collectedEvents.push(event);
              },
              oneose: () => {
                sub.close();
                resolve();
              },
            });

            // Timeout after 5 seconds to prevent hanging
            setTimeout(() => {
              sub.close();
              resolve();
            }, 5000);
          });

          // Process collected events
          collectedEvents.forEach(event => {
            if (event.kind === 0) {
              hasProfile = true;
              if (!existingEvents[0] || existingEvents[0]!.created_at < event.created_at) {
                existingEvents[0] = event;
              }
            } else if (event.kind === 3) {
              hasContacts = true;
              if (!existingEvents[3] || existingEvents[3]!.created_at < event.created_at) {
                existingEvents[3] = event;
              }
            }
          });
        } catch (error) {
          console.warn(`Failed to fetch existing events from ${url}:`, error);
        }
      }

      // Profile metadata (kind 0)
      if (validatedProfile && (!hasProfile || forceSync)) {
        const profileEvent: EventTemplate = {
          kind: 0,
          created_at: Math.floor(Date.now() / 1000),
          tags: [],
          content: JSON.stringify(validatedProfile),
        };

        // Only publish if forceSync or no existing profile
        try {
          const finalizedProfileEvent = await user.signEvent(profileEvent);
          events.push(finalizedProfileEvent);
          console.log(`Preparing to publish new profile event to relays`);
        } catch (error) {
          console.error('Failed to sign profile event:', error);
          throw new Error('Profile event signing failed');
        }
      } else if (hasProfile && !forceSync) {
        console.log('Skipping profile sync: profile already exists on at least one relay');
      }

      // Contact list (kind 3)
      if (validatedContacts.length > 0 && (!hasContacts || forceSync)) {
        const contactEvent: EventTemplate = {
          kind: 3,
          created_at: Math.floor(Date.now() / 1000),
          tags: validatedContacts.map(pubkey => ['p', pubkey] as [string, string]),
          content: '',
        };

        // Only publish if forceSync or no existing contacts
        try {
          const finalizedContactEvent = await user.signEvent(contactEvent);
          events.push(finalizedContactEvent);
          console.log(`Preparing to publish new contact event to relays`);
        } catch (error) {
          console.error('Failed to sign contact event:', error);
          throw new Error('Contact event signing failed');
        }
      } else if (hasContacts && !forceSync) {
        console.log('Skipping contacts sync: contacts already exist on at least one relay');
      }

      // Publish to all relays with retry logic
      if (events.length > 0) {
        const publishPromises: Promise<void>[] = [];
        for (const url of relays) {
          publishPromises.push(
            (async () => {
              let retries = 3;
              while (retries > 0) {
                try {
                  const relay = await pool.ensureRelay(url);
                  for (const event of events) {
                    await relay.publish(event);
                    console.log(`Published event ${event.kind} to ${url}`);
                  }
                  break; // Success, exit retry loop
                } catch (error) {
                  console.warn(`Failed to publish to ${url}, retrying (${retries} left):`, error);
                  retries--;
                  if (retries === 0) {
                    console.error(`Failed to publish to ${url} after retries`);
                  }
                  await new Promise(resolve => setTimeout(resolve, 1000)); // Wait before retry
                }
              }
            })()
          );
        }

        // Wait for all publish operations to complete
        await Promise.all(publishPromises);
      } else {
        console.log('No events to publish');
      }

      // Clean up
      pool.close(relays);
    },
    [presetRelays, config.relayUrl]
  );

  const appContextValue: AppContextType = {
    config,
    updateConfig,
    presetRelays,
    syncAccountToRelays,
  };

  useApplyTheme(config.theme);

  return (
    <AppContext.Provider value={appContextValue}>
      {children}
    </AppContext.Provider>
  );
}

function useApplyTheme(theme: Theme) {
  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');
    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      root.classList.add(systemTheme);
      return;
    }
    root.classList.add(theme);
  }, [theme]);

  useEffect(() => {
    if (theme !== 'system') return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      const root = window.document.documentElement;
      root.classList.remove('light', 'dark');
      const systemTheme = mediaQuery.matches ? 'dark' : 'light';
      root.classList.add(systemTheme);
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);
}