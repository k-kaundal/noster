import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import { classifyNsfw, filterAdultContent, isAdultContent } from './nsfw';

function note(tags: string[][], content = 'hello'): NostrEvent {
  return {
    id: Math.random().toString(36).slice(2),
    pubkey: 'author',
    created_at: 1,
    kind: 1,
    tags,
    content,
    sig: '',
  } as NostrEvent;
}

describe('classifyNsfw', () => {
  it('catches the hashtags these posts actually carry', () => {
    expect(isAdultContent(note([['t', 'nsfw']]))).toBe(true);
    expect(isAdultContent(note([['t', 'PORN']]))).toBe(true);
    expect(isAdultContent(note([['t', 'onlyfans']]))).toBe(true);
  });

  it('reads a NIP-36 warning that says what it is warning about', () => {
    const verdict = classifyNsfw(note([['content-warning', 'nudity']]));

    expect(verdict.adult).toBe(true);
    expect(verdict.reason).toBe('nudity');
  });

  it('leaves warnings that are not about sex alone', () => {
    // A spoiler tag is a content warning too, and hiding it under an adult
    // content setting would be the wrong thing entirely
    expect(isAdultContent(note([['content-warning', 'spoilers for episode 4']]))).toBe(false);
    expect(isAdultContent(note([['content-warning', 'politics']]))).toBe(false);
    expect(isAdultContent(note([['content-warning', '']]))).toBe(false);
  });

  it('does not guess from the words in a post', () => {
    // No classifier: hiding an unlabelled post means its author has no way of
    // knowing why nobody saw it
    expect(isAdultContent(note([], 'this post is about sex education'))).toBe(false);
  });

  it('does not catch tags that merely contain a flagged word', () => {
    expect(isAdultContent(note([['t', 'sussex']]))).toBe(false);
    expect(isAdultContent(note([['t', 'nudibranch']]))).toBe(false);
  });

  it('reads a NIP-32 label as well as a hashtag', () => {
    expect(isAdultContent(note([['l', 'nsfw']]))).toBe(true);
  });

  it('says nothing about an ordinary note', () => {
    expect(classifyNsfw(note([['t', 'bitcoin']]))).toEqual({ adult: false });
  });
});

describe('filterAdultContent', () => {
  const events = [note([['t', 'bitcoin']]), note([['t', 'nsfw']]), note([])];

  it('removes labelled posts when adult content is off', () => {
    expect(filterAdultContent(events, false)).toHaveLength(2);
  });

  it('passes everything through when it is allowed', () => {
    expect(filterAdultContent(events, true)).toBe(events);
  });
});
