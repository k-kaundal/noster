import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  formatScalar,
  getAltText,
  getNoteRenderKind,
  humanizeKey,
  isRenderableEvent,
  kindLabel,
  parseJsonContent,
} from './eventKinds';

function makeEvent(overrides: Partial<NostrEvent>): NostrEvent {
  return {
    id: 'id',
    pubkey: 'pubkey',
    created_at: 1786003660,
    kind: 1,
    tags: [],
    content: '',
    sig: 'sig',
    ...overrides,
  };
}

/** A real machine-published telemetry payload, used as the reference case. */
const TELEMETRY_CONTENT = JSON.stringify({
  type: 'zone_presence',
  zone: '7gS9HiiyJAlzX6DpcYoq',
  devicePk: '0f92c4a4aab613ff051f2a6e9cde7d0d131faa576a11ffe175ab82b4715c501b',
  swarm: '70.162.9.155:4040',
  role: 'gateway',
  relays: ['ws://10.0.30.44:7447'],
  hostPlatform: 'linux',
  serviceVersion: '0.1.3',
  releaseChannel: 'dev',
  releaseTrack: 'local',
  releaseBranch: 'feat/gateway-managed-webrtc-31',
  metrics: {
    clients: 0,
    cpuPct: 45.6,
    memPct: 11.8,
    memUsedMb: 1186980,
    memTotalMb: 10076340,
    loadPct: 45.6,
    ts: 1786003660000,
  },
  ts: 1786003660000,
  ttl: 120,
});

describe('parseJsonContent', () => {
  it('parses a machine telemetry payload', () => {
    const parsed = parseJsonContent(TELEMETRY_CONTENT) as Record<string, unknown>;

    expect(parsed).not.toBeNull();
    expect(parsed.type).toBe('zone_presence');
    expect(parsed.relays).toEqual(['ws://10.0.30.44:7447']);
    expect((parsed.metrics as Record<string, unknown>).cpuPct).toBe(45.6);
  });

  it('leaves ordinary prose alone', () => {
    expect(parseJsonContent('Just a normal note about bitcoin')).toBeNull();
    expect(parseJsonContent('')).toBeNull();
  });

  it('does not treat a bare JSON scalar as a payload', () => {
    // These parse fine but are not structured documents
    expect(parseJsonContent('42')).toBeNull();
    expect(parseJsonContent('"hello"')).toBeNull();
    expect(parseJsonContent('null')).toBeNull();
  });

  it('returns null for text that only looks like JSON', () => {
    expect(parseJsonContent('{not actually json}')).toBeNull();
    expect(parseJsonContent('{"unclosed": ')).toBeNull();
  });

  it('handles arrays', () => {
    expect(parseJsonContent('[1, 2, 3]')).toEqual([1, 2, 3]);
  });
});

describe('getNoteRenderKind', () => {
  it('routes a JSON telemetry note to the structured renderer', () => {
    const event = makeEvent({ kind: 1, content: TELEMETRY_CONTENT });
    expect(getNoteRenderKind(event)).toBe('structured');
  });

  it('routes ordinary notes to the text renderer', () => {
    expect(getNoteRenderKind(makeEvent({ kind: 1, content: 'hello' }))).toBe(
      'text'
    );
  });

  it('routes reposts, articles and videos to their own renderers', () => {
    expect(getNoteRenderKind(makeEvent({ kind: 6 }))).toBe('repost');
    expect(getNoteRenderKind(makeEvent({ kind: 16 }))).toBe('repost');
    expect(getNoteRenderKind(makeEvent({ kind: 30023 }))).toBe('article');
    expect(getNoteRenderKind(makeEvent({ kind: 22 }))).toBe('video');
    expect(getNoteRenderKind(makeEvent({ kind: 21 }))).toBe('video');
    expect(getNoteRenderKind(makeEvent({ kind: 20 }))).toBe('picture');
  });

  it('falls back to unknown for kinds it cannot render', () => {
    expect(getNoteRenderKind(makeEvent({ kind: 31337, content: 'x' }))).toBe(
      'unknown'
    );
  });

  it('prefers the structured renderer over repost for JSON reposts', () => {
    // Kind 6 embeds the reposted event as JSON, which must stay a repost
    const repost = makeEvent({ kind: 6, content: TELEMETRY_CONTENT });
    expect(getNoteRenderKind(repost)).toBe('repost');
  });
});

