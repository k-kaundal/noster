import { ReactNode, useEffect, useCallback } from 'react';
import { z } from 'zod';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { AppContext, type AppConfig, type AppContextType, type Theme } from '@/contexts/AppContext';
import { SimplePool, Event, EventTemplate, Filter } from 'nostr-tools';
import { NostrSigner } from '@nostrify/nostrify';

// Validation schema for profile data
const ProfileSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  about: z.string().max(500).optional(),
  picture: z.string().url().optional(),
  lud16: z.string().email().optional(),
});

// Validation schema for contacts
const ContactsSchema = z.array(z.string().regex(/^[0-9a-f]{64}$/, 'Invalid pubkey'));

// Validation schema for app config
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
    async (user: NostrSigner, profileData?: any, contacts?: string[], options: { forceSync?: boolean } = {}) => {
      const { forceSync = false } = options;
      const relays = presetRelays?.filter(relay => relay.active).map(relay => relay.url) || [config.relayUrl];
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

      // Fetch existing events to avoid overwriting newer data
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
              // onerror: (error: any) => {
              //   sub.close();
              //   reject(error);
              // },
            });

            // Timeout after 5 seconds to prevent hanging
            setTimeout(() => {
              sub.close();
              resolve();
            }, 5000);
          });

          // Process collected events
          collectedEvents.forEach(event => {
            if (event.kind === 0 || event.kind === 3) {
              if (!existingEvents[event.kind] || existingEvents[event.kind]!.created_at < event.created_at) {
                existingEvents[event.kind] = event;
              }
            }
          });
        } catch (error) {
          console.warn(`Failed to fetch existing events from ${url}:`, error);
        }
      }

      // Profile metadata (kind 0)
      if (validatedProfile) {
        const profileEvent: EventTemplate = {
          kind: 0,
          created_at: Math.floor(Date.now() / 1000),
          tags: [],
          content: JSON.stringify(validatedProfile),
        };

        // Skip if existing profile event is newer, unless forceSync is true
        if (!forceSync && existingEvents[0] && existingEvents[0].created_at >= profileEvent.created_at) {
          console.log('Skipping profile sync: existing event is newer');
        } else {
          try {
            const finalizedProfileEvent = await user.signEvent(profileEvent);
            events.push(finalizedProfileEvent);
          } catch (error) {
            console.error('Failed to sign profile event:', error);
            throw new Error('Profile event signing failed');
          }
        }
      }

      // Contact list (kind 3)
      if (validatedContacts.length > 0) {
        const contactEvent: EventTemplate = {
          kind: 3,
          created_at: Math.floor(Date.now() / 1000),
          tags: validatedContacts.map(pubkey => ['p', pubkey] as [string, string]),
          content: '',
        };

        // Skip if existing contact event is newer, unless forceSync is true
        if (!forceSync && existingEvents[3] && existingEvents[3].created_at >= contactEvent.created_at) {
          console.log('Skipping contacts sync: existing event is newer');
        } else {
          try {
            const finalizedContactEvent = await user.signEvent(contactEvent);
            events.push(finalizedContactEvent);
          } catch (error) {
            console.error('Failed to sign contact event:', error);
            throw new Error('Contact event signing failed');
          }
        }
      }

      // Publish to all relays with retry logic
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