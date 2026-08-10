/**
 * Accent themes and professional theme presets.
 *
 * A theme is defined by three colors — surface, text and accent — and every
 * other design token is derived from them. Exposing three choices instead of
 * the nineteen tokens the app actually uses keeps combinations coherent: a
 * palette can't end up with unreadable text or an invisible border.
 *
 * Contrast decisions use relative luminance rather than raw HSL lightness,
 * because lightness alone misjudges saturated hues — a pure yellow at L=50%
 * is far brighter to the eye than a pure blue at the same value.
 */

import { ADVANCED_THEMES, advancedThemeToPreset } from '@/lib/advanced-themes';

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

/** The three colors an author picks. Stored as `H S% L%` strings. */
export interface CoreColors {
  background: string;
  foreground: string;
  primary: string;
}

/** Every token the stylesheet consumes, as `H S% L%` strings. */
export type ThemeTokens = Record<string, string>;

export function parseHsl(value: string): Hsl {
  const [h, s, l] = value
    .trim()
    .split(/\s+/)
    .map((part) => Number.parseFloat(part));

  return {
    h: Number.isFinite(h) ? h : 0,
    s: Number.isFinite(s) ? s : 0,
    l: Number.isFinite(l) ? l : 0,
  };
}

export function formatHsl({ h, s, l }: Hsl): string {
  const clamp = (value: number, max: number) =>
    Math.max(0, Math.min(max, Math.round(value * 10) / 10));
  return `${clamp(h, 360)} ${clamp(s, 100)}% ${clamp(l, 100)}%`;
}

function adjustLightness(value: string, delta: number): string {
  const hsl = parseHsl(value);
  return formatHsl({ ...hsl, l: Math.max(0, Math.min(100, hsl.l + delta)) });
}

function withSaturation(value: string, factor: number): string {
  const hsl = parseHsl(value);
  return formatHsl({ ...hsl, s: Math.max(0, Math.min(100, hsl.s * factor)) });
}

/** sRGB relative luminance, per WCAG. */
export function relativeLuminance(value: string): number {
  const { h, s, l } = parseHsl(value);
  const saturation = s / 100;
  const lightness = l / 100;

  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lightness - c / 2;

  const [r1, g1, b1] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];

  const toLinear = (channel: number) => {
    const v = channel + m;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };

  return (
    0.2126 * toLinear(r1) + 0.7152 * toLinear(g1) + 0.0722 * toLinear(b1)
  );
}

/** WCAG contrast ratio between two colors, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [light, dark] = la > lb ? [la, lb] : [lb, la];
  return (light + 0.05) / (dark + 0.05);
}

/** Picks whichever of near-white or near-black is more readable on `value`. */
export function readableOn(value: string): string {
  const white = '0 0% 100%';
  const black = '240 10% 4%';
  return contrastRatio(value, white) >= contrastRatio(value, black)
    ? white
    : black;
}

/** True when a surface is dark enough that elevation means getting lighter. */
export function isDarkSurface(value: string): boolean {
  return relativeLuminance(value) < 0.25;
}

/**
 * The floor for secondary text: WCAG's large-text minimum.
 *
 * Muted text is the token most likely to fail, because it is defined by
 * backing away from the foreground and nothing in that definition knows how
 * far it can go before the background catches up.
 */
const MUTED_MIN_CONTRAST = 3;

/**
 * Walks a colour back toward legibility.
 *
 * The derivations below shift lightness by fixed amounts, which is right for
 * ordinary palettes and wrong for the extremes — a very bright or very
 * saturated background swallows a colour that the same shift would leave
 * perfectly readable elsewhere. Rather than hand-tuning every palette against
 * every token, the result is nudged until it clears the bar.
 *
 * Steps in the direction that adds contrast, and gives up rather than looping:
 * a colour that cannot reach the target after crossing the whole range is one
 * where black or white is the honest answer.
 */
function ensureContrast(
  value: string,
  against: string,
  minimum: number
): string {
  if (contrastRatio(value, against) >= minimum) return value;

  const hsl = parseHsl(value);
  const darken = relativeLuminance(against) > relativeLuminance(value);

  for (let step = 1; step <= 20; step += 1) {
    const l = darken ? hsl.l - step * 3 : hsl.l + step * 3;
    if (l < 0 || l > 100) break;

    const candidate = formatHsl({ ...hsl, l });
    if (contrastRatio(candidate, against) >= minimum) return candidate;
  }

  return readableOn(against);
}

