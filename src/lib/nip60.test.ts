import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  HISTORY_KIND,
  buildHistoryContent,
  buildHistoryTags,
  parseHistoryEvent,
  type HistoryInput,
  type Nip44Signer,
} from './nip60';

const ME = 'a'.repeat(64);
const TOKEN = 'cashuBo2FteBpodHRwczovL21pbnQuZXhhbXBsZWF1Y3NhdA';

/** Seals by tagging, so the round trip is real without real crypto. */
const signer = {
  nip44: {
    encrypt: async (_pubkey: string, text: string) => `sealed:${btoa(text)}`,
    decrypt: async (_pubkey: string, blob: string) => {
      if (!blob.startsWith('sealed:')) throw new Error('not ours');
      return atob(blob.slice(7));
    },
  },
} as Nip44Signer;

/** A signer holding a different key. */
const stranger = {
  nip44: {
    encrypt: async () => 'x',
    decrypt: async () => {
      throw new Error('wrong key');
    },
  },
} as Nip44Signer;

function historyEvent(content: string, tags: string[][] = []): NostrEvent {
  return {
    id: 'e'.repeat(64),
    pubkey: ME,
    created_at: 1700000000,
    kind: HISTORY_KIND,
    tags,
    content,
    sig: '',
  };
}

async function roundTrip(input: HistoryInput) {
  const content = await buildHistoryContent(signer, ME, input);
  return await parseHistoryEvent(
    signer,
    historyEvent(content, buildHistoryTags(input))
  );
}

describe('spending history', () => {
  it('round-trips what NIP-60 itself defines', async () => {
    const entry = await roundTrip({
      direction: 'out',
      amount: 21,
      unit: 'sat',
      created: 'c'.repeat(64),
      destroyed: ['d'.repeat(64)],
    });

    expect(entry?.direction).toBe('out');
    expect(entry?.amount).toBe(21);
    expect(entry?.created).toBe('c'.repeat(64));
    expect(entry?.destroyed).toEqual(['d'.repeat(64)]);
  });

  it('carries the token, memo and mint of a send', async () => {
    const entry = await roundTrip({
      direction: 'out',
      amount: 21,
      token: TOKEN,
      memo: 'coffee',
      mint: 'https://mint.example',
    });

    expect(entry?.token).toBe(TOKEN);
    expect(entry?.memo).toBe('coffee');
    expect(entry?.mint).toBe('https://mint.example');
  });

  it('adds nothing to a change that handed out no token', async () => {
    const entry = await roundTrip({ direction: 'in', amount: 100 });

    expect(entry?.token).toBeUndefined();
    expect(entry?.memo).toBeUndefined();
    expect(entry?.mint).toBeUndefined();
  });

  it('never writes the token to the unencrypted tags', () => {
    const tags = buildHistoryTags({
      direction: 'out',
      amount: 21,
      token: TOKEN,
      memo: 'coffee',
      mint: 'https://mint.example',
      redeemed: ['f'.repeat(64)],
    });

    // Only the redeemed markers NIP-60 asks to be left in the clear
    expect(tags).toEqual([['e', 'f'.repeat(64), '', 'redeemed']]);
    expect(JSON.stringify(tags)).not.toContain(TOKEN);
    expect(JSON.stringify(tags)).not.toContain('coffee');
  });

  it('does not leave the token readable in the content', async () => {
    const content = await buildHistoryContent(signer, ME, {
      direction: 'out',
      amount: 21,
      token: TOKEN,
    });

    expect(content).not.toContain(TOKEN);
  });

  it('is unreadable to anyone else', async () => {
    const content = await buildHistoryContent(signer, ME, {
      direction: 'out',
      amount: 21,
      token: TOKEN,
    });

    expect(await parseHistoryEvent(stranger, historyEvent(content))).toBeNull();
  });

  it('keeps redeemed markers when the payload cannot be read', async () => {
    const content = await buildHistoryContent(signer, ME, {
      direction: 'out',
      amount: 21,
      token: TOKEN,
    });

    const entry = await parseHistoryEvent(
      stranger,
      historyEvent(content, [['e', 'f'.repeat(64), '', 'redeemed']])
    );

    expect(entry?.redeemed).toEqual(['f'.repeat(64)]);
    expect(entry?.token).toBeUndefined();
  });
});

describe('backfilled token entries', () => {
  it('marks an entry that only carries a token', async () => {
    const entry = await roundTrip({
      direction: 'out',
      amount: 21,
      token: TOKEN,
      backupOnly: true,
    });

    expect(entry?.isBackup).toBe(true);
    expect(entry?.token).toBe(TOKEN);
  });

  it('leaves an ordinary send unmarked', async () => {
    const entry = await roundTrip({
      direction: 'out',
      amount: 21,
      token: TOKEN,
    });

    expect(entry?.isBackup).toBe(false);
  });
});
