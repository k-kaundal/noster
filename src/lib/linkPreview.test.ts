import { describe, it, expect } from 'vitest';
import {
  isCardableLink,
  primaryLink,
  readLink,
  truncatePath,
} from './linkPreview';

describe('isCardableLink', () => {
  it('accepts an ordinary web link', () => {
    expect(isCardableLink('https://example.com/article')).toBe(true);
  });

  it('rejects an image, which is already rendered as one', () => {
    // A card under a picture is the same thing twice
    expect(isCardableLink('https://cdn.example/a.jpg')).toBe(false);
    expect(isCardableLink('https://cdn.example/a.mp4')).toBe(false);
    expect(isCardableLink('https://cdn.example/a.png?w=800')).toBe(false);
  });

  it('rejects a video that already has a player', () => {
    expect(isCardableLink('https://youtube.com/watch?v=abc123')).toBe(false);
    expect(isCardableLink('https://www.youtu.be/abc123')).toBe(false);
    expect(isCardableLink('https://vimeo.com/12345')).toBe(false);
  });

  it('does not mistake a lookalike host for an embedded one', () => {
    // `notyoutube.com` is somebody else entirely
    expect(isCardableLink('https://notyoutube.com/watch')).toBe(true);
  });

  it('accepts a subdomain of an embedded host, which has no player here', () => {
    expect(isCardableLink('https://music.youtube.com/x')).toBe(false);
  });

  it('rejects anything that is not http', () => {
    expect(isCardableLink('ftp://example.com/file')).toBe(false);
    expect(isCardableLink('javascript:alert(1)')).toBe(false);
    expect(isCardableLink('not a url')).toBe(false);
  });
});

describe('readLink', () => {
  it('reads the parts a card shows', () => {
    expect(readLink('https://www.example.com/blog/post?ref=x')).toEqual({
      url: 'https://www.example.com/blog/post?ref=x',
      domain: 'example.com',
      path: '/blog/post?ref=x',
      faviconUrl: 'https://www.example.com/favicon.ico',
    });
  });

  it('drops a bare slash, which adds nothing beside the domain', () => {
    expect(readLink('https://example.com/')?.path).toBe('');
    expect(readLink('https://example.com')?.path).toBe('');
  });

  it('takes the favicon from the destination, not a favicon service', () => {
    /**
     * The privacy line. A shared favicon service would learn every link in
     * every feed; the site's own icon tells only that site, which the reader
     * is about to open anyway.
     */
    expect(readLink('https://example.com/x')?.faviconUrl).toBe(
      'https://example.com/favicon.ico'
    );
  });

  it('returns nothing for something that is not a url', () => {
    expect(readLink('nonsense')).toBeNull();
  });
});

describe('truncatePath', () => {
  it('leaves a short path alone', () => {
    expect(truncatePath('/blog/post')).toBe('/blog/post');
  });

  it('cuts from the middle, keeping both ends', () => {
    /**
     * The end of a URL is usually the informative half — a slug, a title — so
     * trimming there would throw away the only part worth reading.
     */
    const long = '/2024/11/very-long-section/another/the-actual-article-title';
    const short = truncatePath(long, 20);

    expect(short).toHaveLength(20);
    expect(short.startsWith('/2024')).toBe(true);
    expect(short.endsWith('title')).toBe(true);
    expect(short).toContain('…');
  });
});

describe('primaryLink', () => {
  it('promotes the first link worth a card', () => {
    expect(
      primaryLink(['https://cdn.example/a.jpg', 'https://example.com/post'])
    ).toBe('https://example.com/post');
  });

  it('returns nothing when a note links only to media', () => {
    expect(primaryLink(['https://cdn.example/a.jpg'])).toBeUndefined();
  });

  it('picks one, not all', () => {
    // Six cards where somebody wrote a paragraph is a page of chrome
    expect(
      primaryLink(['https://a.example/1', 'https://b.example/2'])
    ).toBe('https://a.example/1');
  });
});