/**
 * Expands three core colors into the full token set.
 *
 * Elevation flips direction with the surface: on a dark background a raised
 * card is lighter than the page, on a light background it is the page colour
 * with a border doing the work instead.
 */
export function deriveTokens(core: CoreColors): ThemeTokens {
  const { background, foreground, primary } = core;
  const dark = isDarkSurface(background);
  const primaryHsl = parseHsl(primary);
  const foregroundHsl = parseHsl(foreground);

  const card = dark ? adjustLightness(background, 3.5) : '0 0% 100%';
  const surface = dark ? background : adjustLightness(background, -2);
  const muted = dark
    ? adjustLightness(background, 8)
    : adjustLightness(background, -5);

  // Borders pick up a hint of the accent hue so the palette feels intentional
  const border = formatHsl({
    h: primaryHsl.h,
    s: Math.min(primaryHsl.s * (dark ? 0.35 : 0.45), 40),
    l: dark ? 18 : 88,
  });

  // Secondary text keeps the hue but backs off contrast, without vanishing
  const mutedForeground = ensureContrast(
    formatHsl({
      h: foregroundHsl.h,
      s: Math.max(foregroundHsl.s - 20, 0),
      l: dark
        ? Math.max(foregroundHsl.l - 30, 42)
        : Math.min(foregroundHsl.l + 38, 52),
    }),
    background,
    MUTED_MIN_CONTRAST
  );

  const primaryForeground = readableOn(primary);

  return {
    background,
    foreground,
    surface,
    card,
    'card-foreground': foreground,
    popover: card,
    'popover-foreground': foreground,
    primary,
    'primary-foreground': primaryForeground,
    secondary: muted,
    'secondary-foreground': foreground,
    muted,
    'muted-foreground': mutedForeground,
    accent: dark ? adjustLightness(muted, 2) : muted,
    'accent-foreground': foreground,
    border,
    input: border,
    ring: primary,

    // The brand gradient runs from the accent to a hue-shifted partner
    'brand-from': primary,
    'brand-to': formatHsl({
      h: (primaryHsl.h + 35) % 360,
      s: primaryHsl.s,
      l: Math.min(primaryHsl.l + 4, 70),
    }),

    // Status colours keep their own meaning, tuned for the surface
    destructive: dark ? '0 72% 51%' : '0 84% 60%',
    'destructive-foreground': '0 0% 100%',
    success: dark ? '142 69% 45%' : '142 71% 41%',
    'success-foreground': '0 0% 100%',
    warning: dark ? '38 92% 55%' : '38 92% 45%',
    'warning-foreground': dark ? '240 10% 4%' : '0 0% 100%',

    like: dark ? '347 85% 62%' : '347 77% 50%',
    repost: dark ? '142 69% 50%' : '142 71% 41%',
    reply: withSaturation(primary, 0.9),
    zap: dark ? '38 92% 58%' : '38 92% 48%',

    /*
     * Elevation. Resting surfaces separate with a hairline border rather than
     * a shadow, so light mode needs no shadow at all. A hairline is faint on
     * dark, so dark keeps a trace of one. What shadow there is carries the
     * accent hue — a neutral grey shadow on a tinted surface reads as dirt.
     */
    'shadow-color': formatHsl({
      h: primaryHsl.h,
      s: dark ? 60 : 40,
      l: dark ? 2 : 20,
    }),
    'shadow-strength': dark ? '1.4' : '0',
  };
}

export interface AccentPreset {
  id: string;
  name: string;
  light: CoreColors;
  dark: CoreColors;
}

/**
 * Built-in palettes. Each defines its own light and dark cores rather than
 * deriving one from the other, because a hue that reads well on white often
 * needs more lightness to stay legible on black.
 */
