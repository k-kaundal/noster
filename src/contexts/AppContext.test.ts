import { describe, it, expect } from 'vitest';
import { AppConfigSchema, HOUSE_RELAY } from './AppContext';

/** A config as it would have been stored before the house relay existed. */
const legacy = {
  theme: 'dark' as const,
  relayUrl: 'wss://relay.damus.io',
  relays: [
    { url: 'wss://relay.damus.io', read: true, write: true },
    { url: 'wss://nos.lol', read: true, write: true },
  ],
};

describe('AppConfigSchema', () => {
  it('seeds the house relay into a config that predates it', () => {
    const config = AppConfigSchema.parse(legacy);

    expect(config.relays[0].url).toBe(HOUSE_RELAY);
    expect(config.relays[0]).toEqual({
      url: HOUSE_RELAY,
      read: true,
      write: true,
    });
  });

  it('keeps the relays the user already had', () => {
    const urls = AppConfigSchema.parse(legacy).relays.map((r) => r.url);

    expect(urls).toContain('wss://relay.damus.io');
    expect(urls).toContain('wss://nos.lol');
  });

  it('does not add the house relay twice', () => {
    const config = AppConfigSchema.parse({
      ...legacy,
      relays: [{ url: HOUSE_RELAY, read: true, write: true }],
    });

    expect(config.relays.filter((r) => r.url === HOUSE_RELAY)).toHaveLength(1);
  });

  it('respects a deliberate removal once seeding has happened', () => {
    // Re-adding it on every load would make it impossible to remove
    const config = AppConfigSchema.parse({
      ...legacy,
      seededHouseRelay: true,
    });

    expect(config.relays.some((r) => r.url === HOUSE_RELAY)).toBe(false);
  });

  it('marks the config as seeded so the migration runs only once', () => {
    expect(AppConfigSchema.parse(legacy).seededHouseRelay).toBe(true);
  });

  it('still backfills a config stored before multi-relay support', () => {
    const config = AppConfigSchema.parse({
      theme: 'light',
      relayUrl: 'wss://nos.lol',
    });

    expect(config.relays.map((r) => r.url)).toEqual([
      HOUSE_RELAY,
      'wss://nos.lol',
    ]);
  });

  it('backfills a missing accent', () => {
    expect(AppConfigSchema.parse(legacy).accent).toBeTruthy();
  });

  it('leaves the user their chosen primary rather than hijacking it', () => {
    expect(AppConfigSchema.parse(legacy).relayUrl).toBe('wss://relay.damus.io');
  });
});
