import { describe, it, expect } from 'vitest';
import {
  describeUploadFailure,
  hostOf,
  normalizeServer,
  uploadServers,
} from './uploadServers';

describe('normalizeServer', () => {
  it('adds the trailing slash Blossom paths are appended to', () => {
    expect(normalizeServer('https://blossom.band')).toBe(
      'https://blossom.band/'
    );
  });

  it('leaves an already-correct URL alone', () => {
    expect(normalizeServer('https://blossom.band/')).toBe(
      'https://blossom.band/'
    );
  });

  it('assumes https for a bare hostname', () => {
    expect(normalizeServer('nostr.build')).toBe('https://nostr.build/');
  });
});

describe('hostOf', () => {
  it('names the server for an error message', () => {
    expect(hostOf('https://blossom.band/')).toBe('blossom.band');
  });

  it('falls back to the raw value rather than throwing', () => {
    expect(hostOf('!!!')).toBe('!!!');
  });
});

describe('uploadServers', () => {
  it('always offers somewhere to upload to', () => {
    const servers = uploadServers();

    expect(servers.length).toBeGreaterThan(0);
    for (const server of servers) {
      expect(server.url.endsWith('/')).toBe(true);
    }
  });

  it('lists more than one, so an outage costs a retry not the upload', () => {
    expect(uploadServers().length).toBeGreaterThan(1);
  });
});

describe('describeUploadFailure', () => {
  it('names the single server that refused', () => {
    expect(
      describeUploadFailure([{ label: 'blossom.band', message: 'too large' }])
    ).toContain('blossom.band');
  });

  it('names every server when they all refused', () => {
    // "Upload failed" after three attempts hides whether the file or the
    // hosts were the problem
    const message = describeUploadFailure([
      { label: 'a.example', message: 'down' },
      { label: 'b.example', message: 'too large' },
    ]);

    expect(message).toContain('a.example');
    expect(message).toContain('b.example');
    expect(message).toContain('too large');
  });

  it('says so when nothing is configured', () => {
    expect(describeUploadFailure([])).toMatch(/configured/i);
  });
});