export const ACCENT_PRESETS: AccentPreset[] = [
  {
    id: 'violet',
    name: 'Violet',
    light: { background: '240 20% 98%', foreground: '240 10% 4%', primary: '262 83% 58%' },
    dark: { background: '240 10% 4%', foreground: '0 0% 98%', primary: '263 70% 62%' },
  },
  {
    id: 'ocean',
    name: 'Ocean',
    light: { background: '205 40% 98%', foreground: '215 30% 12%', primary: '201 89% 42%' },
    dark: { background: '215 32% 7%', foreground: '210 20% 97%', primary: '199 89% 56%' },
  },
  {
    id: 'forest',
    name: 'Forest',
    light: { background: '140 25% 98%', foreground: '150 20% 10%', primary: '152 62% 32%' },
    dark: { background: '150 20% 6%', foreground: '140 15% 96%', primary: '152 60% 48%' },
  },
  {
    id: 'sunset',
    name: 'Sunset',
    light: { background: '30 40% 98%', foreground: '20 25% 12%', primary: '18 88% 50%' },
    dark: { background: '20 22% 6%', foreground: '30 20% 97%', primary: '20 90% 58%' },
  },
  {
    id: 'rose',
    name: 'Rose',
    light: { background: '350 35% 98%', foreground: '345 20% 12%', primary: '341 78% 51%' },
    dark: { background: '345 20% 6%', foreground: '350 20% 97%', primary: '341 80% 62%' },
  },
  {
    id: 'ember',
    name: 'Ember',
    light: { background: '25 35% 98%', foreground: '20 20% 12%', primary: '38 92% 45%' },
    dark: { background: '24 18% 6%', foreground: '40 20% 97%', primary: '43 96% 56%' },
  },
  {
    id: 'lagoon',
    name: 'Lagoon',
    light: { background: '180 30% 98%', foreground: '190 25% 11%', primary: '178 78% 33%' },
    dark: { background: '190 26% 6%', foreground: '180 18% 97%', primary: '175 72% 48%' },
  },
  {
    id: 'indigo',
    name: 'Indigo',
    light: { background: '230 30% 98%', foreground: '230 25% 11%', primary: '234 78% 56%' },
    dark: { background: '232 26% 7%', foreground: '228 20% 97%', primary: '232 82% 66%' },
  },
  {
    id: 'plum',
    name: 'Plum',
    light: { background: '300 22% 98%', foreground: '295 20% 11%', primary: '292 68% 46%' },
    dark: { background: '295 22% 6%', foreground: '300 15% 97%', primary: '291 70% 62%' },
  },
  {
    id: 'moss',
    name: 'Moss',
    light: { background: '80 22% 98%', foreground: '90 18% 11%', primary: '84 55% 32%' },
    dark: { background: '90 16% 6%', foreground: '80 14% 96%', primary: '82 52% 50%' },
  },
  {
    id: 'slate',
    name: 'Slate',
    light: { background: '215 20% 98%', foreground: '215 25% 12%', primary: '215 35% 38%' },
    dark: { background: '215 22% 7%', foreground: '210 16% 96%', primary: '213 40% 66%' },
  },
  {
    id: 'crimson',
    name: 'Crimson',
    light: { background: '5 30% 98%', foreground: '0 20% 12%', primary: '0 74% 47%' },
    dark: { background: '0 20% 6%', foreground: '10 18% 97%', primary: '0 78% 60%' },
  },
  {
    id: 'sand',
    name: 'Sand',
    light: { background: '40 30% 97%', foreground: '35 22% 13%', primary: '30 45% 38%' },
    dark: { background: '35 14% 7%', foreground: '40 16% 96%', primary: '33 48% 62%' },
  },
  {
    id: 'aurora',
    name: 'Aurora',
    light: { background: '165 30% 98%', foreground: '170 25% 11%', primary: '162 72% 34%' },
    dark: { background: '170 24% 6%', foreground: '160 16% 96%', primary: '158 66% 50%' },
  },
  {
    id: 'cobalt',
    name: 'Cobalt',
    light: { background: '220 35% 98%', foreground: '222 30% 11%', primary: '221 83% 48%' },
    dark: { background: '222 30% 6%', foreground: '218 20% 97%', primary: '217 85% 62%' },
  },
  {
    id: 'coral',
    name: 'Coral',
    light: { background: '15 40% 98%', foreground: '12 22% 12%', primary: '9 78% 50%' },
    dark: { background: '12 20% 6%', foreground: '18 18% 97%', primary: '10 82% 62%' },
  },
  {
    id: 'grape',
    name: 'Grape',
    light: { background: '275 28% 98%', foreground: '272 22% 11%', primary: '272 72% 48%' },
    dark: { background: '272 24% 6%', foreground: '276 16% 97%', primary: '272 76% 66%' },
  },
  {
    id: 'lime',
    name: 'Lime',
    light: { background: '75 30% 98%', foreground: '80 20% 10%', primary: '70 62% 30%' },
    dark: { background: '80 18% 6%', foreground: '75 14% 96%', primary: '70 60% 52%' },
  },
  {
    id: 'wine',
    name: 'Wine',
    light: { background: '350 25% 98%', foreground: '345 25% 11%', primary: '345 70% 38%' },
    dark: { background: '345 24% 6%', foreground: '350 14% 96%', primary: '344 65% 58%' },
  },
  {
    id: 'sky',
    name: 'Sky',
    light: { background: '198 40% 98%', foreground: '200 28% 11%', primary: '196 82% 40%' },
    dark: { background: '200 28% 6%', foreground: '198 18% 97%', primary: '194 85% 58%' },
  },
  {
    id: 'cocoa',
    name: 'Cocoa',
    light: { background: '25 22% 97%', foreground: '22 24% 12%', primary: '18 52% 36%' },
    dark: { background: '22 16% 6%', foreground: '28 14% 96%', primary: '20 55% 58%' },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    light: { background: '225 25% 97%', foreground: '228 32% 10%', primary: '228 45% 34%' },
    dark: { background: '228 32% 5%', foreground: '220 18% 96%', primary: '225 60% 66%' },
  },
  {
    id: 'mono',
    name: 'Mono',
    light: { background: '0 0% 98%', foreground: '0 0% 8%', primary: '0 0% 18%' },
    dark: { background: '0 0% 5%', foreground: '0 0% 97%', primary: '0 0% 88%' },
  },
];

