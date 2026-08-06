import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  buildImetaTag,
  formatDuration,
  hasPlayableVideo,
  parseVideoEvent,
  SHORT_VIDEO_KIND,
} from './video';

/** The example event from NIP-71, used verbatim as the parser's reference. */
const specExample: NostrEvent = {
  id: 'a1b2c3d4e5f6789012345678901234567890123456789012345678901234ab',
  pubkey: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  created_at: 1704067200,
  kind: 34236,
  content: 'Epic short-form vertical video content',
  sig: 'sig',
  tags: [
    ['d', 'my-short-video-001'],
    ['title', 'Amazing Vertical Story'],
    ['published_at', '1704067200'],
    ['alt', 'Person performing skateboard trick'],
    [
      'imeta',
      'url https://example.com/video.mp4',
      'm video/mp4',
      'dim 1080x1920',
      'x 3093509d1e0bc604ff60cb9286f4cd7c781553bc8991937befaacfdc28ec5cdc',
      'image https://example.com/thumb.jpg',
      'bitrate 5000000',
      'duration 15.5',
    ],
    [
      'imeta',
      'url https://example.com/audio-en.mp3',
      'm audio/mp3',
      'x b2e0a7a82ac9f3f3a71f1d9a78c381d5be9d1cf19dce258765c17c8a76287c93',
      'l en ISO-639-1 ov',
      'bitrate 320000',
      'duration 15.5',
    ],
    ['content-warning', 'contains fast motion'],
    ['segment', '00:00:00', '00:05:00', 'Intro', 'https://example.com/seg1.jpg'],
    ['t', 'sports'],
    ['t', 'skating'],
    ['p', 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'],
    ['r', 'https://skate-community.example.com'],
  ],
};

describe('parseVideoEvent', () => {
  it('parses the imeta variant from the NIP-71 example', () => {
    const video = parseVideoEvent(specExample);
    const [variant] = video.variants;

    expect(variant.url).toBe('https://example.com/video.mp4');
    expect(variant.mimeType).toBe('video/mp4');
    expect(variant.width).toBe(1080);
    expect(variant.height).toBe(1920);
    expect(variant.image).toBe('https://example.com/thumb.jpg');
    expect(variant.hash).toBe(
      '3093509d1e0bc604ff60cb9286f4cd7c781553bc8991937befaacfdc28ec5cdc'
    );
    expect(variant.duration).toBe(15.5);
  });

  it('excludes audio-only imeta entries from the playable variants', () => {
    const video = parseVideoEvent(specExample);

    expect(video.variants).toHaveLength(1);
    expect(
      video.variants.some((variant) => variant.mimeType?.startsWith('audio/'))
    ).toBe(false);
  });

  it('reads title, alt, hashtags and content warning', () => {
    const video = parseVideoEvent(specExample);

    expect(video.title).toBe('Amazing Vertical Story');
    expect(video.alt).toBe('Person performing skateboard trick');
    expect(video.hashtags).toEqual(['sports', 'skating']);
    expect(video.contentWarning).toBe('contains fast motion');
    expect(video.publishedAt).toBe(1704067200);
  });

  it('distinguishes "no content warning" from "warning with no reason"', () => {
    const noWarning = parseVideoEvent({ ...specExample, tags: [] });
    expect(noWarning.contentWarning).toBeNull();

    const emptyReason = parseVideoEvent({
      ...specExample,
      tags: [['content-warning']],
    });
    expect(emptyReason.contentWarning).toBe('');
  });

  it('handles urls containing spaces in later imeta fields', () => {
    // The value runs to the end of the entry, so only the first space splits
    const video = parseVideoEvent({
      ...specExample,
      tags: [['imeta', 'url https://example.com/a.mp4', 'alt a cat doing a flip']],
    });

    expect(video.variants[0].url).toBe('https://example.com/a.mp4');
  });

  it('treats an imeta tag without a url as unplayable', () => {
    const video = parseVideoEvent({
      ...specExample,
      tags: [['imeta', 'm video/mp4', 'dim 100x100']],
    });

    expect(video.variants).toHaveLength(0);
    expect(hasPlayableVideo({ ...specExample, tags: [] })).toBe(false);
  });
});

describe('buildImetaTag', () => {
  it('round-trips through the parser', () => {
    const tag = buildImetaTag({
      url: 'https://cdn.example/v.mp4',
      mimeType: 'video/mp4',
      width: 720,
      height: 1280,
      duration: 30.4,
    });

    const video = parseVideoEvent({
      ...specExample,
      kind: SHORT_VIDEO_KIND,
      tags: [tag],
    });

    expect(video.variants[0]).toMatchObject({
      url: 'https://cdn.example/v.mp4',
      mimeType: 'video/mp4',
      width: 720,
      height: 1280,
    });
  });

  it('omits fields that were not provided', () => {
    expect(buildImetaTag({ url: 'https://cdn.example/v.mp4' })).toEqual([
      'imeta',
      'url https://cdn.example/v.mp4',
    ]);
  });
});

describe('formatDuration', () => {
  it('formats minutes and seconds, padding the seconds', () => {
    expect(formatDuration(42)).toBe('0:42');
    expect(formatDuration(65)).toBe('1:05');
  });

  it('adds an hours segment past an hour', () => {
    expect(formatDuration(3723)).toBe('1:02:03');
  });

  it('returns an empty string for missing or invalid durations', () => {
    expect(formatDuration(undefined)).toBe('');
    expect(formatDuration(0)).toBe('');
    expect(formatDuration(Number.NaN)).toBe('');
  });
});
