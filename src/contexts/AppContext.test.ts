import { describe, it, expect } from 'vitest';
import { parseAppConfig, HOUSE_RELAY } from './AppContext';

/** A config as it would have been stored before the house relay existed. */
const legacy = {
  theme: 'dark' as const,
  relayUrl: 'wss://relay.damus.io',
  relays: [
    { url: 'wss://relay.damus.io', read: true, write: true },
    { url: 'wss://nos.lol', read: true, write: true },
  ],
};

describe('parseAppConfig', () => {
  it('seeds the house relay into a config that predates it', () => {
    const config = parseAppConfig(legacy);

    expect(config.relays[0].url).toBe(HOUSE_RELAY);
    expect(config.relays[0]).toEqual({
      url: HOUSE_RELAY,
      read: true,
      write: true,
    });
  });

  it('keeps the relays the user already had', () => {
    const urls = parseAppConfig(legacy).relays.map((r) => r.url);

    expect(urls).toContain('wss://relay.damus.io');
    expect(urls).toContain('wss://nos.lol');
  });

  it('does not add the house relay twice', () => {
    const config = parseAppConfig({
      ...legacy,
      relays: [{ url: HOUSE_RELAY, read: true, write: true }],
    });

    expect(config.relays.filter((r) => r.url === HOUSE_RELAY)).toHaveLength(1);
  });

  it('respects a deliberate removal once seeding has happened', () => {
    // Re-adding it on every load would make it impossible to remove
    const config = parseAppConfig({
      ...legacy,
      seededHouseRelay: true,
    });

    expect(config.relays.some((r) => r.url === HOUSE_RELAY)).toBe(false);
  });

  it('marks the config as seeded so the migration runs only once', () => {
    expect(parseAppConfig(legacy).seededHouseRelay).toBe(true);
  });

  it('still backfills a config stored before multi-relay support', () => {
    const config = parseAppConfig({
      theme: 'light',
      relayUrl: 'wss://nos.lol',
    });

    expect(config.relays.map((r) => r.url)).toEqual([
      HOUSE_RELAY,
      'wss://nos.lol',
    ]);
  });

  it('backfills a missing accent', () => {
    expect(parseAppConfig(legacy).accent).toBeTruthy();
  });

  it('leaves the user their chosen primary rather than hijacking it', () => {
    expect(parseAppConfig(legacy).relayUrl).toBe('wss://relay.damus.io');
  });
});