describe('getAltText', () => {
  it('reads the NIP-31 alt tag', () => {
    const event = makeEvent({
      kind: 31337,
      tags: [['alt', 'A live audio room']],
    });
    expect(getAltText(event)).toBe('A live audio room');
  });

  it('returns undefined when absent or blank', () => {
    expect(getAltText(makeEvent({}))).toBeUndefined();
    expect(getAltText(makeEvent({ tags: [['alt', '   ']] }))).toBeUndefined();
  });
});

describe('kindLabel', () => {
  it('names known kinds and falls back for unknown ones', () => {
    expect(kindLabel(1)).toBe('Note');
    expect(kindLabel(30023)).toBe('Article');
    expect(kindLabel(10002)).toBe('Relay list');
    expect(kindLabel(31337)).toBe('Kind 31337');
  });
});

describe('formatScalar', () => {
  it('renders millisecond and second epochs as dates', () => {
    // The telemetry payload uses both: ts in ms, created_at style in seconds
    expect(formatScalar(1786003660000)).toContain('20');
    expect(formatScalar(1786003660)).toContain('20');
  });

  it('leaves small integers alone', () => {
    expect(formatScalar(120)).toBe('120');
    expect(formatScalar(0)).toBe('0');
  });

  it('keeps decimals intact', () => {
    expect(formatScalar(45.6)).toBe('45.6');
  });

  it('formats booleans and null readably', () => {
    expect(formatScalar(true)).toBe('yes');
    expect(formatScalar(false)).toBe('no');
    expect(formatScalar(null)).toBe('—');
  });

  it('groups large plain integers', () => {
    expect(formatScalar(1186980)).toBe((1186980).toLocaleString());
  });
});

describe('humanizeKey', () => {
  it('splits camelCase and snake_case into sentence case', () => {
    expect(humanizeKey('memUsedMb')).toBe('Mem used mb');
    expect(humanizeKey('host_platform')).toBe('Host platform');
    expect(humanizeKey('release-branch')).toBe('Release branch');
    expect(humanizeKey('ttl')).toBe('Ttl');
    expect(humanizeKey('devicePk')).toBe('Device pk');
  });

  it('leaves acronyms uppercase', () => {
    expect(humanizeKey('deviceID')).toBe('Device ID');
    expect(humanizeKey('apiURL')).toBe('Api URL');
  });
});

describe('isRenderableEvent', () => {
  it('accepts notes with body text', () => {
    expect(isRenderableEvent(makeEvent({ content: 'hello' }))).toBe(true);
  });

  it('rejects notes that are entirely empty', () => {
    expect(isRenderableEvent(makeEvent({ content: '' }))).toBe(false);
    expect(isRenderableEvent(makeEvent({ content: '   \n  ' }))).toBe(false);
  });

  it('accepts media posts whose payload lives in tags, not content', () => {
    // Kind 20 picture posts routinely have an empty body
    const picture = makeEvent({
      kind: 20,
      content: '',
      tags: [['imeta', 'url https://example.com/a.jpg']],
    });
    expect(isRenderableEvent(picture)).toBe(true);
  });

  it('accepts an empty event carrying NIP-31 alt text', () => {
    const event = makeEvent({
      kind: 31337,
      content: '',
      tags: [['alt', 'A live stream']],
    });
    expect(isRenderableEvent(event)).toBe(true);
  });

  it('accepts empty reposts, which reference their target by tag', () => {
    const repost = makeEvent({ kind: 6, content: '', tags: [['e', 'abc']] });
    expect(isRenderableEvent(repost)).toBe(true);
  });
});
