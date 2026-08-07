import { describe, it, expect } from 'vitest';
import {
  ACCENT_PRESETS,
  contrastRatio,
  deriveTokens,
  formatHsl,
  getAccentPreset,
  isDarkSurface,
  parseHsl,
  readableOn,
  relativeLuminance,
} from './theme';

describe('parseHsl / formatHsl', () => {
  it('round-trips a token string', () => {
    expect(formatHsl(parseHsl('262 83% 58%'))).toBe('262 83% 58%');
  });

  it('survives malformed input rather than producing NaN', () => {
    expect(parseHsl('nonsense')).toEqual({ h: 0, s: 0, l: 0 });
  });
});

describe('relativeLuminance', () => {
  it('places black and white at the extremes', () => {
    expect(relativeLuminance('0 0% 0%')).toBeCloseTo(0, 3);
    expect(relativeLuminance('0 0% 100%')).toBeCloseTo(1, 3);
  });

  it('rates yellow far brighter than blue at equal HSL lightness', () => {
    // This is exactly why contrast decisions cannot use lightness alone
    const yellow = relativeLuminance('60 100% 50%');
    const blue = relativeLuminance('240 100% 50%');
    expect(yellow).toBeGreaterThan(blue * 5);
  });
});

describe('readableOn', () => {
  it('picks dark text on bright surfaces and light text on dark ones', () => {
    expect(readableOn('60 100% 50%')).toBe('240 10% 4%');
    expect(readableOn('240 100% 25%')).toBe('0 0% 100%');
  });

  it('always clears the WCAG AA threshold for large text', () => {
    for (const hue of [0, 40, 60, 120, 200, 260, 300]) {
      for (const lightness of [20, 40, 50, 60, 80]) {
        const colour = `${hue} 85% ${lightness}%`;
        expect(contrastRatio(colour, readableOn(colour))).toBeGreaterThan(3);
      }
    }
  });
});

describe('isDarkSurface', () => {
  it('classifies by perceived brightness', () => {
    expect(isDarkSurface('240 10% 4%')).toBe(true);
    expect(isDarkSurface('0 0% 98%')).toBe(false);
  });
});

describe('deriveTokens', () => {
  it('produces every token the stylesheet expects', () => {
    const tokens = deriveTokens(ACCENT_PRESETS[0].dark);

    for (const name of [
      'background',
      'foreground',
      'card',
      'card-foreground',
      'popover',
      'primary',
      'primary-foreground',
      'secondary',
      'muted',
      'muted-foreground',
      'accent',
      'border',
      'input',
      'ring',
      'brand-from',
      'brand-to',
      'destructive',
      'success',
      'warning',
      'like',
      'repost',
      'reply',
      'zap',
    ]) {
      expect(tokens[name], `missing token: ${name}`).toBeTruthy();
    }
  });

  it('raises cards above the page in dark mode and keeps them white in light', () => {
    const dark = deriveTokens(ACCENT_PRESETS[0].dark);
    const light = deriveTokens(ACCENT_PRESETS[0].light);

    // A dark card that matched the page would make the card invisible
    expect(parseHsl(dark.card).l).toBeGreaterThan(
      parseHsl(dark.background).l
    );
    expect(parseHsl(light.card).l).toBeGreaterThanOrEqual(
      parseHsl(light.background).l
    );
  });

  it('keeps body text readable against the page in every preset', () => {
    for (const preset of ACCENT_PRESETS) {
      for (const mode of ['light', 'dark'] as const) {
        const tokens = deriveTokens(preset[mode]);
        const ratio = contrastRatio(tokens.foreground, tokens.background);

        // WCAG AA for body text
        expect(
          ratio,
          `${preset.id} ${mode}: body contrast ${ratio.toFixed(2)}`
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps secondary text legible in every preset', () => {
    for (const preset of ACCENT_PRESETS) {
      for (const mode of ['light', 'dark'] as const) {
        const tokens = deriveTokens(preset[mode]);
        const ratio = contrastRatio(tokens['muted-foreground'], tokens.background);

        // AA for large text; muted copy is supporting, not primary
        expect(
          ratio,
          `${preset.id} ${mode}: muted contrast ${ratio.toFixed(2)}`
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('keeps label text readable on primary buttons in every preset', () => {
    for (const preset of ACCENT_PRESETS) {
      for (const mode of ['light', 'dark'] as const) {
        const tokens = deriveTokens(preset[mode]);
        const ratio = contrastRatio(
          tokens['primary-foreground'],
          tokens.primary
        );

        expect(
          ratio,
          `${preset.id} ${mode}: button contrast ${ratio.toFixed(2)}`
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('gives the brand gradient two distinguishable ends', () => {
    const tokens = deriveTokens(ACCENT_PRESETS[0].dark);
    expect(tokens['brand-from']).not.toBe(tokens['brand-to']);
  });
});

describe('getAccentPreset', () => {
  it('falls back to the first preset for an unknown id', () => {
    expect(getAccentPreset('does-not-exist')).toBe(ACCENT_PRESETS[0]);
  });

  it('has unique preset ids', () => {
    const ids = ACCENT_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('elevation tokens', () => {
  it('are produced for every preset', () => {
    for (const preset of ACCENT_PRESETS) {
      for (const mode of ['light', 'dark'] as const) {
        const tokens = deriveTokens(preset[mode]);
        for (const name of ['shadow-color', 'shadow-strength']) {
          expect(tokens[name], `${preset.id} ${mode}: ${name}`).toBeTruthy();
        }
      }
    }
  });

  it('tints what shadow there is with the accent hue, not neutral grey', () => {
    for (const preset of ACCENT_PRESETS) {
      const tokens = deriveTokens(preset.dark);
      const shadow = parseHsl(tokens['shadow-color']);
      const accent = parseHsl(preset.dark.primary);

      expect(shadow.h, preset.id).toBe(accent.h);
      expect(shadow.s, preset.id).toBeGreaterThan(0);
    }
  });

  it('drops the shadow entirely on light, where the border does the work', () => {
    for (const preset of ACCENT_PRESETS) {
      expect(
        Number(deriveTokens(preset.light)['shadow-strength']),
        preset.id
      ).toBe(0);
    }
  });

  it('keeps a trace of shadow on dark, where a hairline border is faint', () => {
    for (const preset of ACCENT_PRESETS) {
      const strength = Number(deriveTokens(preset.dark)['shadow-strength']);

      expect(strength, preset.id).toBeGreaterThan(0);
      // Anything heavier stops reading as flat
      expect(strength, preset.id).toBeLessThanOrEqual(2);
    }
  });

  it('shadows darker than the surface they fall on', () => {
    const dark = deriveTokens(ACCENT_PRESETS[0].dark);
    expect(parseHsl(dark['shadow-color']).l).toBeLessThan(
      parseHsl(dark.background).l
    );
  });
});
