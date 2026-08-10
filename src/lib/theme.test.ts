import { describe, it, expect } from 'vitest';
import {
  ACCENT_PRESETS,
  allAccentPresets,
  contrastRatio,
  deriveTokens,
  getAccentPreset,
} from './theme';

/**
 * Every palette, in both modes.
 *
 * Run over the whole list rather than a sample, because a palette is added by
 * pasting three colour strings and there is nothing in the act of adding one
 * that would reveal it is unreadable.
 */
const cases = allAccentPresets().flatMap((preset) => [
  { id: `${preset.id} (light)`, tokens: deriveTokens(preset.light) },
  { id: `${preset.id} (dark)`, tokens: deriveTokens(preset.dark) },
]);

describe('palettes', () => {
  it('has no duplicate ids, which the lookup resolves by first match', () => {
    const ids = allAccentPresets().map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('reads body text at WCAG AA on every palette', () => {
    for (const { id, tokens } of cases) {
      expect(
        contrastRatio(tokens.background, tokens.foreground),
        `${id} body text`
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('reads card text at WCAG AA on every palette', () => {
    // Cards are a different surface from the page, and on light palettes they
    // are pure white while the page is tinted
    for (const { id, tokens } of cases) {
      expect(
        contrastRatio(tokens.card, tokens['card-foreground']),
        `${id} card text`
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps secondary text legible rather than merely dimmer', () => {
    // 3:1 is the large-text floor. Muted text that falls under it is the
    // failure that reads as "the theme looks washed out"
    for (const { id, tokens } of cases) {
      expect(
        contrastRatio(tokens.background, tokens['muted-foreground']),
        `${id} muted text`
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it('reads button labels on the accent for every palette', () => {
    for (const { id, tokens } of cases) {
      expect(
        contrastRatio(tokens.primary, tokens['primary-foreground']),
        `${id} button label`
      ).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('getAccentPreset', () => {
  it('finds a built-in accent', () => {
    expect(getAccentPreset('violet').id).toBe('violet');
  });

  it('finds an advanced theme, which lives in the same lookup now', () => {
    expect(getAccentPreset('x-dark').id).toBe('x-dark');
  });

  it('falls back rather than throwing on a palette that no longer exists', () => {
    // Someone whose stored choice was removed in an update gets the default,
    // not a blank page
    expect(getAccentPreset('deleted-theme')).toBe(ACCENT_PRESETS[0]);
  });
});
