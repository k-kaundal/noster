import type { NostrEvent } from '@nostrify/nostrify';
import {
  describeWarning,
  readContentWarning,
  type WarningSeverity,
} from '@/lib/contentWarning';

/** NIP-71 video event kinds. */
export const SHORT_VIDEO_KIND = 22;
export const SHORT_VIDEO_ADDRESSABLE_KIND = 34236;
export const VIDEO_KIND = 21;
export const VIDEO_ADDRESSABLE_KIND = 34235;

export const SHORT_VIDEO_KINDS = [
  SHORT_VIDEO_KIND,
  SHORT_VIDEO_ADDRESSABLE_KIND,
];

/** One media variant parsed from an `imeta` tag. */
export interface VideoVariant {
  url: string;
  mimeType?: string;
  /** Pixel dimensions, when the author declared them. */
  width?: number;
  height?: number;
  /** Poster image shown before playback starts. */
  image?: string;
  hash?: string;
  duration?: number;
  fallbacks: string[];
}

export interface ParsedVideo {
  variants: VideoVariant[];
  title?: string;
  /** Author-provided accessibility description. */
  alt?: string;
  durationSeconds?: number;
  publishedAt?: number;
  hashtags: string[];
  contentWarning?: string | null;
  /** How much of the frame to cover; absent when there is no warning. */
  warningSeverity?: WarningSeverity;
}

/**
 * `imeta` is a space-delimited key/value tag: each entry after the tag name is
 * `"<key> <value>"`, and `fallback` may repeat.
 */
function parseImeta(tag: string[]): VideoVariant | null {
  const fields = new Map<string, string>();
  const fallbacks: string[] = [];

  for (const part of tag.slice(1)) {
    const spaceIndex = part.indexOf(' ');
    if (spaceIndex === -1) continue;

    const key = part.slice(0, spaceIndex);
    const value = part.slice(spaceIndex + 1).trim();
    if (!value) continue;

    if (key === 'fallback') {
      fallbacks.push(value);
    } else if (!fields.has(key)) {
      fields.set(key, value);
    }
  }

  const url = fields.get('url');
  if (!url) return null;

  const dim = fields.get('dim');
  const [width, height] = dim
    ? dim.split('x').map((value) => Number.parseInt(value, 10))
    : [];

  const duration = fields.get('duration');

  return {
    url,
    mimeType: fields.get('m'),
    width: Number.isFinite(width) ? width : undefined,
    height: Number.isFinite(height) ? height : undefined,
    image: fields.get('image'),
    hash: fields.get('x'),
    duration: duration ? Number.parseFloat(duration) : undefined,
    fallbacks,
  };
}

/** Pulls the playable variants and display metadata out of a NIP-71 event. */
export function parseVideoEvent(event: NostrEvent): ParsedVideo {
  const variants = event.tags
    .filter(([name]) => name === 'imeta')
    .map(parseImeta)
    .filter((variant): variant is VideoVariant => variant !== null)
    // Audio-only variants are valid imeta entries but can't be the video source
    .filter((variant) => !variant.mimeType?.startsWith('audio/'));

  const tagValue = (name: string) =>
    event.tags.find(([tagName]) => tagName === name)?.[1];

  const duration = tagValue('duration');
  const publishedAt = tagValue('published_at');
  /**
   * Read through the NIP-36 parser rather than off the tag directly, so a
   * reel labelled with `l` tags and no prose is still covered — video is the
   * format where an ungated warning is least recoverable, since it starts
   * playing on its own.
   */
  const warning = readContentWarning(event);

  return {
    variants,
    title: tagValue('title'),
    alt: tagValue('alt'),
    durationSeconds: duration ? Number.parseFloat(duration) : variants[0]?.duration,
    publishedAt: publishedAt ? Number.parseInt(publishedAt, 10) : undefined,
    hashtags: event.tags
      .filter(([name]) => name === 't')
      .map(([, value]) => value)
      .filter(Boolean),
    contentWarning: warning ? (describeWarning(warning) ?? '') : null,
    warningSeverity: warning?.severity,
  };
}

/** True when the event carries at least one playable video source. */
export function hasPlayableVideo(event: NostrEvent): boolean {
  return parseVideoEvent(event).variants.length > 0;
}

/** `0:42`, or `1:02:03` for anything past an hour. */
export function formatDuration(seconds?: number): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return '';

  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

/** Builds the `imeta` tag for an uploaded video, per NIP-92 formatting. */
export function buildImetaTag(options: {
  url: string;
  mimeType?: string;
  width?: number;
  height?: number;
  hash?: string;
  image?: string;
  duration?: number;
}): string[] {
  const parts = [`url ${options.url}`];

  if (options.mimeType) parts.push(`m ${options.mimeType}`);
  if (options.width && options.height) {
    parts.push(`dim ${options.width}x${options.height}`);
  }
  if (options.hash) parts.push(`x ${options.hash}`);
  if (options.image) parts.push(`image ${options.image}`);
  if (options.duration) parts.push(`duration ${Math.round(options.duration)}`);

  return ['imeta', ...parts];
}
