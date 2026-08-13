import { describe, it, expect } from 'vitest';
import { nip19 } from 'nostr-tools';
import { handleFor, isHandleShaped, shortNpub } from './handle';

const PUBKEY = 'a'.repeat(64);
const NPUB = nip19.npubEncode(PUBKEY);

describe('isHandleShaped', () => {
  it('accepts something usable as a handle', () => {
    expect(isHandleShaped('alice')).toBe(true);
    expect(isHandleShaped('alice_1')).toBe(true);
  });

  it('rejects a display name with a space in it', () => {
    // "Keen Eagle" is what genUserName invents when a profile has no name.
    // It is a fine thing to call somebody and not a handle at all.
    expect(isHandleShaped('Keen Eagle')).toBe(false);
    expect(isHandleShaped('  ')).toBe(false);
    expect(isHandleShaped('')).toBe(false);
    expect(isHandleShaped(undefined)).toBe(false);
  });
});

describe('shortNpub', () => {
  it('keeps both ends, so it can be recognised', () => {
    const short = shortNpub(PUBKEY);

    expect(short.startsWith(NPUB.slice(0, 8))).toBe(true);
    expect(short.endsWith(NPUB.slice(-4))).toBe(true);
    expect(short).toContain('…');
  });

  it('shows a malformed key rather than replacing it with a fiction', () => {
    expect(shortNpub('not-a-key')).toBe('not-a-key');
  });
});

describe('handleFor', () => {
  it('uses the name somebody chose', () => {
    expect(handleFor({ name: 'alice' }, PUBKEY)).toBe('alice');
  });

  it('falls back to the key, not to an invented label', () => {
    /**
     * The bug this exists for: two people with no profile both showed the
     * same invented two-word name as their handle, and the one thing that
     * would tell them apart was the thing not shown.
     */
    expect(handleFor(undefined, PUBKEY)).toBe(shortNpub(PUBKEY));
    expect(handleFor({ name: 'Keen Eagle' }, PUBKEY)).toBe(shortNpub(PUBKEY));
  });

  it('prefers a verified name over a key', () => {
    expect(handleFor({ nip05: 'alice@getzap.me' }, PUBKEY)).toBe('alice');
  });

  it('shows the domain for a root NIP-05', () => {
    // `_@domain.com` means "the domain itself"; an underscore is not a handle
    expect(handleFor({ nip05: '_@getzap.me' }, PUBKEY)).toBe('getzap.me');
  });

  it('prefers a chosen name over a verified one', () => {
    expect(handleFor({ name: 'kk', nip05: 'other@getzap.me' }, PUBKEY)).toBe('kk');
  });
});
