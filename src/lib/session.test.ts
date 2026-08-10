import { describe, it, expect } from 'vitest';
import { nip19 } from 'nostr-tools';
import {
  ReadOnlyError,
  ReadOnlySigner,
  decodeViewerKey,
  isReadOnlyError,
  signerMethod,
} from './session';

const PUBKEY =
  'f1ee81bb843731c983fad98784dfe984efdd0b057bcbb5e8f16ff449787e59f6';

describe('decodeViewerKey', () => {
  it('reads an npub', () => {
    expect(decodeViewerKey(nip19.npubEncode(PUBKEY))).toBe(PUBKEY);
  });

  it('reads an nprofile, which is what some clients put on the clipboard', () => {
    const nprofile = nip19.nprofileEncode({
      pubkey: PUBKEY,
      relays: ['wss://relay.nostrfeed.com'],
    });

    expect(decodeViewerKey(nprofile)).toBe(PUBKEY);
  });

  it('accepts raw hex, which is what relay logs show', () => {
    expect(decodeViewerKey(PUBKEY)).toBe(PUBKEY);
    expect(decodeViewerKey(PUBKEY.toUpperCase())).toBe(PUBKEY);
  });

  it('ignores a nostr: prefix and surrounding space', () => {
    expect(decodeViewerKey(`  nostr:${nip19.npubEncode(PUBKEY)} `)).toBe(PUBKEY);
  });

  it('refuses a secret key rather than quietly accepting it', () => {
    // Taking it would work, and would teach someone that pasting secrets into
    // whatever box is in front of them is fine
    const nsec = nip19.nsecEncode(new Uint8Array(32).fill(1));

    expect(() => decodeViewerKey(nsec)).toThrow(/secret key/i);
  });

  it('refuses identifiers that do not name a person', () => {
    const note = nip19.noteEncode(PUBKEY);
    expect(() => decodeViewerKey(note)).toThrow(/not to a person/i);
  });

  it('explains rather than throwing a decoding error', () => {
    expect(() => decodeViewerKey('hello')).toThrow(/npub/i);
    expect(() => decodeViewerKey('')).toThrow(/npub/i);
  });
});

describe('ReadOnlySigner', () => {
  it('knows whose session it is', async () => {
    await expect(new ReadOnlySigner(PUBKEY).getPublicKey()).resolves.toBe(PUBKEY);
  });

  it('refuses to sign, with a reason that can be shown', async () => {
    await expect(new ReadOnlySigner(PUBKEY).signEvent()).rejects.toBeInstanceOf(
      ReadOnlyError
    );
  });

  it('is recognisable by callers deciding what to say', async () => {
    // Matching on the message would break the first time the wording improved
    const error = await new ReadOnlySigner(PUBKEY).signEvent().catch((e) => e);

    expect(isReadOnlyError(error)).toBe(true);
    expect(isReadOnlyError(new Error('nope'))).toBe(false);
  });
});

describe('signerMethod', () => {
  it('recognises the login types this app has wording for', () => {
    expect(signerMethod('nsec')).toBe('nsec');
    expect(signerMethod('extension')).toBe('extension');
    expect(signerMethod('bunker')).toBe('bunker');
  });

  it('claims nothing about a login type it has never heard of', () => {
    // The login store's union is the library's to grow, and a badge reading
    // "Extension" over some future signer would be a confident lie
    expect(signerMethod('nip55')).toBeUndefined();
    expect(signerMethod('')).toBeUndefined();
  });
});
