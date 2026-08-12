import { describe, it, expect } from 'vitest';
import {
  describeProblem,
  describeTimeout,
  isBunkerUri,
  parseBunkerUri,
} from './nip46';

/** The signer pubkey from the spec's own worked example. */
const SIGNER = 'fa984bd7dbb282f07e16e7ae87b26a2a7b9b90b7246a44771f0cf5ae58018f52';

describe('parseBunkerUri', () => {
  it('reads the shape the spec documents', () => {
    const { uri } = parseBunkerUri(
      `bunker://${SIGNER}?relay=wss%3A%2F%2Frelay-to-connect-on&relay=wss%3A%2F%2Fanother-relay&secret=0s8j2djs`
    );

    expect(uri).toEqual({
      remoteSignerPubkey: SIGNER,
      relays: ['wss://relay-to-connect-on', 'wss://another-relay'],
      secret: '0s8j2djs',
    });
  });

  it('accepts a URI with no secret, which is optional', () => {
    const { uri } = parseBunkerUri(`bunker://${SIGNER}?relay=wss://relay.example`);

    expect(uri?.secret).toBeUndefined();
    expect(uri?.relays).toEqual(['wss://relay.example']);
  });

  it('lowercases the key but keeps it', () => {
    const { uri } = parseBunkerUri(
      `bunker://${SIGNER.toUpperCase()}?relay=wss://relay.example`
    );

    expect(uri?.remoteSignerPubkey).toBe(SIGNER);
  });

  it('tolerates surrounding whitespace from a paste', () => {
    expect(
      isBunkerUri(`  bunker://${SIGNER}?relay=wss://relay.example  `)
    ).toBe(true);
  });

  it('rejects a URI with no relay, since there is nowhere to talk', () => {
    expect(parseBunkerUri(`bunker://${SIGNER}`).problem).toBe('no-relay');
    expect(parseBunkerUri(`bunker://${SIGNER}?secret=abc`).problem).toBe(
      'no-relay'
    );
  });

  it('rejects a relay that is not a websocket', () => {
    expect(
      parseBunkerUri(`bunker://${SIGNER}?relay=https://relay.example`).problem
    ).toBe('bad-relay');
  });

  it('rejects a key that is not 64 hex characters', () => {
    expect(parseBunkerUri('bunker://').problem).toBe('bad-pubkey');
    expect(parseBunkerUri('bunker://nope?relay=wss://r.example').problem).toBe(
      'bad-pubkey'
    );
    expect(
      parseBunkerUri(`bunker://${SIGNER.slice(0, 63)}?relay=wss://r.example`)
        .problem
    ).toBe('bad-pubkey');
  });

  it('tells an npub apart from junk, because the fix differs', () => {
    /**
     * An npub is the right key wrongly encoded — the person is holding the
     * correct thing — whereas anything else means they copied the wrong
     * string entirely.
     */
    const npub =
      'npub1sn0wdenkukak0d9dfczzeacvhkrgz92ak56egt7vdgzn8pv2wfqqhrjdv9';

    expect(parseBunkerUri(`bunker://${npub}?relay=wss://r.example`).problem).toBe(
      'npub-pubkey'
    );
  });

  it('recognises a nostrconnect string as the other direction', () => {
    const uri =
      'nostrconnect://83f3b2ae6aa368e8275397b9c26cf550101d63ebaab900d19dd4a4429f5ad8f5?relay=wss%3A%2F%2Frelay1.example.com&secret=0s8j2djs';

    expect(parseBunkerUri(uri).problem).toBe('is-nostrconnect');
  });

  it('separates empty from wrong', () => {
    expect(parseBunkerUri('').problem).toBe('empty');
    expect(parseBunkerUri('   ').problem).toBe('empty');
    expect(parseBunkerUri('https://example.com').problem).toBe('not-bunker');
  });
});

describe('describeProblem', () => {
  it('says something for every problem it can report', () => {
    const problems = [
      'empty',
      'not-bunker',
      'is-nostrconnect',
      'bad-pubkey',
      'npub-pubkey',
      'no-relay',
      'bad-relay',
    ] as const;

    for (const problem of problems) {
      expect(describeProblem(problem).length).toBeGreaterThan(20);
    }
  });
});

describe('describeTimeout', () => {
  it('raises the spent secret, which is the cause nobody guesses', () => {
    const { uri } = parseBunkerUri(
      `bunker://${SIGNER}?relay=wss://relay.example&secret=abc`
    );

    expect(describeTimeout(uri!)).toMatch(/used before|spent|once/i);
  });

  it('says something else when there was no secret to spend', () => {
    const { uri } = parseBunkerUri(`bunker://${SIGNER}?relay=wss://relay.example`);

    expect(describeTimeout(uri!)).not.toMatch(/spent/i);
    expect(describeTimeout(uri!)).toContain('relay.example');
  });
});
