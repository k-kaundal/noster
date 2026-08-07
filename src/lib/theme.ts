/**
 * Accent themes.
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
  const mutedForeground = formatHsl({
    h: foregroundHsl.h,
    s: Math.max(foregroundHsl.s - 20, 0),
    l: dark
      ? Math.max(foregroundHsl.l - 30, 42)
      : Math.min(foregroundHsl.l + 38, 52),
  });

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
    id: 'mono',
    name: 'Mono',
    light: { background: '0 0% 98%', foreground: '0 0% 8%', primary: '0 0% 18%' },
    dark: { background: '0 0% 5%', foreground: '0 0% 97%', primary: '0 0% 88%' },
  },
];

export const DEFAULT_ACCENT = 'violet';

export function getAccentPreset(id: string): AccentPreset {
  return (
    ACCENT_PRESETS.find((preset) => preset.id === id) ?? ACCENT_PRESETS[0]
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
