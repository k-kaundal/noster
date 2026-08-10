import { describe, it, expect } from 'vitest';
import {
  ADVANCED_THEMES,
  advancedThemeMode,
  advancedThemeToPreset,
} from './advanced-themes';
import { contrastRatio, deriveTokens } from './theme';

const themes = Object.values(ADVANCED_THEMES);

describe('advancedThemeMode', () => {
  it('reads the mode off the background, not the name', () => {
    expect(advancedThemeMode(ADVANCED_THEMES['x-light'])).toBe('light');
    expect(advancedThemeMode(ADVANCED_THEMES['x-dark'])).toBe('dark');
  });

  it('agrees with the tokens about which way up every theme is', () => {
    // The mode is what the app switches to when a theme is picked. Getting it
    // backwards puts light text on a light page, which is not a wrong colour
    // but an unreadable one.
    for (const theme of themes) {
      const mode = advancedThemeMode(theme);
      const lightness = Number.parseFloat(
        theme.backgroundColor.trim().split(/\s+/)[2]
      );

      expect(
        mode === 'dark' ? lightness < 50 : lightness >= 50,
        `${theme.id} background ${theme.backgroundColor} classified as ${mode}`
      ).toBe(true);
    }
  });
});

describe('advancedThemeToPreset', () => {
  it('produces readable body text for every theme', () => {
    // 4.5:1 is the WCAG floor for normal text. A theme that cannot clear it is
    // not a style choice, it is a page nobody can read.
    for (const theme of themes) {
      const preset = advancedThemeToPreset(theme);
      const tokens = deriveTokens(preset.light);

      expect(
        contrastRatio(tokens.background, tokens.foreground),
        `${theme.id} body text`
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('produces readable text on top of the accent for every theme', () => {
    for (const theme of themes) {
      const tokens = deriveTokens(advancedThemeToPreset(theme).light);

      expect(
        contrastRatio(tokens.primary, tokens['primary-foreground']),
        `${theme.id} button label`
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps the theme identity in the accent rather than the text colour', () => {
    // These configs call the text colour "primary", which is why routing them
    // straight through turned every theme into the same black-and-white page
    const preset = advancedThemeToPreset(ADVANCED_THEMES['x-light']);

    expect(preset.light.primary).toBe(ADVANCED_THEMES['x-light'].accentColor);
    expect(preset.light.foreground).toBe(ADVANCED_THEMES['x-light'].textColor);
  });

  it('is findable by id from the shared palette lookup', () => {
    for (const theme of themes) {
      expect(advancedThemeToPreset(theme).id).toBe(theme.id);
    }
  });
});