export const DEFAULT_ACCENT = 'violet';

/**
 * Every palette a person can be on, simple and advanced alike.
 *
 * One list, because there is one theming pipeline. The advanced themes used to
 * run through a parallel one that wrote CSS variables nothing read; they are
 * ordinary presets now, and are looked up the same way.
 */
export function allAccentPresets(): AccentPreset[] {
  return [
    ...ACCENT_PRESETS,
    ...Object.values(ADVANCED_THEMES).map(advancedThemeToPreset),
  ];
}

export function getAccentPreset(id: string): AccentPreset {
  return (
    allAccentPresets().find((preset) => preset.id === id) ?? ACCENT_PRESETS[0]
  );
}

/** Writes a token set onto an element as CSS custom properties. */
export function applyTokens(element: HTMLElement, tokens: ThemeTokens): void {
  for (const [name, value] of Object.entries(tokens)) {
    element.style.setProperty(`--${name}`, value);
  }
}

/** Removes previously applied token overrides, restoring the stylesheet. */
export function clearTokens(element: HTMLElement, tokens: ThemeTokens): void {
  for (const name of Object.keys(tokens)) {
    element.style.removeProperty(`--${name}`);
  }
}

export const TYPOGRAPHY = {
  h1: 'text-4xl font-bold tracking-tight',
  h2: 'text-3xl font-bold tracking-tight',
  h3: 'text-2xl font-semibold',
  h4: 'text-xl font-semibold',
  body: 'text-base leading-relaxed',
  bodySmall: 'text-sm leading-relaxed',
  caption: 'text-xs uppercase tracking-wide',
  mono: 'font-mono text-sm',
} as const;

/**
 * Professional spacing scale
 */
export const SPACING = {
  xs: '0.25rem',
  sm: '0.5rem',
  md: '1rem',
  lg: '1.5rem',
  xl: '2rem',
  '2xl': '3rem',
  '3xl': '4rem',
} as const;

/**
 * Shadow system for depth
 */
export const SHADOWS = {
  none: 'none',
  sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  md: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
  lg: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
  xl: '0 20px 25px -5px rgb(0 0 0 / 0.1)',
  '2xl': '0 25px 50px -12px rgb(0 0 0 / 0.25)',
  float: '0 0 0 1px rgb(0 0 0 / 0.05), 0 4px 12px rgb(0 0 0 / 0.08)',
} as const;

/**
 * Border radius system
 */
export const BORDER_RADIUS = {
  none: '0',
  sm: '0.375rem',
  md: '0.5rem',
  lg: '0.75rem',
  xl: '1rem',
  '2xl': '1.5rem',
  full: '9999px',
} as const;

/**
 * Transition/animation configuration
 */
export const TRANSITIONS = {
  fast: 'duration-150',
  normal: 'duration-200',
  slow: 'duration-300',
} as const;
